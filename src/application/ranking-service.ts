import type { ActivityScorer } from '../domain/scoring/activity-scorer';
import { rankActivities } from '../domain/scoring/rank-activities';
import type { ScoringConfig } from '../domain/scoring/scoring-config';
import type { ActivityRanking, DayConditions, GeoLocation, MarineDay } from '../domain/types';
import type { Logger } from '../observability/logger';
import type { ErrorDetail } from '../shared/errors/app-error';
import type { Clock } from './clock';
import type {
  Geocoder,
  LocationQuery,
  MarineForecastProvider,
  WeatherForecastProvider,
} from './ports';
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
  /** True when served from cache past its freshness window (slice 3). */
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
  readonly forecast: WeatherForecastProvider;
  readonly marine: MarineForecastProvider;
  readonly scorers: readonly ActivityScorer[];
  readonly scoringConfig: ScoringConfig;
  readonly clock: Clock;
  readonly logger: Logger;
}

export const MARINE_UNAVAILABLE_WARNING =
  'Sea-state data is temporarily unavailable, so surfing could not be scored.';

/** Use case: "rank the next 7 days for each activity at this place". */
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

    const coordinates = { latitude: location.latitude, longitude: location.longitude };
    const warnings: string[] = [];

    // Independent calls run in parallel. Marine data is optional: if only it fails, we still
    // rank the other three activities and say why surfing is missing (graceful degradation).
    const [weather, marine] = await Promise.all([
      this.deps.forecast.getDailyForecast(coordinates),
      this.deps.marine.getDailyMarine(coordinates).catch((err: unknown) => {
        this.deps.logger.warn({ err, location: location.name }, 'Marine forecast unavailable');
        warnings.push(MARINE_UNAVAILABLE_WARNING);
        return null;
      }),
    ]);

    const activities = rankActivities(
      joinByDate(weather, marine),
      { elevationM: location.elevationM },
      this.deps.scorers,
      this.deps.scoringConfig,
    );

    return {
      kind: 'ranked',
      location,
      alternatives: sameNameAlternatives(location, candidates),
      forecastFetchedAt: this.deps.clock.now(),
      isStale: false,
      warnings,
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

/** Pairs each weather day with the marine day of the same date (if any). */
export function joinByDate(
  weather: readonly DayConditions['weather'][],
  marine: readonly MarineDay[] | null,
): DayConditions[] {
  const marineByDate = new Map((marine ?? []).map((m) => [m.date, m]));
  return weather.map((w) => ({ weather: w, marine: marineByDate.get(w.date) ?? null }));
}
