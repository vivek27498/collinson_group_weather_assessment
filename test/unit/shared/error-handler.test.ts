import express from 'express';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { z } from 'zod';
import { createLogger } from '../../../src/observability/logger';
import { NotFoundError, UpstreamUnavailableError } from '../../../src/shared/errors/app-error';
import { errorHandler, notFoundHandler } from '../../../src/shared/http/error-handler';
import { genReqId } from '../../../src/shared/http/request-id';
import { sendSuccess } from '../../../src/shared/http/respond';

/**
 * Exercises the shared middleware in isolation with routes that throw every kind of
 * error, synchronously and from async handlers (which Express 5 forwards natively).
 */
function buildTestApp() {
  const app = express();
  app.use(pinoHttp({ logger: createLogger({ level: 'silent' }), genReqId }));

  app.get('/ok', (req, res) => {
    sendSuccess(req, res, { hello: 'world' });
  });
  app.post('/created', (req, res) => {
    sendSuccess(req, res, { id: 1 }, 201);
  });
  app.get('/async-not-found', async () => {
    await Promise.resolve();
    throw new NotFoundError('City not found', { code: 'LOCATION_NOT_FOUND' });
  });
  app.get('/async-upstream', async () => {
    await Promise.resolve();
    throw new UpstreamUnavailableError('Weather provider unavailable', {
      cause: new Error('connect ECONNREFUSED 10.0.0.5:443'),
    });
  });
  app.get('/zod', () => {
    z.object({ city: z.string().min(3) }).parse({ city: 'x' });
  });
  app.get('/bug', async () => {
    await Promise.resolve();
    throw new Error("ER_PARSE_ERROR: You have an error in your SQL syntax near 'DROP'");
  });
  app.get('/headers-already-sent', (_req, res, next) => {
    res.status(200).write('partial');
    next(new Error('late failure'));
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('response envelope and centralised error handling', () => {
  const app = buildTestApp();

  it('wraps success payloads with success=true and request metadata', async () => {
    const res = await request(app).get('/ok').set('x-request-id', 'req-123');

    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe('req-123');
    expect(res.body).toEqual({
      success: true,
      data: { hello: 'world' },
      meta: { requestId: 'req-123', timestamp: expect.any(String) as unknown },
    });
    expect(
      Number.isNaN(Date.parse((res.body as { meta: { timestamp: string } }).meta.timestamp)),
    ).toBe(false);
  });

  it('honours a custom success status', async () => {
    const res = await request(app).post('/created');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, data: { id: 1 } });
  });

  it('turns an AppError thrown from an async handler into its mapped status and code', async () => {
    const res = await request(app).get('/async-not-found');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'LOCATION_NOT_FOUND', message: 'City not found' },
      meta: { requestId: expect.any(String) as unknown },
    });
  });

  it('does not leak the internal cause of an upstream failure', async () => {
    const res = await request(app).get('/async-upstream');

    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
  });

  it('returns field-level details for validation failures', async () => {
    const res = await request(app).get('/zod');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR', details: [{ path: 'city' }] },
    });
  });

  it('hides unexpected errors (e.g. raw SQL errors) behind a generic 500', async () => {
    const res = await request(app).get('/bug');

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/SQL|DROP|stack/i);
  });

  it('returns the envelope (not an HTML page) for unknown routes', async () => {
    const res = await request(app).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toMatchObject({ success: false, error: { code: 'ROUTE_NOT_FOUND' } });
  });

  it('delegates to Express when headers were already sent (connection is aborted, no 2nd write)', async () => {
    // We must not try to write a second response; Express's default handler destroys the
    // socket so the client sees a truncated response instead of a corrupted one.
    await expect(request(app).get('/headers-already-sent')).rejects.toThrow(/aborted|hang up/);
  });
});
