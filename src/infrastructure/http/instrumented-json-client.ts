import { UpstreamRequestError, type JsonHttpClient, type RequestContext } from './json-http-client';

export interface UpstreamObserver {
  /** Called once per attempt (so retries are visible as separate observations). */
  attempt(upstream: string, outcome: string, durationSeconds: number): void;
}

/**
 * Decorator: measures every attempt against a dependency. It sits *inside* the retry decorator,
 * so the chain is Retrying(Instrumented(Fetch)) and each retry is timed separately. Three
 * single-purpose wrappers instead of one client that does everything.
 */
export class InstrumentedJsonClient implements JsonHttpClient {
  constructor(
    private readonly inner: JsonHttpClient,
    private readonly observer: UpstreamObserver,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async getJson(url: URL, context: RequestContext): Promise<unknown> {
    const started = this.now();
    try {
      const result = await this.inner.getJson(url, context);
      this.record(context.upstream, 'success', started);
      return result;
    } catch (err) {
      this.record(
        context.upstream,
        err instanceof UpstreamRequestError ? err.failure : 'error',
        started,
      );
      throw err;
    }
  }

  private record(upstream: string, outcome: string, started: number): void {
    this.observer.attempt(upstream, outcome, (this.now() - started) / 1000);
  }
}
