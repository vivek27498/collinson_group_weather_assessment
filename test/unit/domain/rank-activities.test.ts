import { defaultScoringConfig } from '../../../src/config/scoring';
import type { ActivityScorer } from '../../../src/domain/scoring/activity-scorer';
import {
  bestDay,
  rankActivities,
  toRating,
  weeklyScore,
} from '../../../src/domain/scoring/rank-activities';
import { createScorers } from '../../../src/domain/scoring/registry';
import { Activity, Rating, type DayScore } from '../../../src/domain/types';
import { aDay, aMarineDay, aSkiDay, aWeek, conditions } from '../../support/builders';

const bands = defaultScoringConfig.ratingBands;

describe('toRating', () => {
  it.each<[number | null, Rating]>([
    [100, Rating.Excellent],
    [75, Rating.Excellent],
    [74.9, Rating.Good],
    [55, Rating.Good],
    [54.9, Rating.Fair],
    [35, Rating.Fair],
    [34.9, Rating.Poor],
    [0, Rating.Poor],
    [null, Rating.NotApplicable],
  ])('%p → %s', (score, rating) => {
    expect(toRating(score, bands)).toBe(rating);
  });
});

describe('weeklyScore', () => {
  it.each<[string, (number | null)[], number | null]>([
    ['averages the best 3 days, ignoring the rest', [90, 10, 80, 70, 0, 5, 20], 80],
    ['ignores not-applicable days', [90, null, 60, null], 75],
    ['uses what exists when fewer than 3 days', [40], 40],
    ['rounds to 1 decimal', [100, 90, 85], 91.7],
    ['is null when nothing is applicable', [null, null], null],
    ['is null for an empty forecast', [], null],
  ])('%s', (_case, scores, expected) => {
    expect(weeklyScore(scores, 3)).toBe(expected);
  });
});

describe('bestDay', () => {
  const day = (date: string, score: number | null): DayScore => ({
    date,
    score,
    rating: Rating.Good,
    reasons: [],
  });

  it('picks the highest score', () => {
    expect(bestDay([day('2026-10-07', 50), day('2026-10-08', 90), day('2026-10-09', 70)])).toBe(
      '2026-10-08',
    );
  });

  it('breaks ties in favour of the earliest date', () => {
    expect(bestDay([day('2026-10-07', 90), day('2026-10-08', 90)])).toBe('2026-10-07');
  });

  it('skips not-applicable days, and is null if none apply', () => {
    expect(bestDay([day('2026-10-07', null), day('2026-10-08', 10)])).toBe('2026-10-08');
    expect(bestDay([day('2026-10-07', null)])).toBeNull();
  });
});

