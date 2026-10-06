import { Activity, type DayConditions, type LocationContext } from '../types';
import type { ActivityScorer } from './activity-scorer';
import { combine, type ScoreResult } from './score';
import type { ScoringConfig } from './scoring-config';

/**
 * Indoor sightseeing is always possible, so it starts from a solid baseline and gets
 * *better* as outdoor conditions get worse: it's the natural fallback on a washout day
 * (questions-and-assumptions #6).
 *
 * Composition over duplication: it reuses the outdoor scorer instead of re-implementing
 * "how bad is it outside", so the two activities can never disagree about the weather.
 */
export class IndoorSightseeingScorer implements ActivityScorer {
  readonly activity = Activity.IndoorSightseeing;

  constructor(
    private readonly rules: ScoringConfig['indoor'],
    private readonly outdoor: ActivityScorer,
  ) {}

  score(day: DayConditions, location: LocationContext): ScoreResult {
    const outdoorScore = this.outdoor.score(day, location).score ?? 100;
    const boost = Math.round((100 - outdoorScore) * this.rules.outdoorDeficitWeight);

    return combine(this.rules.baseline, [
      boost === 0
        ? null
        : { points: boost, reason: `Poor outdoor conditions (outdoor score ${outdoorScore})` },
    ]);
  }
}
