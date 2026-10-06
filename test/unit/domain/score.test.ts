import {
  adjustIf,
  combine,
  fmt,
  formatAdjustment,
  notApplicable,
  rampFraction,
  rampPenalty,
} from '../../../src/domain/scoring/score';

describe('rampFraction', () => {
  it.each([
    // value, from, to, expected
    [0, 10, 20, 0], // below the ramp
    [10, 10, 20, 0], // at the start
    [15, 10, 20, 0.5], // halfway
    [20, 10, 20, 1], // at the end
    [99, 10, 20, 1], // beyond: clamped
    [7.5, 15, 0, 0.5], // descending ramp ("worse as it gets colder")
    [-5, 15, 0, 1], // descending, beyond: clamped
    [20, 15, 0, 0], // descending, above the start
    [5, 5, 5, 1], // degenerate ramp: a step at the threshold
    [4.9, 5, 5, 0],
  ])('value %p on ramp %p→%p = %p', (value, from, to, expected) => {
    expect(rampFraction(value, from, to)).toBeCloseTo(expected);
  });
});

describe('rampPenalty', () => {
  const rule = { from: 40, to: 80, maxPoints: 40 };

  it('returns a negative, rounded adjustment with the reason', () => {
    expect(rampPenalty(60, rule, 'Gusty')).toEqual({ points: -20, reason: 'Gusty' });
  });

  it('caps at maxPoints', () => {
    expect(rampPenalty(500, rule, 'Gusty')).toEqual({ points: -40, reason: 'Gusty' });
  });

  it('returns null (no noise in reasons) when the penalty rounds to zero', () => {
    expect(rampPenalty(40, rule, 'Gusty')).toBeNull();
    expect(rampPenalty(40.4, rule, 'Gusty')).toBeNull();
  });
});

describe('adjustIf', () => {
  it('applies only when the condition holds and points are non-zero', () => {
    expect(adjustIf(true, -10, 'Fog')).toEqual({ points: -10, reason: 'Fog' });
    expect(adjustIf(false, -10, 'Fog')).toBeNull();
    expect(adjustIf(true, 0, 'Fog')).toBeNull();
  });
});

describe('combine', () => {
  it('applies adjustments to the base and skips nulls', () => {
    const result = combine(100, [{ points: -20, reason: 'A' }, null, { points: 5, reason: 'B' }]);
    expect(result.score).toBe(85);
  });

  it.each([
    ['below 0', -500, 0],
    ['above 100', 500, 100],
  ])('clamps a total %s', (_case, points, expected) => {
    expect(combine(100, [{ points, reason: 'x' }]).score).toBe(expected);
  });

  it('orders reasons by impact, keeping rule order on ties (deterministic)', () => {
    const { reasons } = combine(100, [
      { points: -5, reason: 'small' },
      { points: -30, reason: 'big' },
      { points: 10, reason: 'bonus' },
      { points: -10, reason: 'tie-first' },
    ]);
    expect(reasons).toEqual(['big (-30)', 'bonus (+10)', 'tie-first (-10)', 'small (-5)']);
  });

  it('returns no reasons for a perfect day', () => {
    expect(combine(100, [null, null])).toEqual({ score: 100, reasons: [] });
  });
});

describe('helpers', () => {
  it('formats adjustments with an explicit sign', () => {
    expect(formatAdjustment({ points: 5, reason: 'Sunny' })).toBe('Sunny (+5)');
    expect(formatAdjustment({ points: -5, reason: 'UV' })).toBe('UV (-5)');
  });

  it.each([
    [12, '12'],
    [0.25, '0.3'],
    [7.04, '7.0'],
    [-3, '-3'],
  ])('fmt(%p) = %p', (value, expected) => {
    expect(fmt(value)).toBe(expected);
  });

  it('notApplicable has a null score and one reason', () => {
    expect(notApplicable('inland')).toEqual({ score: null, reasons: ['inland'] });
  });
});
