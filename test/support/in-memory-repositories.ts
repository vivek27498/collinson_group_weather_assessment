import type {
  CachedGeocode,
  ForecastRepository,
  ForecastSnapshot,
  GeocodeCache,
} from '../../src/application/ports';
import type { GeoLocation } from '../../src/domain/types';

/**
 * In-memory implementations of the persistence ports. Because the application only depends on
 * the ports, the same tests that run here could run against MySQL. The Testcontainers
 * integration tests do exactly that for the Prisma adapters.
 */
export class InMemoryForecastRepository implements ForecastRepository {
  readonly snapshots = new Map<string, ForecastSnapshot>();
  failReads = false;
  failWrites = false;
  saves = 0;

  get(gridKey: string): Promise<ForecastSnapshot | null> {
    if (this.failReads) return Promise.reject(new Error('db down'));
    return Promise.resolve(this.snapshots.get(gridKey) ?? null);
  }

  save(snapshot: ForecastSnapshot): Promise<void> {
    if (this.failWrites) return Promise.reject(new Error('db down'));
    this.saves++;
    this.snapshots.set(snapshot.gridKey, snapshot);
    return Promise.resolve();
  }
}

export class InMemoryGeocodeCache implements GeocodeCache {
  readonly entries = new Map<string, CachedGeocode>();
  failReads = false;
  failWrites = false;

  get(queryKey: string): Promise<CachedGeocode | null> {
    if (this.failReads) return Promise.reject(new Error('db down'));
    return Promise.resolve(this.entries.get(queryKey) ?? null);
  }

  put(queryKey: string, locations: readonly GeoLocation[], fetchedAt: Date): Promise<void> {
    if (this.failWrites) return Promise.reject(new Error('db down'));
    this.entries.set(queryKey, { locations: [...locations], fetchedAt });
    return Promise.resolve();
  }
}

/** A clock tests can move forward explicitly. */
export class FakeClock {
  constructor(private current = new Date('2026-10-07T09:00:00Z')) {}
  now = (): Date => new Date(this.current);
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
