import type { DayConditions, MarineDay } from '../../types';
import type { Logger } from '../../modules/logger';
import type { Clock } from '../../utils/clock';
import type {
  Coordinates,
  ForecastRepository,
  ForecastSnapshot,
  MarineForecastProvider,
  MarineStatus,
  WeatherForecastProvider,
} from '../interfaces';
import { RequestDeduplicator } from '../../utils/request-deduplicator';

/** What the ranking needs: the days to score, and how fresh the data is. */
export interface Forecast {
  days: DayConditions[];
  fetchedAt: Date;
  /** True when we served older data while fetching a fresh copy in the background. */
  isStale: boolean;
  warnings: string[];
}

export interface ForecastSource {
  getForecast(at: Coordinates): Promise<Forecast>;
}

/** How long cached forecasts are used for. */
export interface ForecastCachePolicy {
  /** A forecast younger than this is served as-is (Open-Meteo updates every few hours). */
  freshForMs: number;
  /** Shorter freshness when the sea data failed to load, so we try again sooner. */
  degradedFreshForMs: number;
  /** A forecast older than this is never served: we must fetch a new one (or fail). */
  maxStaleMs: number;
}

export interface ForecastServiceOptions {
  repository: ForecastRepository;
  weather: WeatherForecastProvider;
  marine: MarineForecastProvider;
  clock: Clock;
  logger: Logger;
  policy: ForecastCachePolicy;
}

export const MARINE_UNAVAILABLE_WARNING =
  'Sea-state data is temporarily unavailable, so surfing could not be scored.';

/** A square of roughly 11 km × 11 km, identified by rounded coordinates. */
export interface GridCell {
  key: string;
  latitude: number;
  longitude: number;
}

/**
 * Rounds coordinates to 1 decimal place (about 11 km). Nearby places such as Biarritz and Anglet
 * land in the same cell, so they share one cache entry and one call to Open-Meteo.
 * That's still finer than the weather model itself, so no accuracy is lost.
 */
export function gridCell({ latitude, longitude }: Coordinates): GridCell {
  // "+ 0" turns -0 into 0, so we never get a key like "-0.0".
  const round = (value: number) => Math.round(value * 10) / 10 + 0;
  const lat = round(latitude);
  const lon = round(longitude);
  return { key: `${lat.toFixed(1)},${lon.toFixed(1)}`, latitude: lat, longitude: lon };
}

/**
 * Gets forecasts, using MySQL as a cache in front of Open-Meteo (see ADR-003):
 *
 *   younger than 3 h   → serve from MySQL
 *   3 h to 24 h old    → serve it now (isStale = true) and fetch a fresh copy in the background
 *   missing or older   → fetch from Open-Meteo now, save it, serve it
 *
 * If many requests need the same fresh data at once, only one call goes to Open-Meteo.
 * If MySQL is down we still answer, by going straight to Open-Meteo.
 */
export class ForecastService implements ForecastSource {
  private repository: ForecastRepository;
  private weather: WeatherForecastProvider;
  private marine: MarineForecastProvider;
  private clock: Clock;
  private logger: Logger;
  private policy: ForecastCachePolicy;
  private fetches = new RequestDeduplicator<ForecastSnapshot>();

  constructor(options: ForecastServiceOptions) {
    this.repository = options.repository;
    this.weather = options.weather;
    this.marine = options.marine;
    this.clock = options.clock;
    this.logger = options.logger;
    this.policy = options.policy;
  }

  async getForecast(at: Coordinates): Promise<Forecast> {
    const cell = gridCell(at);
    const cached = await this.readFromDb(cell.key);

    if (cached) {
      const ageMs = this.clock.now().getTime() - cached.fetchedAt.getTime();
      const ageSeconds = Math.round(ageMs / 1000);

      // Fresh enough: serve it.
      if (ageMs < this.freshForMs(cached)) {
        this.logger.info(
          { source: 'cache', gridKey: cell.key, ageSeconds },
          'Forecast served from cache (MySQL)',
        );
        return toForecast(cached, false);
      }

      // A bit old but still usable: serve it now, refresh in the background.
      if (ageMs < this.policy.maxStaleMs) {
        this.logger.info(
          { source: 'cache-stale', gridKey: cell.key, ageSeconds },
          'Forecast served STALE from cache; refreshing from Open-Meteo in the background',
        );
        this.refreshInBackground(cell);
        return toForecast(cached, true);
      }
    }

    // Nothing usable in the cache: fetch now and make the caller wait.
    const reason = cached ? 'expired' : 'miss';
    this.logger.info(
      { source: 'open-meteo', gridKey: cell.key, reason },
      reason === 'miss'
        ? 'Forecast not in cache; fetching live from Open-Meteo'
        : 'Cached forecast too old to serve; fetching live from Open-Meteo',
    );
    const snapshot = await this.fetchOnce(cell);
    return toForecast(snapshot, false);
  }

