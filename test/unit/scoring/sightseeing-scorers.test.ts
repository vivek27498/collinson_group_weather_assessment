import { defaultScoringConfig } from '../../../src/config/scoring';
import type { ActivityScorer } from '../../../src/scoring/activity-scorer';
import { IndoorSightseeingScorer } from '../../../src/scoring/indoor-sightseeing-scorer';
import { OutdoorSightseeingScorer } from '../../../src/scoring/outdoor-sightseeing-scorer';
import { Activity, type DailyWeather } from '../../../src/types';
import { aDay, conditions } from '../../support/builders';

const city = { elevationM: 35 };
// Typed as the interface, exactly how the registry and ranking code use scorers.
const outdoor: ActivityScorer = new OutdoorSightseeingScorer(defaultScoringConfig.outdoor);
const outdoorScore = (overrides: Partial<DailyWeather>) =>
  outdoor.score(conditions(aDay(overrides)), city);

describe('OutdoorSightseeingScorer', () => {
  it('scores a mild, dry, calm day 100', () => {
    expect(outdoorScore({})).toEqual({ score: 100, reasons: [] });
  });

  it.each<[string, Partial<DailyWeather>, number, string]>([
    ['cool (7.5°C)', { temperatureMaxC: 7.5 }, 80, 'Cold (max 7.5°C) (-20)'],
    ['freezing (-5°C), capped', { temperatureMaxC: -5 }, 60, 'Cold (max -5°C) (-40)'],
    ['comfort band edge (15°C)', { temperatureMaxC: 15 }, 100, ''],
    ['comfort band edge (25°C)', { temperatureMaxC: 25 }, 100, ''],
    ['hot (31.5°C)', { temperatureMaxC: 31.5 }, 80, 'Hot (max 31.5°C) (-20)'],
    ['heatwave (40°C), capped', { temperatureMaxC: 40 }, 60, 'Hot (max 40°C) (-40)'],
    ['moderate rain (5.25 mm)', { precipitationSumMm: 5.25 }, 80, 'Rain 5.3 mm (-20)'],
    ['likely rain (60%)', { precipitationProbabilityMaxPct: 60 }, 90, '60% chance of rain (-10)'],
    ['unknown rain chance is not penalised', { precipitationProbabilityMaxPct: null }, 100, ''],
    ['windy (60 km/h)', { windSpeedMaxKmh: 60 }, 75, 'Windy (60 km/h) (-25)'],
    ['breezy (45 km/h), rounds half up', { windSpeedMaxKmh: 45 }, 87, 'Windy (45 km/h) (-13)'],
    ['thunderstorm', { weatherCode: 95 }, 70, 'Thunderstorms (-30)'],
    ['fog', { weatherCode: 48 }, 90, 'Fog limits views (-10)'],
    ['snowing', { weatherCode: 73 }, 85, 'Snowfall (-15)'],
    ['very high UV', { uvIndexMax: 9 }, 95, 'Very high UV (9) (-5)'],
  ])('%s', (_case, overrides, expectedScore, expectedReason) => {
    const result = outdoorScore(overrides);

    expect(result.score).toBe(expectedScore);
    if (expectedReason) expect(result.reasons).toContain(expectedReason);
    else expect(result.reasons).toEqual([]);
  });

  it('gives a sunshine bonus that offsets other penalties', () => {
    expect(outdoorScore({ sunshineDurationS: 8 * 3600, precipitationSumMm: 5.25 })).toEqual({
      score: 85,
      reasons: ['Rain 5.3 mm (-20)', 'Sunny (8 h sunshine) (+5)'],
    });
  });

  it('ignores unknown sunshine and UV', () => {
    expect(outdoorScore({ sunshineDurationS: null, uvIndexMax: null }).score).toBe(100);
  });

  it('scores a stormy washout 0', () => {
    expect(
      outdoorScore({
        precipitationSumMm: 20,
        precipitationProbabilityMaxPct: 100,
        windSpeedMaxKmh: 70,
        weatherCode: 95,
      }).score,
    ).toBe(0);
  });
});

describe('IndoorSightseeingScorer', () => {
  /** Test double: lets us pin the outdoor score and test the indoor rule in isolation. */
  const outdoorReturning = (score: number | null): ActivityScorer => ({
    activity: Activity.OutdoorSightseeing,
    score: () => ({ score, reasons: [] }),
  });
  const indoorWith = (outdoorScoreValue: number | null) =>
    new IndoorSightseeingScorer(
      defaultScoringConfig.indoor,
      outdoorReturning(outdoorScoreValue),
    ).score(conditions(aDay()), city);

  it.each<[number | null, number, string[]]>([
    [100, 70, []],
    [80, 76, ['Poor outdoor conditions (outdoor score 80) (+6)']],
    [50, 85, ['Poor outdoor conditions (outdoor score 50) (+15)']],
    [0, 100, ['Poor outdoor conditions (outdoor score 0) (+30)']],
    [null, 70, []],
  ])('outdoor score %p → indoor %i', (outdoorValue, expectedScore, expectedReasons) => {
    expect(indoorWith(outdoorValue)).toEqual({ score: expectedScore, reasons: expectedReasons });
  });

  it('is never "not applicable": indoor plans always work', () => {
    expect(indoorWith(null).score).not.toBeNull();
  });

  it('beats outdoor sightseeing on a washout day (real composition)', () => {
    const indoor = new IndoorSightseeingScorer(defaultScoringConfig.indoor, outdoor);
    const washout = conditions(aDay({ precipitationSumMm: 25, weatherCode: 65 }));

    expect(indoor.score(washout, city).score).toBeGreaterThan(
      outdoor.score(washout, city).score ?? 0,
    );
  });
});
