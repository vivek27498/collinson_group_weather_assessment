import type { ScoringConfig } from '../domain/scoring/scoring-config';

/**
 * Every threshold the scorers use lives here, not inside the scoring code.
 *  - Tuning is a config change with a clear diff, not a logic change.
 *  - Tests can inject an alternative config to exercise rules in isolation.
 *  - It reads as a spec a PM can sanity-check ("why is 25°C the top of the comfort band?").
 *
 * Values are judgement calls, documented in docs/questions-and-assumptions.md.
 */
export const defaultScoringConfig: ScoringConfig = Object.freeze({
  ratingBands: { excellent: 75, good: 55, fair: 35 },
  weeklyTopDays: 3,

  skiing: {
    snowDepthM: { from: 0.5, to: 0, maxPoints: 60 },
    unknownSnowDepth: { points: -30 },
    freshSnowfall: { minCm: 5, points: 10 },
    warmTempC: { from: 2, to: 10, maxPoints: 30 },
    extremeCold: { belowC: -20, points: -15 },
    gustsKmh: { from: 40, to: 80, maxPoints: 40 },
    rain: { points: -25 },
    thunderstorm: { points: -30 },
    fog: { points: -10 },
    lowElevation: { belowM: 500, points: -15 },
  },

  surfing: {
    smallWavesM: { from: 1.0, to: 0.3, maxPoints: 70 },
    bigWavesM: { from: 2.5, to: 4.5, maxPoints: 60 },
    shortPeriodS: { from: 10, to: 5, maxPoints: 30 },
    windKmh: { from: 20, to: 45, maxPoints: 30 },
    coldAir: { belowC: 10, points: -10 },
    thunderstorm: { points: -40 },
  },

  outdoor: {
    coldTempC: { from: 15, to: 0, maxPoints: 40 },
    hotTempC: { from: 25, to: 38, maxPoints: 40 },
    precipitationMm: { from: 0.5, to: 10, maxPoints: 40 },
    precipitationProbabilityPct: { from: 30, to: 90, maxPoints: 20 },
    windKmh: { from: 30, to: 60, maxPoints: 25 },
    thunderstorm: { points: -30 },
    fog: { points: -10 },
    snow: { points: -15 },
    sunshine: { minHours: 6, points: 5 },
    highUv: { atLeast: 8, points: -5 },
  },

  indoor: { baseline: 70, outdoorDeficitWeight: 0.3 },
});
