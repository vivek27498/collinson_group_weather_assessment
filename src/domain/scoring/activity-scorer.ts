import type { Activity, DayConditions, LocationContext } from '../types';
import type { ScoreResult } from './score';

/**
 * Strategy interface: one implementation per activity.
 *
 * Scorers are pure (same input → same output, no I/O, no clock), so they are trivially
 * unit-testable and safe to run on every request. Adding an activity means writing one
 * class and registering it. Nothing else changes (open/closed principle).
 */
export interface ActivityScorer {
  readonly activity: Activity;
  score(day: DayConditions, location: LocationContext): ScoreResult;
}
