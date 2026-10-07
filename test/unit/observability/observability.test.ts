import express from 'express';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { createApp } from '../../../src/app';
import { InstrumentedJsonClient } from '../../../src/infrastructure/http/instrumented-json-client';
import {
  UpstreamRequestError,
  type JsonHttpClient,
} from '../../../src/infrastructure/http/json-http-client';
import { createLogger } from '../../../src/observability/logger';
import { createMetrics } from '../../../src/observability/metrics';
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

describe('metrics', () => {
  it('exposes Prometheus metrics and times requests with bounded route labels', async () => {
    const metrics = createMetrics();
    const app = createApp({ logger: createLogger({ level: 'silent' }), metrics });

    await request(app).get('/healthz');
    await request(app).get('/some/random/path/123'); // must not create a new label value
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain(
      'weather_http_request_duration_seconds_count{method="GET",route="/healthz",status_code="200"} 1',
    );
    expect(res.text).toContain('route="other",status_code="404"');
    expect(res.text).not.toContain('/some/random/path');
    expect(res.text).toContain('weather_process_cpu_user_seconds_total'); // default metrics
  });

  it('has no /metrics endpoint when metrics are not configured', async () => {
    const app = createApp({ logger: createLogger({ level: 'silent' }) });

    expect((await request(app).get('/metrics')).status).toBe(404);
  });
});

describe('InstrumentedJsonClient', () => {
  const url = new URL('https://api.example.test/x');
  const ctx = { upstream: 'open-meteo.forecast' };

  function setup(result: Promise<unknown>) {
    let clock = 1000;
    const inner: JsonHttpClient = {
      getJson: () => {
        clock += 250; // the call "takes" 250 ms
        return result;
      },
    };
    const attempts: [string, string, number][] = [];
    const client = new InstrumentedJsonClient(
      inner,
      { attempt: (upstream, outcome, seconds) => attempts.push([upstream, outcome, seconds]) },
      () => clock,
    );
    return { client, attempts };
  }

  it('records success with its duration', async () => {
    const { client, attempts } = setup(Promise.resolve({ ok: true }));

    await expect(client.getJson(url, ctx)).resolves.toEqual({ ok: true });
    expect(attempts).toEqual([['open-meteo.forecast', 'success', 0.25]]);
  });

  it('records the failure class and rethrows', async () => {
    const failure = new UpstreamRequestError('open-meteo.forecast', 'timeout', undefined, true);
    const { client, attempts } = setup(Promise.reject(failure));

    await expect(client.getJson(url, ctx)).rejects.toBe(failure);
    expect(attempts).toEqual([['open-meteo.forecast', 'timeout', 0.25]]);
  });

  it('labels unexpected errors as "error"', async () => {
    const { client, attempts } = setup(Promise.reject(new TypeError('bug')));

    await expect(client.getJson(url, ctx)).rejects.toThrow(TypeError);
    expect(attempts[0]?.[1]).toBe('error');
  });
});
