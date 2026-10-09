import type { ActivityScorer } from '../scoring/activity-scorer';
import { rankActivities } from '../scoring/rank-activities';
import type { ScoringConfig } from '../config/scoring';
import type { ActivityRanking, GeoLocation } from '../types';
import type { ErrorDetail } from '../modules/errors';
import type { ForecastSource } from './forecast-service';
import type { Geocoder, LocationQuery } from './interfaces';
import { parseRankingInput } from './ranking-input';

// The three possible answers. `kind` tells them apart.

/** Success: the place we found and its ranked activities. */
export interface RankedForecast {
  kind: 'ranked';
  location: GeoLocation;
  /**
   * Other places with exactly the same name (e.g. Paris, Texas when we picked Paris, France),
   * so the user can see the name was ambiguous and search again with a countryCode.
   */
  alternatives: GeoLocation[];
  forecastFetchedAt: Date;
  /** True when we served older cached data while refreshing it in the background. */
  isStale: boolean;
  /** Problems that didn't stop the answer (e.g. sea data unavailable, so no surfing score). */
  warnings: string[];
  activities: ActivityRanking[];
}

/** No place matches the name. */
export interface LocationNotFound {
  kind: 'locationNotFound';
  query: LocationQuery;
}

/** The input wasn't valid (e.g. empty city, or characters a place name can't contain). */
export interface InvalidRankingInput {
  kind: 'invalidInput';
  errors: ErrorDetail[];
}

/**
 * "Not found" and "invalid input" are normal answers, so we RETURN them rather than throw.
 * Exceptions are only for real failures (Open-Meteo down, a bug), which go through the
 * shared error handling. The GraphQL schema has the same three cases as a union type.
 */
export type RankingOutcome = RankedForecast | LocationNotFound | InvalidRankingInput;

export interface RankingRequest {
  city: string;
  countryCode?: string | null;
}

export const MAX_ALTERNATIVES = 5;

export interface RankingServiceOptions {
  geocoder: Geocoder;
  forecasts: ForecastSource;
  scorers: ActivityScorer[];
  scoringConfig: ScoringConfig;
}

/**
 * The main use case: "rank the next 7 days for each activity at this place".
 * It only coordinates the steps: check the input → find the place → get the forecast → score.
 * Caching and freshness are handled inside ForecastService.
 */
export class RankingService {
  private geocoder: Geocoder;
  private forecasts: ForecastSource;
  private scorers: ActivityScorer[];
  private scoringConfig: ScoringConfig;

  constructor(options: RankingServiceOptions) {
    this.geocoder = options.geocoder;
    this.forecasts = options.forecasts;
    this.scorers = options.scorers;
    this.scoringConfig = options.scoringConfig;
  }

  async rank(request: RankingRequest): Promise<RankingOutcome> {
    // 1. Validate and clean up the input.
    const parsed = parseRankingInput(request);
    if (!parsed.ok) {
      return { kind: 'invalidInput', errors: parsed.errors };
    }
    const query = parsed.query;

    // 2. Find the place. Candidates come best match first, so we take the first one.
    const candidates = await this.geocoder.search(query);
    const location = candidates[0];
    if (!location) {
      return { kind: 'locationNotFound', query };
    }

    // 3. Get the forecast (usually from the cache).
    const forecast = await this.forecasts.getForecast(location);

    // 4. Score every activity for every day and rank them.
    const activities = rankActivities(
      forecast.days,
      { elevationM: location.elevationM },
      this.scorers,
      this.scoringConfig,
    );

    return {
      kind: 'ranked',
      location,
      alternatives: sameNameAlternatives(location, candidates),
      forecastFetchedAt: forecast.fetchedAt,
      isStale: forecast.isStale,
      warnings: forecast.warnings,
      activities,
    };
  }
}

/**
 * Geocoding also returns partial matches ("Paris" finds "Parisot"). Only places with exactly the
 * same name as the one we picked are real alternatives worth showing.
 */
export function sameNameAlternatives(
  chosen: GeoLocation,
  candidates: GeoLocation[],
): GeoLocation[] {
  const simplify = (name: string) => name.normalize('NFC').toLocaleLowerCase('en');
  return candidates
    .filter((c) => c.id !== chosen.id && simplify(c.name) === simplify(chosen.name))
    .slice(0, MAX_ALTERNATIVES);
}
