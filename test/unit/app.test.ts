import request from 'supertest';
import { createApp } from '../../src/app';
import { createLogger } from '../../src/observability/logger';

describe('createApp', () => {
  const app = createApp({ logger: createLogger({ level: 'silent' }) });

  it('GET /healthz returns ok in the standard envelope', async () => {
    const res = await request(app).get('/healthz');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok' } });
  });

  it('GET /readyz is ready normally and 503 while shutting down', async () => {
    let shuttingDown = false;
    const drainingApp = createApp({
      logger: createLogger({ level: 'silent' }),
      isShuttingDown: () => shuttingDown,
    });

    const ready = await request(drainingApp).get('/readyz');
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({ success: true, data: { status: 'ready' } });

    shuttingDown = true;
    const draining = await request(drainingApp).get('/readyz');
    expect(draining.status).toBe(503);
    expect(draining.body).toMatchObject({ success: false, error: { code: 'SHUTTING_DOWN' } });
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/healthz');

    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('always returns a request id header, generating one when absent', async () => {
    const res = await request(app).get('/healthz');

    expect(res.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('rejects malformed JSON with a 400 envelope', async () => {
    const res = await request(app)
      .post('/healthz')
      .set('content-type', 'application/json')
      .send('{"city": "Paris"');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: { code: 'MALFORMED_JSON' } });
  });

  it('rejects oversized bodies with 413', async () => {
    const res = await request(app)
      .post('/healthz')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ city: 'x'.repeat(20_000) }));

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ success: false, error: { code: 'PAYLOAD_TOO_LARGE' } });
  });
});
