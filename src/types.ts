/**
 * The core data types used across the app (weather, scores, places).
 * They are plain objects that know nothing about Open-Meteo, MySQL or GraphQL: the provider
 * and repository code converts to and from these types.
 */

// `Activity` and `Rating` work like enums: use `Activity.Skiing` in code, and the type
// `Activity` means "one of these values" ('SKIING' | 'SURFING' | ...).
export const Activity = {
  Skiing: 'SKIING',
  Surfing: 'SURFING',
  OutdoorSightseeing: 'OUTDOOR_SIGHTSEEING',
  IndoorSightseeing: 'INDOOR_SIGHTSEEING',
} as const;
export type Activity = (typeof Activity)[keyof typeof Activity];

export const Rating = {
  Excellent: 'EXCELLENT',
  Good: 'GOOD',
  Fair: 'FAIR',
  Poor: 'POOR',
  NotApplicable: 'NOT_APPLICABLE',
} as const;
export type Rating = (typeof Rating)[keyof typeof Rating];

/** ISO calendar date in the location's local timezone, e.g. "2026-10-07". */
export type IsoDate = string;

/**
 * One day of land weather. Units are fixed (metric) so scorers never convert.
 * Fields Open-Meteo doesn't always provide are nullable; scorers must cope with null.
 */
export interface DailyWeather {
  date: IsoDate;
  /** WMO weather interpretation code (0 = clear ... 99 = thunderstorm with hail). */
  weatherCode: number;
  temperatureMaxC: number;
  temperatureMinC: number;
  precipitationSumMm: number;
  precipitationProbabilityMaxPct: number | null;
  snowfallSumCm: number;
  /** Max of hourly snow depth for the day (Open-Meteo only reports it hourly). */
  snowDepthMaxM: number | null;
  windSpeedMaxKmh: number;
  windGustsMaxKmh: number;
  sunshineDurationS: number | null;
  uvIndexMax: number | null;
}

/** One day of sea state from the Marine API. Absent entirely for inland locations. */
export interface MarineDay {
  date: IsoDate;
  waveHeightMaxM: number | null;
  wavePeriodMaxS: number | null;
  swellWaveHeightMaxM: number | null;
}

/** Everything a scorer may look at for a single day. */
export interface DayConditions {
  weather: DailyWeather;
  marine: MarineDay | null;
}

/** Facts about the place (not the day) that influence suitability. */
export interface LocationContext {
  elevationM: number | null;
}

export interface DayScore {
  date: IsoDate;
  /** 0–100, or null when the activity isn't possible at this location (e.g. surfing inland). */
  score: number | null;
  rating: Rating;
  /** Human-readable explanation of the adjustments, biggest impact first. */
  reasons: string[];
}

export interface ActivityRanking {
  activity: Activity;
  /** 1 = best activity for the week. */
  rank: number;
  weeklyScore: number | null;
  weeklyRating: Rating;
  applicable: boolean;
  bestDay: IsoDate | null;
  days: DayScore[];
}

/** A resolved place, as returned by geocoding. */
export interface GeoLocation {
  id: number;
  name: string;
  /** First-level administrative area, e.g. "Texas" or "Île-de-France". */
  region: string | null;
  country: string | null;
  /** ISO 3166-1 alpha-2, e.g. "FR". */
  countryCode: string | null;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  timezone: string | null;
  population: number | null;
}
