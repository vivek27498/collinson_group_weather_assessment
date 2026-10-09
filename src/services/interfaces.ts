import type { DailyWeather, DayConditions, GeoLocation, MarineDay } from '../types';

/**
 * Interfaces for everything the services need from the outside world: weather data and storage.
 *
 * The services only use these interfaces, never Open-Meteo or Prisma directly.
 *  - The real implementations live in src/providers/ (Open-Meteo) and src/repositories/ (MySQL).
 *  - Tests use simple in-memory versions instead.
 *  - Switching weather provider means writing new implementations; the services don't change.
 * (In architecture terms these are the "ports" of a ports-and-adapters design.)
 */

export interface LocationQuery {
  name: string;
  /** Optional ISO 3166-1 alpha-2 code to disambiguate ("Paris" + "US"). */
  countryCode?: string;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
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

// ---- Storage (MySQL in production, in-memory in tests) ----

/** available: sea data stored. none: inland. unavailable: marine API failed at fetch time. */
export type MarineStatus = 'available' | 'none' | 'unavailable';

/** The persisted forecast for one grid cell: weather + sea state per local day. */
export interface ForecastSnapshot {
  gridKey: string;
  latitude: number;
  longitude: number;
  fetchedAt: Date;
  marineStatus: MarineStatus;
  days: DayConditions[];
}

export interface ForecastRepository {
  get(gridKey: string): Promise<ForecastSnapshot | null>;
  /** Replaces whatever is stored for this grid cell, all in one transaction. */
  save(snapshot: ForecastSnapshot): Promise<void>;
}

export interface SavedGeocode {
  /** Best match first. Empty = a cached "no such place". */
  locations: GeoLocation[];
  fetchedAt: Date;
}

/** A search as saved in the database: e.g. { name: 'paris', countryCode: 'US' }. */
export interface GeocodeSearch {
  /** The place name, lower-cased so "Paris" and "paris" are the same search. */
  name: string;
  /** The country filter, or '' when the user didn't give one. */
  countryCode: string;
}

export interface GeocodeStore {
  get(search: GeocodeSearch): Promise<SavedGeocode | null>;
  put(search: GeocodeSearch, locations: GeoLocation[], fetchedAt: Date): Promise<void>;
}
