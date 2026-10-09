import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { UpstreamUnavailableError } from '../errors';

/** Minimal port for "GET this URL and give me parsed JSON". Adapters depend on this, not on axios. */
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

export interface AxiosJsonClientOptions {
  readonly timeoutMs: number;
}

/**
 * The plain client: one attempt with axios, bounded by a timeout, failures classified.
 * Retries are added by wrapping it (see RetryingJsonClient). That's the Decorator pattern.
 *
 * axios is configured to hand us the raw response (any status, body as text) so that *we*
 * decide what counts as a failure. By default axios throws on non-2xx statuses and quietly
 * returns invalid JSON as a string; here every outcome maps to one of our failure classes.
 */
export class AxiosJsonClient implements JsonHttpClient {
  private readonly http: AxiosInstance;

  constructor(options: AxiosJsonClientOptions) {
    this.http = axios.create({
      timeout: options.timeoutMs,
      headers: { accept: 'application/json' },
      responseType: 'text',
      transformResponse: [(data: unknown) => data], // keep the raw body; we parse it below
      validateStatus: () => true, // statuses are classified below, not thrown by axios
      transitional: { clarifyTimeoutError: true }, // timeouts surface as ETIMEDOUT
    });
  }

  async getJson(url: URL, { upstream }: RequestContext): Promise<unknown> {
    let response: AxiosResponse<string>;
    try {
      response = await this.http.get<string>(url.toString());
    } catch (err) {
      const timedOut =
        axios.isAxiosError(err) && (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED');
      throw new UpstreamRequestError(
        upstream,
        timedOut ? 'timeout' : 'network',
        undefined,
        true,
        err,
      );
    }

    if (response.status < 200 || response.status >= 300) {
      // Keep a short excerpt of the body for logs; it is never shown to the client.
      const excerpt = response.data.slice(0, 200);
      throw new UpstreamRequestError(
        upstream,
        'http_status',
        response.status,
        isRetryableStatus(response.status),
        new Error(`HTTP ${response.status}: ${excerpt}`),
      );
    }

    try {
      return JSON.parse(response.data) as unknown;
    } catch (err) {
      throw new UpstreamRequestError(upstream, 'invalid_response', response.status, false, err);
    }
  }
}
