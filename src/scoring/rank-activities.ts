import {
  Rating,
  type ActivityRanking,
  type DayConditions,
  type DayScore,
  type LocationContext,
} from '../types';
import type { ActivityScorer } from './activity-scorer';
import type { ScoringConfig } from '../config/scoring';

/** Turns a 0–100 score into a label: ≥ 75 EXCELLENT, ≥ 55 GOOD, ≥ 35 FAIR, else POOR. */
export function toRating(score: number | null, bands: ScoringConfig['ratingBands']): Rating {
  if (score === null) return Rating.NotApplicable;
  if (score >= bands.excellent) return Rating.Excellent;
  if (score >= bands.good) return Rating.Good;
  if (score >= bands.fair) return Rating.Fair;
  return Rating.Poor;
}

/**
 * The weekly score is the average of the best few days (3 by default), to 1 decimal place.
 * Why not all 7 days? You only need a few good days to plan a trip, so a week with three
 * perfect ski days shouldn't be dragged down by four bad ones (questions-and-assumptions #3).
 */
export function weeklyScore(scores: (number | null)[], topDays: number): number | null {
  const realScores = scores.filter((s): s is number => s !== null);
  if (realScores.length === 0) {
    return null; // the activity isn't possible here
  }

  const highestFirst = realScores.sort((a, b) => b - a);
  const best = highestFirst.slice(0, topDays);

  let sum = 0;
  for (const score of best) {
    sum += score;
  }
  const average = sum / best.length;
  return Math.round(average * 10) / 10;
}

/** The highest-scoring day. On a tie the earlier date wins (sooner is easier to plan for). */
export function bestDay(days: DayScore[]): string | null {
  let bestDate: string | null = null;
  let bestScore = -1; // lower than any real score (scores are 0–100)
  for (const day of days) {
    // Strictly greater, so on a tie we keep the earlier day.
    if (day.score !== null && day.score > bestScore) {
      bestScore = day.score;
      bestDate = day.date;
    }
  }
  return bestDate;
}

/** An activity's results before it has been given its rank number. */
interface UnrankedActivity extends Omit<ActivityRanking, 'rank'> {
  /** Position in the scorer list, used to break exact ties. */
  listPosition: number;
}

/**
 * Decides the order of two activities:
 *   1. activities that are possible come before ones that aren't (surfing inland goes last);
 *   2. then the higher weekly score first;
 *   3. on an exact tie, the order of the scorer list, so the result never changes randomly.
 * Returns a negative number if `a` should come first, positive if `b` should.
 */
function compareActivities(a: UnrankedActivity, b: UnrankedActivity): number {
  if (a.applicable !== b.applicable) {
    return a.applicable ? -1 : 1;
  }
  const scoreA = a.weeklyScore ?? 0;
  const scoreB = b.weeklyScore ?? 0;
  if (scoreA !== scoreB) {
    return scoreB - scoreA;
  }
  return a.listPosition - b.listPosition;
}

/**
 * Scores every activity for every day, then ranks the activities from best (1) to worst.
 * The same forecast always produces exactly the same answer.
 */
export function rankActivities(
  days: DayConditions[],
  location: LocationContext,
  scorers: ActivityScorer[],
  config: ScoringConfig,
): ActivityRanking[] {
  const daysInOrder = [...days].sort((a, b) => a.weather.date.localeCompare(b.weather.date));

  // 1. Score each activity on each day, and work out its weekly score and best day.
  const unranked: UnrankedActivity[] = scorers.map((scorer, listPosition) => {
    const dayScores: DayScore[] = daysInOrder.map((day) => {
      const { score, reasons } = scorer.score(day, location);
      return {
        date: day.weather.date,
        score,
        rating: toRating(score, config.ratingBands),
        reasons,
      };
    });

    const weekly = weeklyScore(
      dayScores.map((d) => d.score),
      config.weeklyTopDays,
    );

    return {
      listPosition,
      activity: scorer.activity,
      weeklyScore: weekly,
      weeklyRating: toRating(weekly, config.ratingBands),
      applicable: weekly !== null,
      bestDay: bestDay(dayScores),
      days: dayScores,
    };
  });

  // 2. Sort them, then number them 1, 2, 3, 4.
  unranked.sort(compareActivities);

  return unranked.map((activity, index) => ({
    activity: activity.activity,
    rank: index + 1,
    weeklyScore: activity.weeklyScore,
    weeklyRating: activity.weeklyRating,
    applicable: activity.applicable,
    bestDay: activity.bestDay,
    days: activity.days,
  }));
}
