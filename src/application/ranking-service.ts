import type { ActivityScorer } from '../domain/scoring/activity-scorer';
import { rankActivities } from '../domain/scoring/rank-activities';
import type { ScoringConfig } from '../domain/scoring/scoring-config';
import type { ActivityRanking, GeoLocation } from '../domain/types';
import type { ErrorDetail } from '../shared/errors/app-error';
import type { ForecastSource } from './forecast-service';
import type { Geocoder, LocationQuery } from './ports';
import { parseRankingInput } from './ranking-input';

export interface RankedForecast {
  readonly kind: 'ranked';
  readonly location: GeoLocation;
  /**
   * Other places with the same name (e.g. Paris, Texas when "Paris" resolved to France), so the
   * caller can spot an ambiguous match and re-query with a countryCode.
   */
  readonly alternatives: readonly GeoLocation[];
  readonly forecastFetchedAt: Date;
  /** True when served from cache past its freshness window (refreshing in the background). */
  readonly isStale: boolean;
  /** Non-fatal problems the caller should know about (e.g. sea data temporarily unavailable). */
  readonly warnings: readonly string[];
  readonly activities: readonly ActivityRanking[];
}

export interface LocationNotFound {
  readonly kind: 'locationNotFound';
  readonly query: LocationQuery;
}

export interface InvalidRankingInput {
  readonly kind: 'invalidInput';
  readonly errors: readonly ErrorDetail[];
}

/**
 * Expected outcomes are values, not exceptions: "we don't know that place" or "that isn't a
 * place name" are normal answers, and the GraphQL schema models them as union members.
 * Exceptions are reserved for genuine failures (provider down, bugs) and go through the
 * shared error policy.
 */
export type RankingOutcome = RankedForecast | LocationNotFound | InvalidRankingInput;

export interface RankingRequest {
  readonly city: string;
  readonly countryCode?: string | null;
}

export const MAX_ALTERNATIVES = 5;

export interface RankingServiceDeps {
  readonly geocoder: Geocoder;
  readonly forecasts: ForecastSource;
  readonly scorers: readonly ActivityScorer[];
  readonly scoringConfig: ScoringConfig;
}

/**
 * Use case: "rank the next 7 days for each activity at this place".
 * Orchestration only: validate → resolve the place → get the (cached) forecast → score.
 * Where the forecast comes from, and how fresh it is, is ForecastService's concern.
 */
export class RankingService {
  constructor(private readonly deps: RankingServiceDeps) {}

  async rank(request: RankingRequest): Promise<RankingOutcome> {
    const parsed = parseRankingInput(request);
    if (!parsed.ok) {
      return { kind: 'invalidInput', errors: parsed.errors };
    }
    const { query } = parsed;

    const candidates = await this.deps.geocoder.search(query);
    const [location] = candidates;
    if (!location) {
      return { kind: 'locationNotFound', query };
    }

    const forecast = await this.deps.forecasts.getForecast(location);
    const activities = rankActivities(
      forecast.days,
      { elevationM: location.elevationM },
      this.deps.scorers,
      this.deps.scoringConfig,
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
 * Geocoding returns fuzzy matches ("Paris" also finds "Parisot"); only places with the *same*
 * name as the chosen one are real ambiguities worth surfacing.
 */
export function sameNameAlternatives(
  chosen: GeoLocation,
  candidates: readonly GeoLocation[],
): GeoLocation[] {
  const key = (name: string) => name.normalize('NFC').toLocaleLowerCase('en');
  return candidates
    .filter((c) => c.id !== chosen.id && key(c.name) === key(chosen.name))
    .slice(0, MAX_ALTERNATIVES);
}
