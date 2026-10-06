import type { Logger } from '../../observability/logger';
import { UpstreamRequestError, type JsonHttpClient, type RequestContext } from './json-http-client';

export interface RetryOptions {
  /** Extra attempts after the first one. 0 disables retrying. */
  readonly maxRetries: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly logger?: Logger;
  /** Injected for tests so they don't actually wait or depend on randomness. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Decorator: adds retries to any JsonHttpClient without the inner client (or the adapters
 * above it) knowing.
 *
 * - Only retries failures that might succeed next time (timeouts, network errors, 5xx, 429).
 *   A 400 means our request is wrong, and retrying it just wastes the provider's quota.
 * - Exponential backoff with *full jitter* (random delay up to the cap) so many instances
 *   recovering from the same outage don't retry in lock-step (thundering herd).
 * - Retries are GETs only, which are idempotent, so repeating them is safe.
 */
export class RetryingJsonClient implements JsonHttpClient {
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(
    private readonly inner: JsonHttpClient,
    private readonly options: RetryOptions,
  ) {
    this.baseDelayMs = options.baseDelayMs ?? 200;
    this.maxDelayMs = options.maxDelayMs ?? 2000;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  async getJson(url: URL, context: RequestContext): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.inner.getJson(url, context);
      } catch (err) {
        const retryable = err instanceof UpstreamRequestError && err.retryable;
        if (!retryable || attempt >= this.options.maxRetries) {
          throw err;
        }
        const delayMs = this.backoffDelay(attempt);
        this.options.logger?.warn(
          {
            upstream: context.upstream,
            attempt: attempt + 1,
            delayMs,
            failure: err.failure,
            status: err.status,
          },
          'Upstream call failed, retrying',
        );
        await this.sleep(delayMs);
      }
    }
  }

  /** Full jitter: uniform random in [0, min(cap, base * 2^attempt)]. */
  backoffDelay(attempt: number): number {
    const ceiling = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** attempt);
    return Math.round(this.random() * ceiling);
  }
}
