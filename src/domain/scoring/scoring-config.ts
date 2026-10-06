import type { RampRule } from './score';

/**
 * The shape of the scoring thresholds. The domain owns the *type*; the *values* live in
 * src/config/scoring.ts so tuning is a config change, not a logic change.
 * RampRule = linear penalty from `from` (0 points) to `to` (maxPoints).
 */
export interface FixedRule {
  readonly points: number;
}

export interface ScoringConfig {
  readonly ratingBands: {
    readonly excellent: number;
    readonly good: number;
    readonly fair: number;
  };
  /** Weekly score = average of this many best days. */
  readonly weeklyTopDays: number;

  readonly skiing: {
    /** Penalty grows as snow depth falls from `from` m to `to` m. */
    readonly snowDepthM: RampRule;
    readonly unknownSnowDepth: FixedRule;
    readonly freshSnowfall: FixedRule & { readonly minCm: number };
    readonly warmTempC: RampRule;
    readonly extremeCold: FixedRule & { readonly belowC: number };
    readonly gustsKmh: RampRule;
    readonly rain: FixedRule;
    readonly thunderstorm: FixedRule;
    readonly fog: FixedRule;
    readonly lowElevation: FixedRule & { readonly belowM: number };
  };

  readonly surfing: {
    /** Below the 1 m sweet spot: penalty grows as waves shrink. */
    readonly smallWavesM: RampRule;
    /** Above the 2.5 m sweet spot: penalty grows as waves get dangerous for most surfers. */
    readonly bigWavesM: RampRule;
    readonly shortPeriodS: RampRule;
    readonly windKmh: RampRule;
    readonly coldAir: FixedRule & { readonly belowC: number };
    readonly thunderstorm: FixedRule;
  };

  readonly outdoor: {
    readonly coldTempC: RampRule;
    readonly hotTempC: RampRule;
    readonly precipitationMm: RampRule;
    readonly precipitationProbabilityPct: RampRule;
    readonly windKmh: RampRule;
    readonly thunderstorm: FixedRule;
    readonly fog: FixedRule;
    readonly snow: FixedRule;
    readonly sunshine: FixedRule & { readonly minHours: number };
    readonly highUv: FixedRule & { readonly atLeast: number };
  };

  readonly indoor: {
    /** Museums and galleries are open in any weather, so indoor is always a decent option. */
    readonly baseline: number;
    /** How much of the outdoor "deficit" (100 - outdoor score) turns into an indoor boost. */
    readonly outdoorDeficitWeight: number;
  };
}