  /** Waits until every running fetch (including background ones) has finished. */
  drain(): Promise<void> {
    return this.fetches.drain();
  }

  private freshForMs(snapshot: ForecastSnapshot): number {
    if (snapshot.marineStatus === 'unavailable') {
      return this.policy.degradedFreshForMs;
    }
    return this.policy.freshForMs;
  }

  /** Fetches the cell, sharing the call if another request is already fetching it. */
  private fetchOnce(cell: GridCell): Promise<ForecastSnapshot> {
    return this.fetches.run(cell.key, () => this.fetchAndSave(cell));
  }

  private refreshInBackground(cell: GridCell): void {
    // Not awaited on purpose. The caller already has (stale) data, so a failure here is only
    // a warning; the next request will simply try again.
    this.fetchOnce(cell).catch((err: unknown) => {
      this.logger.warn({ err, gridKey: cell.key }, 'Background forecast refresh failed');
    });
  }

  private async fetchAndSave(cell: GridCell): Promise<ForecastSnapshot> {
    const startedAt = Date.now();

    // Weather and sea data are fetched at the same time.
    const [weatherDays, marine] = await Promise.all([
      this.weather.getDailyForecast(cell),
      this.fetchMarine(cell),
    ]);

    const snapshot: ForecastSnapshot = {
      gridKey: cell.key,
      latitude: cell.latitude,
      longitude: cell.longitude,
      fetchedAt: this.clock.now(),
      marineStatus: marine.status,
      days: joinByDate(weatherDays, marine.days),
    };

    try {
      await this.repository.save(snapshot);
    } catch (err) {
      // Saving failed, but we still have the data: serve it, and fetch again next time.
      this.logger.error({ err, gridKey: cell.key }, 'Failed to persist forecast snapshot');
    }

    this.logger.info(
      {
        source: 'open-meteo',
        gridKey: cell.key,
        durationMs: Date.now() - startedAt,
        days: snapshot.days.length,
        marineStatus: snapshot.marineStatus,
      },
      'Forecast fetched live from Open-Meteo and stored in cache',
    );
    return snapshot;
  }

  /**
   * Sea data is optional. If it fails, only surfing is affected, so we never throw here:
   * we return status 'unavailable' and the rest of the answer still works.
   */
  private async fetchMarine(
    cell: GridCell,
  ): Promise<{ status: MarineStatus; days: MarineDay[] | null }> {
    try {
      const days = await this.marine.getDailyMarine(cell);
      if (days === null) {
        return { status: 'none', days: null }; // inland: there is no sea here
      }
      return { status: 'available', days };
    } catch (err) {
      this.logger.warn({ err, gridKey: cell.key }, 'Marine forecast unavailable');
      return { status: 'unavailable', days: null };
    }
  }

  /** Reads the cache. If MySQL fails we treat it as "not cached" instead of failing the request. */
  private async readFromDb(gridKey: string): Promise<ForecastSnapshot | null> {
    try {
      return await this.repository.get(gridKey);
    } catch (err) {
      this.logger.error({ err, gridKey }, 'Forecast cache read failed, reading through');
      return null;
    }
  }
}

function toForecast(snapshot: ForecastSnapshot, isStale: boolean): Forecast {
  const warnings = snapshot.marineStatus === 'unavailable' ? [MARINE_UNAVAILABLE_WARNING] : [];
  return { days: snapshot.days, fetchedAt: snapshot.fetchedAt, isStale, warnings };
}

/** Pairs each weather day with the sea data for the same date (or null if there is none). */
export function joinByDate(
  weatherDays: DayConditions['weather'][],
  marineDays: MarineDay[] | null,
): DayConditions[] {
  const marineByDate = new Map<string, MarineDay>();
  for (const day of marineDays ?? []) {
    marineByDate.set(day.date, day);
  }
  return weatherDays.map((weather) => ({
    weather,
    marine: marineByDate.get(weather.date) ?? null,
  }));
}
