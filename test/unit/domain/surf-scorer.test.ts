import { defaultScoringConfig } from '../../../src/config/scoring';
import type { ActivityScorer } from '../../../src/domain/scoring/activity-scorer';
import { SurfScorer } from '../../../src/domain/scoring/surf-scorer';
import type { DailyWeather, MarineDay } from '../../../src/domain/types';
import { aDay, aMarineDay, conditions } from '../../support/builders';

// Typed as the interface, exactly how the registry and ranking code use scorers.
const scorer: ActivityScorer = new SurfScorer(defaultScoringConfig.surfing);
const coast = { elevationM: 5 };
const score = (marine: Partial<MarineDay> = {}, weather: Partial<DailyWeather> = {}) =>
  scorer.score(conditions(aDay(weather), aMarineDay(marine)), coast);

describe('SurfScorer', () => {
  it('scores clean 1.8 m waves at 11 s with light wind 100', () => {
    expect(score()).toEqual({ score: 100, reasons: [] });
  });

  describe('not applicable', () => {
    it('when there is no marine data at all (inland)', () => {
      expect(scorer.score(conditions(aDay(), null), coast)).toEqual({
        score: null,
        reasons: ['No sea-state data for this location (likely inland)'],
      });
    });

    it('when the marine API returned the day but without wave height', () => {
      expect(score({ waveHeightMaxM: null }).score).toBeNull();
    });
  });

  it.each<[string, Partial<MarineDay>, Partial<DailyWeather>, number, string]>([
    ['bottom of the sweet spot (1.0 m)', { waveHeightMaxM: 1.0 }, {}, 100, ''],
    ['top of the sweet spot (2.5 m)', { waveHeightMaxM: 2.5 }, {}, 100, ''],
    ['small (0.65 m)', { waveHeightMaxM: 0.65 }, {}, 65, 'Small waves (0.7 m) (-35)'],
    ['flat (0.3 m)', { waveHeightMaxM: 0.3 }, {}, 30, 'Small waves (0.3 m) (-70)'],
    ['flat (0.1 m), capped', { waveHeightMaxM: 0.1 }, {}, 30, 'Small waves (0.1 m) (-70)'],
    [
      'big (3.5 m)',
      { waveHeightMaxM: 3.5 },
      {},
      70,
      'Big waves (3.5 m), experienced surfers only (-30)',
    ],
    [
      'huge (5 m), capped',
      { waveHeightMaxM: 5 },
      {},
      40,
      'Big waves (5 m), experienced surfers only (-60)',
    ],
    [
      'short period (7.5 s)',
      { wavePeriodMaxS: 7.5 },
      {},
      85,
      'Short wave period (7.5 s), choppy (-15)',
    ],
    ['unknown period is not penalised', { wavePeriodMaxS: null }, {}, 100, ''],
    ['windy (32.5 km/h)', {}, { windSpeedMaxKmh: 32.5 }, 85, 'Strong wind 32.5 km/h (-15)'],
    [
      'cold air (8°C)',
      {},
      { temperatureMaxC: 8 },
      90,
      'Cold (max 8°C), thick wetsuit needed (-10)',
    ],
    [
      'thunderstorm',
      {},
      { weatherCode: 96 },
      60,
      'Thunderstorms: lightning risk in the water (-40)',
    ],
  ])('%s', (_case, marine, weather, expectedScore, expectedReason) => {
    const result = score(marine, weather);

    expect(result.score).toBe(expectedScore);
    if (expectedReason) expect(result.reasons).toContain(expectedReason);
    else expect(result.reasons).toEqual([]);
  });
});