describe('rankActivities', () => {
  /** Stub scorers with fixed per-day scores, so ranking logic is tested without weather rules. */
  const stub = (activity: Activity, scores: (number | null)[]): ActivityScorer => {
    let call = 0;
    return {
      activity,
      score: () => ({ score: scores[call++ % scores.length] ?? null, reasons: [] }),
    };
  };
  const threeDays = aWeek(() => conditions(aDay()), '2026-10-07', 3);
  const location = { elevationM: 100 };

  it('ranks applicable activities by weekly score, not-applicable last', () => {
    const result = rankActivities(
      threeDays,
      location,
      [
        stub(Activity.Skiing, [20, 30, 10]),
        stub(Activity.Surfing, [null]),
        stub(Activity.OutdoorSightseeing, [90, 80, 100]),
        stub(Activity.IndoorSightseeing, [70, 70, 70]),
      ],
      defaultScoringConfig,
    );

    expect(result.map((r) => [r.rank, r.activity, r.weeklyScore, r.applicable])).toEqual([
      [1, Activity.OutdoorSightseeing, 90, true],
      [2, Activity.IndoorSightseeing, 70, true],
      [3, Activity.Skiing, 20, true],
      [4, Activity.Surfing, null, false],
    ]);
    expect(result[3]?.weeklyRating).toBe(Rating.NotApplicable);
  });

  it('breaks equal weekly scores by registry order (deterministic output)', () => {
    const result = rankActivities(
      threeDays,
      location,
      [stub(Activity.IndoorSightseeing, [70]), stub(Activity.OutdoorSightseeing, [70])],
      defaultScoringConfig,
    );

    expect(result.map((r) => r.activity)).toEqual([
      Activity.IndoorSightseeing,
      Activity.OutdoorSightseeing,
    ]);
  });

  it('returns days in date order even if the input is unordered, with ratings and best day', () => {
    const shuffled = [threeDays[2]!, threeDays[0]!, threeDays[1]!];
    const result = rankActivities(
      shuffled,
      location,
      [stub(Activity.Skiing, [10, 80, 40])], // scored in sorted order: 07→10, 08→80, 09→40
      defaultScoringConfig,
    );

    const skiing = result[0]!;
    expect(skiing.days.map((d) => [d.date, d.score, d.rating])).toEqual([
      ['2026-10-07', 10, Rating.Poor],
      ['2026-10-08', 80, Rating.Excellent],
      ['2026-10-09', 40, Rating.Fair],
    ]);
    expect(skiing.bestDay).toBe('2026-10-08');
  });
});

describe('rankActivities with the real scorers (scenario tests)', () => {
  const scorers = createScorers(defaultScoringConfig);

  it('alpine resort in winter: skiing first, surfing not applicable', () => {
    const week = aWeek((i) =>
      conditions(aSkiDay({ snowfallSumCm: i === 2 ? 15 : 0, weatherCode: i === 4 ? 73 : 0 })),
    );

    const result = rankActivities(week, { elevationM: 1035 }, scorers, defaultScoringConfig);

    expect(result[0]?.activity).toBe(Activity.Skiing);
    expect(result[0]?.weeklyRating).toBe(Rating.Excellent);
    expect(result.at(-1)).toMatchObject({ activity: Activity.Surfing, applicable: false });
    expect(result.find((r) => r.activity === Activity.Surfing)?.days[0]?.reasons).toEqual([
      'No sea-state data for this location (likely inland)',
    ]);
  });

  it('surf town in summer: surfing and outdoor lead, skiing is poor', () => {
    const week = aWeek(() =>
      conditions(
        aDay({ temperatureMaxC: 24, sunshineDurationS: 9 * 3600 }),
        aMarineDay({ waveHeightMaxM: 1.6 }),
      ),
    );

    const result = rankActivities(week, { elevationM: 10 }, scorers, defaultScoringConfig);
    const byActivity = new Map(result.map((r) => [r.activity, r]));

    expect(
      result
        .slice(0, 2)
        .map((r) => r.activity)
        .sort(),
    ).toEqual([Activity.OutdoorSightseeing, Activity.Surfing].sort());
    expect(byActivity.get(Activity.Skiing)?.weeklyRating).toBe(Rating.Poor);
  });

  it('rainy city week: indoor sightseeing wins', () => {
    const week = aWeek(() =>
      conditions(
        aDay({
          temperatureMaxC: 11,
          precipitationSumMm: 12,
          precipitationProbabilityMaxPct: 90,
          weatherCode: 63,
          windSpeedMaxKmh: 35,
        }),
      ),
    );

    const result = rankActivities(week, { elevationM: 35 }, scorers, defaultScoringConfig);

    expect(result[0]?.activity).toBe(Activity.IndoorSightseeing);
  });
});

describe('createScorers', () => {
  it('registers each activity exactly once, in a stable order', () => {
    expect(createScorers(defaultScoringConfig).map((s) => s.activity)).toEqual([
      Activity.Skiing,
      Activity.Surfing,
      Activity.OutdoorSightseeing,
      Activity.IndoorSightseeing,
    ]);
  });
});
