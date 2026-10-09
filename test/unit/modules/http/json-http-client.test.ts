import nock from 'nock';
import { AxiosJsonClient, isRetryableStatus, HttpRequestError } from '../../../../src/modules/http';
import { UpstreamUnavailableError } from '../../../../src/modules/errors';

/**
 * The real axios client against a nock-intercepted host: we exercise axios' actual
 * timeout, status and body handling, not a hand-written fake of it.
 */
const HOST = 'https://api.example.test';
const url = new URL(`${HOST}/v1/forecast?latitude=1`);
const serviceName = 'test.service';
const client = (timeoutMs = 1000) => new AxiosJsonClient({ timeoutMs });

async function captureError(promise: Promise<unknown>): Promise<HttpRequestError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HttpRequestError) return err;
    throw err;
  }
  throw new Error('expected the call to fail');
}

beforeAll(() => {
  nock.disableNetConnect();
});
afterEach(() => {
  nock.cleanAll();
});
afterAll(() => {
  nock.enableNetConnect();
});

describe('AxiosJsonClient', () => {
  it('returns parsed JSON, sends the query string and an accept header', async () => {
    const scope = nock(HOST, { reqheaders: { accept: 'application/json' } })
      .get('/v1/forecast')
      .query({ latitude: '1' })
      .reply(200, { ok: 1 });

    await expect(client().getJson(url, serviceName)).resolves.toEqual({ ok: 1 });
    expect(scope.isDone()).toBe(true);
  });

  it.each([
    [500, true],
    [503, true],
    [429, true],
    [400, false],
    [404, false],
  ])('classifies HTTP %i as retryable=%p', async (status, retryable) => {
    nock(HOST).get('/v1/forecast').query(true).reply(status, { error: true, reason: 'x' });

    const error = await captureError(client().getJson(url, serviceName));

    expect(error).toMatchObject({
      failure: 'http_status',
      status,
      retryable,
      serviceName: 'test.service',
    });
    expect(isRetryableStatus(status)).toBe(retryable);
  });

  it('treats network failures as retryable (a real refused connection)', async () => {
    // A genuinely closed local port, not nock's replyWithError: with nock 14 that simulated error
    // never reaches axios (the request hangs until the timeout), which would hide this path.
    nock.enableNetConnect('127.0.0.1');
    try {
      const refused = new URL('http://127.0.0.1:9/v1/forecast');

      await expect(captureError(client().getJson(refused, serviceName))).resolves.toMatchObject({
        failure: 'network',
        retryable: true,
      });
    } finally {
      nock.disableNetConnect();
    }
  });

  it('times out a slow upstream and marks it retryable', async () => {
    nock(HOST).get('/v1/forecast').query(true).delay(300).reply(200, { ok: 1 });

    await expect(captureError(client(50).getJson(url, serviceName))).resolves.toMatchObject({
      failure: 'timeout',
      retryable: true,
    });
  });

  it('rejects a non-JSON body as a non-retryable invalid response', async () => {
    nock(HOST).get('/v1/forecast').query(true).reply(200, '<html>oops</html>');

    await expect(captureError(client().getJson(url, serviceName))).resolves.toMatchObject({
      failure: 'invalid_response',
      retryable: false,
    });
  });

  it('is an UpstreamUnavailableError with a client-safe message (no URL, status or body)', async () => {
    nock(HOST).get('/v1/forecast').query(true).reply(500, 'internal stack trace at db-01.internal');

    const error = await captureError(client().getJson(url, serviceName));

    expect(error).toBeInstanceOf(UpstreamUnavailableError);
    expect(error.message).toBe('The weather provider is temporarily unavailable');
    expect(error.message).not.toMatch(/500|example\.test|db-01/);
    // ...but the detail is preserved for logs:
    expect(String(error.cause)).toContain('db-01.internal');
  });
});
