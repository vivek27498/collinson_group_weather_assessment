/**
 * Makes sure identical work runs only once at a time (also known as "single-flight").
 *
 * Example: 200 requests for the same new city arrive together. Without this, each would call
 * Open-Meteo (200 calls, a "cache stampede"). With it, the first request starts the call and
 * the other 199 wait for that same result: 1 call in total.
 *
 * This only works inside one Node process. With several servers, each makes at most one call;
 * a shared lock (MySQL GET_LOCK or Redis) would be needed to make it one overall (see ADR-003).
 */
export class RequestDeduplicator<T> {
  /** Work that is currently running, by key (e.g. a grid cell "43.5,-1.6"). */
  private inProgress = new Map<string, Promise<T>>();

  run(key: string, work: () => Promise<T>): Promise<T> {
    // Someone is already doing this work: wait for their result instead of repeating it.
    const alreadyRunning = this.inProgress.get(key);
    if (alreadyRunning) {
      return alreadyRunning;
    }

    // Start the work, and forget it once it finishes (whether it succeeded or failed).
    const promise = work().finally(() => {
      this.inProgress.delete(key);
    });
    this.inProgress.set(key, promise);
    return promise;
  }

  get size(): number {
    return this.inProgress.size;
  }

  /** Waits for all running work to finish. Used on shutdown so database writes aren't cut off. */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.inProgress.values()]);
  }
}
