import type { Activity, DayConditions, LocationContext } from '../types';
import type { ScoreResult } from './score';

/**
 * Every activity has its own scorer class with this shape (the Strategy pattern).
 *
 * A scorer only does maths on the data it is given: no network, no database, no clock.
 * So the same day always gets the same score, which makes scorers easy to test.
 * To add an activity, write one new scorer and add it to registry.ts. Nothing else changes.
 */
export interface ActivityScorer {
  activity: Activity;
  score(day: DayConditions, location: LocationContext): ScoreResult;
}
