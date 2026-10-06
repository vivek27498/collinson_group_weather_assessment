import {
  FetchJsonClient,
  isRetryableStatus,
  UpstreamRequestError,
} from '../../../src/infrastructure/http/json-http-client';
import { UpstreamUnavailableError } from '../../../src/shared/errors/app-error';

const url = new URL('https://api.example.test/v1/forecast?latitude=1');
const ctx = { upstream: 'test.upstream' };

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function captureError(promise: Promise<unknown>): Promise<UpstreamRequestError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof UpstreamRequestError) return err;
    throw err;
  }
  throw new Error('expected the call to fail');
}

describe('FetchJsonClient', () => {
  it('returns parsed JSON and sends an accept header and an abort signal', async () => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ ok: 1 }));
    const client = new FetchJsonClient({ timeoutMs: 1000, fetchFn });

    await expect(client.getJson(url, ctx)).resolves.toEqual({ ok: 1 });
    const [calledUrl, init] = fetchFn.mock.calls[0] as [URL, RequestInit];
    expect(calledUrl).toBe(url);
    expect(init.headers).toEqual({ accept: 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [500, true],
    [503, true],
    [429, true],
    [400, false],
    [404, false],
  ])('classifies HTTP %i as retryable=%p', async (status, retryable) => {
    const fetchFn = jest.fn().mockResolvedValue(jsonResponse({ error: true, reason: 'x' }, status));
    const client = new FetchJsonClient({ timeoutMs: 1000, fetchFn });

    const error = await captureError(client.getJson(url, ctx));

    expect(error).toMatchObject({
      failure: 'http_status',
      status,
      retryable,
      upstream: 'test.upstream',
    });
    expect(isRetryableStatus(status)).toBe(retryable);
  });

  it('treats network failures as retryable', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = new FetchJsonClient({ timeoutMs: 1000, fetchFn });

    await expect(captureError(client.getJson(url, ctx))).resolves.toMatchObject({
      failure: 'network',
      retryable: true,
    });
  });

  it('times out a slow upstream (real AbortSignal) and marks it retryable', async () => {
    // A fetch that never resolves on its own, only when the signal aborts, like a hung socket.
    const fetchFn = jest.fn(
      (_url: URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error);
          });
        }),
    );
    const client = new FetchJsonClient({ timeoutMs: 50, fetchFn: fetchFn as typeof fetch });

    await expect(captureError(client.getJson(url, ctx))).resolves.toMatchObject({
      failure: 'timeout',
      retryable: true,
    });
  });

  it('rejects a non-JSON body as a non-retryable invalid response', async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response('<html>oops</html>', { status: 200 }));
    const client = new FetchJsonClient({ timeoutMs: 1000, fetchFn });

    await expect(captureError(client.getJson(url, ctx))).resolves.toMatchObject({
      failure: 'invalid_response',
      retryable: false,
    });
  });

  it('is an UpstreamUnavailableError with a client-safe message (no URL, status or body)', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(new Response('internal stack trace at db-01.internal', { status: 500 }));
    const client = new FetchJsonClient({ timeoutMs: 1000, fetchFn });

    const error = await captureError(client.getJson(url, ctx));

    expect(error).toBeInstanceOf(UpstreamUnavailableError);
    expect(error.message).toBe('The weather provider is temporarily unavailable');
    expect(error.message).not.toMatch(/500|example\.test|db-01/);
    // ...but the detail is preserved for logs:
    expect(String(error.cause)).toContain('db-01.internal');
  });
});
