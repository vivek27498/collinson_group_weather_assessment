import type { DailyWeather, DayConditions, GeoLocation, MarineDay } from '../domain/types';

/**
 * Ports: what the application needs from the outside world, in domain terms.
 * Infrastructure adapters (Open-Meteo today, MySQL-backed caches in slice 3) implement them,
 * and tests substitute in-memory fakes. The application never imports an adapter.
 */

export interface LocationQuery {
  readonly name: string;
  /** Optional ISO 3166-1 alpha-2 code to disambiguate ("Paris" + "US"). */
  readonly countryCode?: string;
}

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

export interface Geocoder {
  /** Candidate places, best match first (Open-Meteo ranks by relevance/population). Empty if none. */
  search(query: LocationQuery): Promise<GeoLocation[]>;
}

export interface WeatherForecastProvider {
  /** The next 7 days of daily weather in the location's local timezone. */
  getDailyForecast(at: Coordinates): Promise<DailyWeather[]>;
}

export interface MarineForecastProvider {
  /** The next 7 days of sea state, or null when the point has no marine data (inland). */
  getDailyMarine(at: Coordinates): Promise<MarineDay[] | null>;
}

// ---- Persistence ports (slice 3) ----

/** available: sea data stored. none: inland. unavailable: marine API failed at fetch time. */
export type MarineStatus = 'available' | 'none' | 'unavailable';

/** The persisted forecast for one grid cell: weather + sea state per local day. */
export interface ForecastSnapshot {
  readonly gridKey: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly fetchedAt: Date;
  readonly marineStatus: MarineStatus;
  readonly days: readonly DayConditions[];
}

export interface ForecastRepository {
  get(gridKey: string): Promise<ForecastSnapshot | null>;
  /** Replaces whatever is stored for the snapshot's grid cell, atomically. */
  save(snapshot: ForecastSnapshot): Promise<void>;
}

export interface CachedGeocode {
  /** Best match first. Empty = a cached "no such place". */
  readonly locations: readonly GeoLocation[];
  readonly fetchedAt: Date;
}

export interface GeocodeCache {
  get(queryKey: string): Promise<CachedGeocode | null>;
  put(queryKey: string, locations: readonly GeoLocation[], fetchedAt: Date): Promise<void>;
}
