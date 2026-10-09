/**
 * Small helpers that every activity scorer uses.
 *
 * How a score works: start at 100, then add or subtract points for each rule that applies.
 * Every change carries a reason, so we can explain each number to the user,
 * e.g. "Strong gusts 60 km/h may close lifts (-20)".
 */

/** One change to the score, with the reason shown to the user. */
export interface Adjustment {
  /** Whole points. Negative = penalty, positive = bonus. */
  points: number;
  reason: string;
}

export interface ScoreResult {
  /** 0–100, or null when the activity isn't possible here at all (e.g. surfing inland). */
  score: number | null;
  reasons: string[];
}

/**
 * A penalty that grows gradually: 0 points at `from`, rising evenly to `maxPoints` at `to`.
 * Example: gusts { from: 40, to: 80, maxPoints: 40 } → 40 km/h = 0, 60 km/h = -20, 80+ km/h = -40.
 * `from` can be bigger than `to` for "worse as the value falls" (colder, smaller waves).
 */
export interface RampRule {
  from: number;
  to: number;
  maxPoints: number;
}

export const MIN_SCORE = 0;
export const MAX_SCORE = 100;

/**
 * How far `value` is along the ramp from `from` to `to`, as a number between 0 and 1.
 * Example: rampFraction(60, 40, 80) = 0.5 (halfway).
 */
export function rampFraction(value: number, from: number, to: number): number {
  if (from === to) {
    return value >= to ? 1 : 0;
  }
  const fraction = (value - from) / (to - from);
  // Keep it between 0 and 1 (before the ramp = 0, past the end = 1).
  return Math.min(1, Math.max(0, fraction));
}

/** The penalty for `value` on a ramp, or null if it rounds to 0 (so no reason is shown). */
export function rampPenalty(value: number, rule: RampRule, reason: string): Adjustment | null {
  const points = Math.round(rampFraction(value, rule.from, rule.to) * rule.maxPoints);
  if (points === 0) {
    return null;
  }
  return { points: -points, reason };
}

/** A fixed number of points, applied only when `condition` is true. */
export function adjustIf(condition: boolean, points: number, reason: string): Adjustment | null {
  if (!condition || points === 0) {
    return null;
  }
  return { points, reason };
}

/** "Rain on the slopes" + -25 → "Rain on the slopes (-25)". */
export function formatAdjustment({ points, reason }: Adjustment): string {
  const sign = points > 0 ? '+' : '';
  return `${reason} (${sign}${points})`;
}

/**
 * Adds up all the adjustments that apply (nulls are skipped), keeps the result between 0 and 100,
 * and lists the reasons with the biggest change first.
 */
export function calculateScore(base: number, adjustments: (Adjustment | null)[]): ScoreResult {
  const applied: Adjustment[] = [];
  for (const adjustment of adjustments) {
    if (adjustment !== null) {
      applied.push(adjustment);
    }
  }

  let total = base;
  for (const adjustment of applied) {
    total += adjustment.points;
  }
  const score = Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(total)));

  // Biggest impact first. Equal impacts keep their original order, so output is always the same.
  const biggestFirst = [...applied].sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  const reasons = biggestFirst.map(formatAdjustment);

  return { score, reasons };
}

/** The result for an activity that's impossible here. null is different from 0 ("terrible"). */
export function notApplicable(reason: string): ScoreResult {
  return { score: null, reasons: [reason] };
}

/** Formats numbers for reasons: whole numbers stay whole (5), others get 1 decimal (7.4). */
export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
