/**
 * Collapses concurrent calls for the same key into one in-flight promise.
 *
 * Without it, 500 simultaneous requests for a city whose cache just expired would make 500
 * identical upstream calls (a cache stampede). With it, they share one call and its result.
 *
 * Scope: one process. Across several instances, each still makes at most one call per key;
 * a distributed lock (MySQL GET_LOCK / Redis) would make it one overall (see ADR-003).
 */
export class SingleFlight<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  run(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }
    const promise = work().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  get size(): number {
    return this.inFlight.size;
  }

  /** Waits for everything currently in flight (used on shutdown, so writes aren't cut off). */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.inFlight.values()]);
  }
}
