/**
 * Domain model. Plain, immutable data with no knowledge of Open-Meteo's wire format,
 * MySQL or GraphQL. Adapters translate into these types at the edges.
 */

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
  readonly date: IsoDate;
  /** WMO weather interpretation code (0 = clear ... 99 = thunderstorm with hail). */
  readonly weatherCode: number;
  readonly temperatureMaxC: number;
  readonly temperatureMinC: number;
  readonly precipitationSumMm: number;
  readonly precipitationProbabilityMaxPct: number | null;
  readonly snowfallSumCm: number;
  /** Max of hourly snow depth for the day (Open-Meteo only reports it hourly). */
  readonly snowDepthMaxM: number | null;
  readonly windSpeedMaxKmh: number;
  readonly windGustsMaxKmh: number;
  readonly sunshineDurationS: number | null;
  readonly uvIndexMax: number | null;
}

/** One day of sea state from the Marine API. Absent entirely for inland locations. */
export interface MarineDay {
  readonly date: IsoDate;
  readonly waveHeightMaxM: number | null;
  readonly wavePeriodMaxS: number | null;
  readonly swellWaveHeightMaxM: number | null;
}

/** Everything a scorer may look at for a single day. */
export interface DayConditions {
  readonly weather: DailyWeather;
  readonly marine: MarineDay | null;
}

/** Facts about the place (not the day) that influence suitability. */
export interface LocationContext {
  readonly elevationM: number | null;
}

export interface DayScore {
  readonly date: IsoDate;
  /** 0–100, or null when the activity isn't possible at this location (e.g. surfing inland). */
  readonly score: number | null;
  readonly rating: Rating;
  /** Human-readable explanation of the adjustments, biggest impact first. */
  readonly reasons: readonly string[];
}

export interface ActivityRanking {
  readonly activity: Activity;
  /** 1 = best activity for the week. */
  readonly rank: number;
  readonly weeklyScore: number | null;
  readonly weeklyRating: Rating;
  readonly applicable: boolean;
  readonly bestDay: IsoDate | null;
  readonly days: readonly DayScore[];
}

/** A resolved place, as returned by geocoding. */
export interface GeoLocation {
  readonly id: number;
  readonly name: string;
  /** First-level administrative area, e.g. "Texas" or "Île-de-France". */
  readonly region: string | null;
  readonly country: string | null;
  /** ISO 3166-1 alpha-2, e.g. "FR". */
  readonly countryCode: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly elevationM: number | null;
  readonly timezone: string | null;
  readonly population: number | null;
}
