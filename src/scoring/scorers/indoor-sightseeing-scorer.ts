import { Activity, type DayConditions, type LocationContext } from '../../types';
import type { ActivityScorer } from '../activity-scorer';
import { calculateScore, type ScoreResult } from '../score';
import type { ScoringConfig } from '../../config/scoring';

/**
 * Indoor sightseeing (museums, galleries) is possible in any weather, so it starts from a
 * decent baseline (70) and gets BETTER the worse it is outside: it's the plan B for a rainy day
 * (questions-and-assumptions #6).
 *
 * It asks the outdoor scorer "how bad is it outside?" instead of repeating those rules,
 * so the two activities can never disagree about the weather.
 */
export class IndoorSightseeingScorer implements ActivityScorer {
  activity = Activity.IndoorSightseeing;

  constructor(
    private rules: ScoringConfig['indoor'],
    private outdoor: ActivityScorer,
  ) {}

  score(day: DayConditions, location: LocationContext): ScoreResult {
    const outdoorScore = this.outdoor.score(day, location).score ?? 100;

    // Example: outdoor scores 20 → it's 80 points "short" of perfect → 80 × 0.3 = +24 for indoor.
    const pointsShort = 100 - outdoorScore;
    const boost = Math.round(pointsShort * this.rules.outdoorDeficitWeight);
    if (boost === 0) {
      return calculateScore(this.rules.baseline, []);
    }
    return calculateScore(this.rules.baseline, [
      { points: boost, reason: `Poor outdoor conditions (outdoor score ${outdoorScore})` },
    ]);
  }
}
