import {
  UpstreamRequestError,
  type JsonHttpClient,
} from '../../../src/infrastructure/http/json-http-client';
import { RetryingJsonClient } from '../../../src/infrastructure/http/retrying-json-client';

const url = new URL('https://api.example.test/v1/x');
const ctx = { upstream: 'test.upstream' };
const retryable = () => new UpstreamRequestError('test.upstream', 'http_status', 503, true);
const permanent = () => new UpstreamRequestError('test.upstream', 'http_status', 400, false);

function setup(results: unknown[], maxRetries = 2) {
  const inner: jest.Mocked<JsonHttpClient> = { getJson: jest.fn() };
  for (const r of results) {
    if (r instanceof Error) inner.getJson.mockRejectedValueOnce(r);
    else inner.getJson.mockResolvedValueOnce(r);
  }
  const sleep = jest.fn<Promise<void>, [number]>().mockResolvedValue(undefined);
  const client = new RetryingJsonClient(inner, {
    maxRetries,
    baseDelayMs: 100,
    maxDelayMs: 1000,
    sleep,
    random: () => 0.5, // deterministic jitter
  });
  return { client, inner, sleep };
}

describe('RetryingJsonClient', () => {
  it('returns immediately when the first attempt succeeds', async () => {
    const { client, inner, sleep } = setup([{ ok: true }]);

    await expect(client.getJson(url, ctx)).resolves.toEqual({ ok: true });
    expect(inner.getJson).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries transient failures and then succeeds', async () => {
    const { client, inner } = setup([retryable(), retryable(), { ok: true }]);

    await expect(client.getJson(url, ctx)).resolves.toEqual({ ok: true });
    expect(inner.getJson).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxRetries and rethrows the last error', async () => {
    const last = retryable();
    const { client, inner } = setup([retryable(), retryable(), last]);

    await expect(client.getJson(url, ctx)).rejects.toBe(last);
    expect(inner.getJson).toHaveBeenCalledTimes(3); // 1 attempt + 2 retries
  });

  it('never retries a permanent failure (e.g. HTTP 400): it would only burn quota', async () => {
    const { client, inner } = setup([permanent(), { ok: true }]);

    await expect(client.getJson(url, ctx)).rejects.toMatchObject({ status: 400 });
    expect(inner.getJson).toHaveBeenCalledTimes(1);
  });

  it('never retries unknown errors (bugs), only classified upstream failures', async () => {
    const { client, inner } = setup([new TypeError('bug'), { ok: true }]);

    await expect(client.getJson(url, ctx)).rejects.toThrow(TypeError);
    expect(inner.getJson).toHaveBeenCalledTimes(1);
  });

  it('does not retry at all when maxRetries is 0', async () => {
    const { client, inner } = setup([retryable(), { ok: true }], 0);

    await expect(client.getJson(url, ctx)).rejects.toMatchObject({ status: 503 });
    expect(inner.getJson).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially with jitter, capped at maxDelayMs', async () => {
    const { client, sleep } = setup([retryable(), retryable(), { ok: true }]);
    await client.getJson(url, ctx);

    // random()=0.5 → half of min(cap, 100 * 2^attempt)
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([50, 100]);
    const { client: capped } = setup([]);
    expect(capped.backoffDelay(10)).toBe(500); // 0.5 * cap(1000)
  });
});
