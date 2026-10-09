import type { Logger } from '../logger';
import { HttpRequestError, type JsonHttpClient } from './json-http-client';

export interface RetryOptions {
  /** How many extra attempts after the first one. 0 = never retry. */
  maxRetries: number;
  /** Delay before the first retry; it doubles on each later retry. */
  baseDelayMs?: number;
  /** The delay never grows beyond this. */
  maxDelayMs?: number;
  logger?: Logger;
  /** Tests pass fake versions of these so they don't really wait or depend on randomness. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps another JsonHttpClient and retries failed calls (this is the Decorator pattern:
 * same interface, extra behaviour, the wrapped client doesn't know).
 *
 * - Only failures that might work next time are retried: timeouts, network errors, 5xx, 429.
 *   A 400 means our request is wrong, so retrying would just waste the provider's quota.
 * - The wait doubles after each attempt (200 ms, 400 ms, 800 ms...), and we pick a random
 *   time up to that limit ("jitter"). Without the randomness, many servers recovering from the
 *   same outage would all retry at the same moment and overload the provider again.
 * - We only make GET requests, so repeating one is always safe.
 */
export class RetryingJsonClient implements JsonHttpClient {
  private inner: JsonHttpClient;
  private maxRetries: number;
  private baseDelayMs: number;
  private maxDelayMs: number;
  private logger: Logger | undefined;
  private sleep: (ms: number) => Promise<void>;
  private random: () => number;

  constructor(inner: JsonHttpClient, options: RetryOptions) {
    this.inner = inner;
    this.maxRetries = options.maxRetries;
    this.baseDelayMs = options.baseDelayMs ?? 200;
    this.maxDelayMs = options.maxDelayMs ?? 2000;
    this.logger = options.logger;
    this.sleep = options.sleep ?? wait;
    this.random = options.random ?? Math.random;
  }

  async getJson(url: URL, serviceName: string): Promise<unknown> {
    // Attempts that can still be retried if they fail.
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await this.inner.getJson(url, serviceName);
      } catch (err) {
        const canRetry = err instanceof HttpRequestError && err.retryable;
        if (!canRetry) {
          throw err;
        }

        const delayMs = this.backoffDelay(attempt);
        this.logger?.warn(
          {
            service: serviceName,
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

    // The last attempt: if this one fails too, the error goes back to the caller.
    return this.inner.getJson(url, serviceName);
  }

  /** A random delay between 0 and (base × 2^attempt), never more than maxDelayMs. */
  backoffDelay(attempt: number): number {
    const limit = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** attempt);
    return Math.round(this.random() * limit);
  }
}
