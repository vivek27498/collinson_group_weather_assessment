import express from 'express';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { createLogger } from '../../../src/observability/logger';
import {
  currentRequestContext,
  requestContextMiddleware,
  runWithRequestContext,
} from '../../../src/observability/request-context';
import { genReqId } from '../../../src/shared/http/request-id';
import { captureLogs } from '../../support/log-capture';

describe('request context + logger mixin', () => {
  it('stamps every log line with the request id, across async hops', async () => {
    const { logger, lines } = captureLogs();

    await runWithRequestContext({ requestId: 'req-42' }, async () => {
      logger.info('before await');
      await new Promise((resolve) => setTimeout(resolve, 5));
      logger.warn('after await, e.g. inside the retry decorator');
    });
    logger.info('outside any request');

    expect(lines().map((l) => [l.msg, l.requestId])).toEqual([
      ['before await', 'req-42'],
      ['after await, e.g. inside the retry decorator', 'req-42'],
      ['outside any request', undefined],
    ]);
  });

  it('is set per HTTP request from the x-request-id, and isolated between concurrent requests', async () => {
    const app = express();
    app.use(pinoHttp({ logger: createLogger({ level: 'silent' }), genReqId }));
    app.use(requestContextMiddleware);
    app.get('/whoami', async (_req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      res.json({ requestId: currentRequestContext()?.requestId });
    });

    const [a, b] = await Promise.all([
      request(app).get('/whoami').set('x-request-id', 'alpha'),
      request(app).get('/whoami').set('x-request-id', 'beta'),
    ]);

    expect(a.body).toEqual({ requestId: 'alpha' });
    expect(b.body).toEqual({ requestId: 'beta' });
  });
});
