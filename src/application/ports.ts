import type { DailyWeather, GeoLocation, MarineDay } from '../domain/types';

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
