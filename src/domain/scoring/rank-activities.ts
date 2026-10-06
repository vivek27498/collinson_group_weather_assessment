import {
  Rating,
  type ActivityRanking,
  type DayConditions,
  type DayScore,
  type LocationContext,
} from '../types';
import type { ActivityScorer } from './activity-scorer';
import type { ScoringConfig } from './scoring-config';

type RankingConfig = Pick<ScoringConfig, 'ratingBands' | 'weeklyTopDays'>;

export function toRating(score: number | null, bands: ScoringConfig['ratingBands']): Rating {
  if (score === null) return Rating.NotApplicable;
  if (score >= bands.excellent) return Rating.Excellent;
  if (score >= bands.good) return Rating.Good;
  if (score >= bands.fair) return Rating.Fair;
  return Rating.Poor;
}

/**
 * Weekly score = mean of the best `topDays` days, to 1 decimal place.
 * A plain mean would punish a week with three perfect ski days and four bad ones, but
 * you only need a few good days to plan around (questions-and-assumptions #3).
 */
export function weeklyScore(scores: readonly (number | null)[], topDays: number): number | null {
  const best = scores
    .filter((s): s is number => s !== null)
    .sort((a, b) => b - a)
    .slice(0, topDays);
  if (best.length === 0) return null;
  const mean = best.reduce((sum, s) => sum + s, 0) / best.length;
  return Math.round(mean * 10) / 10;
}

/** Highest-scoring day; ties go to the earliest date (sooner is more actionable). */
export function bestDay(days: readonly DayScore[]): string | null {
  let best: DayScore | null = null;
  for (const day of days) {
    if (day.score !== null && (best?.score == null || day.score > best.score)) {
      best = day;
    }
  }
  return best?.date ?? null;
}

/**
 * Scores every registered activity for every day, then ranks the activities.
 * Ordering: applicable before not-applicable, then weekly score descending, then
 * registry order. Fully deterministic, so the same forecast always gives the same answer.
 */
export function rankActivities(
  days: readonly DayConditions[],
  location: LocationContext,
  scorers: readonly ActivityScorer[],
  config: RankingConfig,
): ActivityRanking[] {
  const sortedDays = [...days].sort((a, b) => a.weather.date.localeCompare(b.weather.date));

  const unranked = scorers.map((scorer, registryIndex) => {
    const dayScores: DayScore[] = sortedDays.map((day) => {
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
      registryIndex,
      activity: scorer.activity,
      weeklyScore: weekly,
      weeklyRating: toRating(weekly, config.ratingBands),
      applicable: weekly !== null,
      bestDay: bestDay(dayScores),
      days: dayScores,
    };
  });

  return unranked
    .sort(
      (a, b) =>
        Number(b.applicable) - Number(a.applicable) ||
        (b.weeklyScore ?? 0) - (a.weeklyScore ?? 0) ||
        a.registryIndex - b.registryIndex,
    )
    .map((r, index): ActivityRanking => ({
      activity: r.activity,
      rank: index + 1,
      weeklyScore: r.weeklyScore,
      weeklyRating: r.weeklyRating,
      applicable: r.applicable,
      bestDay: r.bestDay,
      days: r.days,
    }));
}
