import { UpstreamUnavailableError } from '../../shared/errors/app-error';

/** Minimal port for "GET this URL and give me parsed JSON". Adapters depend on this, not on fetch. */
export interface JsonHttpClient {
  getJson(url: URL, context: RequestContext): Promise<unknown>;
}

export interface RequestContext {
  /** Logical name of the dependency, for logs/metrics (e.g. "open-meteo.forecast"). */
  readonly upstream: string;
}

export type UpstreamFailure = 'timeout' | 'network' | 'http_status' | 'invalid_response';

/**
 * A call to a dependency failed. It's an UpstreamUnavailableError, so the shared error policy
 * already knows how to present it (503, generic message, logged at error).
 *
 * The technical detail (which upstream, status, retryable?) is kept on the object for
 * logs and the retry decorator, and never shown to the client.
 */
export class UpstreamRequestError extends UpstreamUnavailableError {
  constructor(
    readonly upstream: string,
    readonly failure: UpstreamFailure,
    readonly status: number | undefined,
    readonly retryable: boolean,
    cause?: unknown,
  ) {
    super('The weather provider is temporarily unavailable', {
      code: 'UPSTREAM_UNAVAILABLE',
      cause,
    });
  }
}

/** 5xx and 429 are worth retrying; other 4xx mean *our* request is wrong, and retrying won't help. */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

export interface FetchJsonClientOptions {
  readonly timeoutMs: number;
  /** Injected for tests; defaults to Node's global fetch. */
  readonly fetchFn?: typeof fetch;
}

/**
 * The plain client: one attempt, bounded by a timeout, classified failures.
 * Retries are added by wrapping it (see RetryingJsonClient). That's the Decorator pattern.
 */
export class FetchJsonClient implements JsonHttpClient {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: FetchJsonClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async getJson(url: URL, { upstream }: RequestContext): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (err) {
      // Check the name, not `instanceof`: the abort reason is a DOMException, which may come
      // from another realm (e.g. a test sandbox), where `instanceof Error` is false.
      const timedOut =
        typeof err === 'object' && err !== null && 'name' in err && err.name === 'TimeoutError';
      throw new UpstreamRequestError(
        upstream,
        timedOut ? 'timeout' : 'network',
        undefined,
        true,
        err,
      );
    }

    if (!response.ok) {
      // Drain the body so the connection can be reused; keep a short excerpt for logs.
      const excerpt = (await response.text().catch(() => '')).slice(0, 200);
      throw new UpstreamRequestError(
        upstream,
        'http_status',
        response.status,
        isRetryableStatus(response.status),
        new Error(`HTTP ${response.status}: ${excerpt}`),
      );
    }

    try {
      return await response.json();
    } catch (err) {
      throw new UpstreamRequestError(upstream, 'invalid_response', response.status, false, err);
    }
  }
}
