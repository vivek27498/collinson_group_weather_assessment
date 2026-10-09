import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { UpstreamUnavailableError } from '../errors';

/**
 * Anything that can "GET this URL and give me back parsed JSON".
 * The Open-Meteo code depends on this interface, not on axios, so the HTTP library can be swapped.
 */
export interface JsonHttpClient {
  /** `serviceName` is only used in logs and errors, e.g. "open-meteo.forecast". */
  getJson(url: URL, serviceName: string): Promise<unknown>;
}

/** The ways an HTTP call can fail. */
export type HttpFailure = 'timeout' | 'network' | 'http_status' | 'invalid_response';

/**
 * Thrown when a call to an external service fails.
 *
 * It extends UpstreamUnavailableError, so the client only ever sees the generic message below
 * (HTTP 503). The technical details (which service, status code, can we retry?) stay on the
 * error object for our logs and the retry logic.
 */
export class HttpRequestError extends UpstreamUnavailableError {
  serviceName: string;
  failure: HttpFailure;
  status: number | undefined;
  retryable: boolean;

  constructor(
    serviceName: string,
    failure: HttpFailure,
    status: number | undefined,
    retryable: boolean,
    cause?: unknown,
  ) {
    super('The weather provider is temporarily unavailable', {
      code: 'UPSTREAM_UNAVAILABLE',
      cause,
    });
    this.serviceName = serviceName;
    this.failure = failure;
    this.status = status;
    this.retryable = retryable;
  }
}

/** 5xx and 429 (too many requests) may work on a retry. Other 4xx mean our request is wrong. */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

export interface AxiosJsonClientOptions {
  timeoutMs: number;
}

/**
 * Makes ONE request with axios, with a timeout, and turns every failure into an HttpRequestError.
 * Retries are added separately by RetryingJsonClient, which wraps this class.
 *
 * By default axios throws on any non-2xx status and silently returns invalid JSON as a string.
 * We switch both off and check the response ourselves, so every failure gets the right type.
 */
export class AxiosJsonClient implements JsonHttpClient {
  private http: AxiosInstance;

  constructor(options: AxiosJsonClientOptions) {
    this.http = axios.create({
      timeout: options.timeoutMs,
      headers: { accept: 'application/json' },
      responseType: 'text', // give us the raw body as text...
      transformResponse: [(data: unknown) => data], // ...and don't try to parse it
      validateStatus: () => true, // don't throw on 4xx/5xx; we check the status below
      transitional: { clarifyTimeoutError: true }, // report timeouts as ETIMEDOUT
    });
  }

  async getJson(url: URL, serviceName: string): Promise<unknown> {
    // 1. Send the request. If it throws, we never got a response: timeout or network problem.
    let response: AxiosResponse<string>;
    try {
      response = await this.http.get<string>(url.toString());
    } catch (err) {
      const isTimeout =
        axios.isAxiosError(err) && (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED');
      const failure = isTimeout ? 'timeout' : 'network';
      throw new HttpRequestError(serviceName, failure, undefined, true, err);
    }

    // 2. We got a response, but with an error status.
    const isSuccess = response.status >= 200 && response.status < 300;
    if (!isSuccess) {
      // Keep the start of the body for our logs. The client never sees it.
      const bodyStart = response.data.slice(0, 200);
      throw new HttpRequestError(
        serviceName,
        'http_status',
        response.status,
        isRetryableStatus(response.status),
        new Error(`HTTP ${response.status}: ${bodyStart}`),
      );
    }

    // 3. Success status, but the body must still be valid JSON.
    try {
      return JSON.parse(response.data) as unknown;
    } catch (err) {
      throw new HttpRequestError(serviceName, 'invalid_response', response.status, false, err);
    }
  }
}
