import type { DayConditions, MarineDay } from '../domain/types';
import type { Logger } from '../observability/logger';
import type { Clock } from './clock';
import type {
  Coordinates,
  ForecastRepository,
  ForecastSnapshot,
  MarineForecastProvider,
  MarineStatus,
  WeatherForecastProvider,
} from './ports';
import { SingleFlight } from './single-flight';

/** What the ranking use case needs: days to score, plus how fresh they are. */
export interface Forecast {
  readonly days: readonly DayConditions[];
  readonly fetchedAt: Date;
  /** Served past its freshness window while a refresh happens in the background. */
  readonly isStale: boolean;
  readonly warnings: readonly string[];
}

export interface ForecastSource {
  getForecast(at: Coordinates): Promise<Forecast>;
}

export interface ForecastCachePolicy {
  /** How long a complete snapshot counts as fresh (Open-Meteo updates its models every few hours). */
  readonly freshForMs: number;
  /** Shorter freshness when the marine API failed at fetch time, so we retry it sooner. */
  readonly degradedFreshForMs: number;
  /** Beyond this age a snapshot is never served: we fetch synchronously (or fail). */
  readonly maxStaleMs: number;
}

export interface ForecastServiceDeps {
  readonly repository: ForecastRepository;
  readonly weather: WeatherForecastProvider;
  readonly marine: MarineForecastProvider;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly policy: ForecastCachePolicy;
}

export const MARINE_UNAVAILABLE_WARNING =
  'Sea-state data is temporarily unavailable, so surfing could not be scored.';

/**
 * A ~11 km grid cell. Nearby places (and different spellings of the same place) share one
 * cache entry and one upstream call. Weather is fetched for the cell centre, so everyone in
 * the cell sees identical data. A 0.1° cell is well within a forecast model's resolution.
 */
export function gridCell({ latitude, longitude }: Coordinates) {
  const round = (value: number) => Math.round(value * 10) / 10 + 0; // "+ 0" turns -0 into 0
  const lat = round(latitude);
  const lon = round(longitude);
  return { key: `${lat.toFixed(1)},${lon.toFixed(1)}`, latitude: lat, longitude: lon };
}
type GridCell = ReturnType<typeof gridCell>;

/**
 * Cache-aside with stale-while-revalidate and single-flight (ADR-003):
 *
 *   age < freshFor           → serve from MySQL                                  (hit)
 *   freshFor ≤ age < maxStale → serve stale now, refresh in the background      (stale)
 *   missing or age ≥ maxStale → fetch from Open-Meteo, store, serve             (miss/expired)
 *
 * Concurrent refreshes for the same cell share one upstream call. The database is an
 * optimisation, not a dependency: if it's down, we read through to the provider.
 */
export class ForecastService implements ForecastSource {
  private readonly flights = new SingleFlight<ForecastSnapshot>();

  constructor(private readonly deps: ForecastServiceDeps) {}

  async getForecast(at: Coordinates): Promise<Forecast> {
    const cell = gridCell(at);
    const cached = await this.readCache(cell.key);

    if (cached) {
      const age = this.deps.clock.now().getTime() - cached.fetchedAt.getTime();
      const ageSeconds = Math.round(age / 1000);
      if (age < this.freshFor(cached)) {
        this.deps.logger.info(
          { source: 'cache', gridKey: cell.key, ageSeconds },
          'Forecast served from cache (MySQL)',
        );
        return toForecast(cached, false);
      }
      if (age < this.deps.policy.maxStaleMs) {
        this.deps.logger.info(
          { source: 'cache-stale', gridKey: cell.key, ageSeconds },
          'Forecast served STALE from cache; refreshing from Open-Meteo in the background',
        );
        this.refreshInBackground(cell);
        return toForecast(cached, true);
      }
    }

    const reason = cached ? 'expired' : 'miss';
    this.deps.logger.info(
      { source: 'open-meteo', gridKey: cell.key, reason },
      reason === 'miss'
        ? 'Forecast not in cache; fetching live from Open-Meteo'
        : 'Cached forecast too old to serve; fetching live from Open-Meteo',
    );
    return toForecast(await this.refresh(cell), false);
  }

  /** Resolves when all in-flight refreshes (including background ones) have finished. */
  drain(): Promise<void> {
    return this.flights.drain();
  }

  private freshFor(snapshot: ForecastSnapshot): number {
    return snapshot.marineStatus === 'unavailable'
      ? this.deps.policy.degradedFreshForMs
      : this.deps.policy.freshForMs;
  }

  private refresh(cell: GridCell): Promise<ForecastSnapshot> {
    return this.flights.run(cell.key, () => this.fetchAndStore(cell));
  }

  private refreshInBackground(cell: GridCell): void {
    this.refresh(cell).catch((err: unknown) => {
      // The caller already has (stale) data; a failed background refresh is worth a warning,
      // not an error response. The next request will try again.
      this.deps.logger.warn({ err, gridKey: cell.key }, 'Background forecast refresh failed');
    });
  }

  private async fetchAndStore(cell: GridCell): Promise<ForecastSnapshot> {
    const started = Date.now();
    const [weather, marine] = await Promise.all([
      this.deps.weather.getDailyForecast(cell),
      this.fetchMarine(cell),
    ]);
    const snapshot: ForecastSnapshot = {
      gridKey: cell.key,
      latitude: cell.latitude,
      longitude: cell.longitude,
      fetchedAt: this.deps.clock.now(),
      marineStatus: marine.status,
      days: joinByDate(weather, marine.days),
    };

    try {
      await this.deps.repository.save(snapshot);
    } catch (err) {
      // Still serve what we fetched; we'll simply fetch again next time.
      this.deps.logger.error({ err, gridKey: cell.key }, 'Failed to persist forecast snapshot');
    }
    this.deps.logger.info(
      {
        source: 'open-meteo',
        gridKey: cell.key,
        durationMs: Date.now() - started,
        days: snapshot.days.length,
        marineStatus: snapshot.marineStatus,
      },
      'Forecast fetched live from Open-Meteo and stored in cache',
    );
    return snapshot;
  }

  /** Sea data is optional: its failure degrades surfing only, never the whole response. */
  private async fetchMarine(
    cell: GridCell,
  ): Promise<{ status: MarineStatus; days: MarineDay[] | null }> {
    try {
      const days = await this.deps.marine.getDailyMarine(cell);
      return { status: days ? 'available' : 'none', days };
    } catch (err) {
      this.deps.logger.warn({ err, gridKey: cell.key }, 'Marine forecast unavailable');
      return { status: 'unavailable', days: null };
    }
  }

  private async readCache(gridKey: string): Promise<ForecastSnapshot | null> {
    try {
      return await this.deps.repository.get(gridKey);
    } catch (err) {
      this.deps.logger.error({ err, gridKey }, 'Forecast cache read failed, reading through');
      return null;
    }
  }
}

function toForecast(snapshot: ForecastSnapshot, isStale: boolean): Forecast {
  return {
    days: snapshot.days,
    fetchedAt: snapshot.fetchedAt,
    isStale,
    warnings: snapshot.marineStatus === 'unavailable' ? [MARINE_UNAVAILABLE_WARNING] : [],
  };
}

/** Pairs each weather day with the marine day of the same date (if any). */
export function joinByDate(
  weather: readonly DayConditions['weather'][],
  marine: readonly MarineDay[] | null,
): DayConditions[] {
  const marineByDate = new Map((marine ?? []).map((m) => [m.date, m]));
  return weather.map((w) => ({ weather: w, marine: marineByDate.get(w.date) ?? null }));
}
