/**
 * Scoring primitives shared by every activity scorer.
 *
 * A score starts from a base (usually 100) and applies named adjustments. Each adjustment
 * carries the human-readable reason, so every number we return can be explained
 * ("Gusts 70 km/h (-30)"). That's a product feature and also makes tuning and debugging easy.
 */

export interface Adjustment {
  /** Signed, whole points. Negative = penalty, positive = bonus. */
  readonly points: number;
  readonly reason: string;
}

export interface ScoreResult {
  /** 0–100, or null when the activity isn't possible here at all. */
  readonly score: number | null;
  readonly reasons: readonly string[];
}

/** A linear ramp: penalty starts at `from`, reaches `maxPoints` at `to`. Works in either direction. */
export interface RampRule {
  readonly from: number;
  readonly to: number;
  readonly maxPoints: number;
}

export const MIN_SCORE = 0;
export const MAX_SCORE = 100;

/**
 * Where `value` sits between `from` and `to`, clamped to [0, 1].
 * `from > to` is allowed and means "worse as the value falls" (e.g. colder, smaller waves).
 */
export function rampFraction(value: number, from: number, to: number): number {
  if (from === to) return value >= to ? 1 : 0;
  const fraction = (value - from) / (to - from);
  return Math.min(1, Math.max(0, fraction));
}

/** A penalty that grows linearly along a ramp; null (no adjustment) when it rounds to zero. */
export function rampPenalty(value: number, rule: RampRule, reason: string): Adjustment | null {
  const points = Math.round(rampFraction(value, rule.from, rule.to) * rule.maxPoints);
  return points === 0 ? null : { points: -points, reason };
}

/** A fixed adjustment applied only when `condition` holds. */
export function adjustIf(condition: boolean, points: number, reason: string): Adjustment | null {
  return condition && points !== 0 ? { points, reason } : null;
}

export function formatAdjustment({ points, reason }: Adjustment): string {
  return `${reason} (${points > 0 ? '+' : ''}${points})`;
}

/**
 * Applies adjustments to a base score, clamps to 0–100 and orders the reasons by impact
 * (largest absolute change first; ties keep rule order, so the output is deterministic).
 */
export function combine(base: number, adjustments: readonly (Adjustment | null)[]): ScoreResult {
  const applied = adjustments.filter((a): a is Adjustment => a !== null);
  const total = applied.reduce((sum, a) => sum + a.points, base);
  const score = Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(total)));
  const reasons = [...applied]
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .map(formatAdjustment);
  return { score, reasons };
}

export function notApplicable(reason: string): ScoreResult {
  return { score: null, reasons: [reason] };
}

/** Formats measurements in reasons consistently: whole numbers stay whole, others get 1 decimal. */
export function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
