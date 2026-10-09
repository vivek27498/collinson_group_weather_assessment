import type {
  GeocodeSearch,
  SavedGeocode,
  ForecastRepository,
  ForecastSnapshot,
  GeocodeStore,
} from '../../src/services/interfaces';
import type { GeoLocation } from '../../src/types';

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

export class InMemoryGeocodeStore implements GeocodeStore {
  readonly entries = new Map<string, SavedGeocode>();
  failReads = false;
  failWrites = false;

  get(search: GeocodeSearch): Promise<SavedGeocode | null> {
    if (this.failReads) return Promise.reject(new Error('db down'));
    return Promise.resolve(this.entries.get(keyOf(search)) ?? null);
  }

  put(search: GeocodeSearch, locations: readonly GeoLocation[], fetchedAt: Date): Promise<void> {
    if (this.failWrites) return Promise.reject(new Error('db down'));
    this.entries.set(keyOf(search), { locations: [...locations], fetchedAt });
    return Promise.resolve();
  }
}

/** One Map key per (name, countryCode) pair, like the table's two-column primary key. */
function keyOf(search: GeocodeSearch): string {
  return JSON.stringify([search.name, search.countryCode]);
}

/** A clock tests can move forward explicitly. */
export class FakeClock {
  constructor(private current = new Date('2026-10-07T09:00:00Z')) {}
  now = (): Date => new Date(this.current);
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
