import { defaultScoringConfig } from '../../../src/config/scoring';
import { SkiScorer } from '../../../src/domain/scoring/ski-scorer';
import type { DailyWeather, LocationContext } from '../../../src/domain/types';
import { aSkiDay, conditions } from '../../support/builders';

const scorer = new SkiScorer(defaultScoringConfig.skiing);
const mountain: LocationContext = { elevationM: 1800 };
const score = (overrides: Partial<DailyWeather>, location: LocationContext = mountain) =>
  scorer.score(conditions(aSkiDay(overrides)), location);

describe('SkiScorer', () => {
  it('scores a bluebird powder day 100 with no penalties', () => {
    expect(score({})).toEqual({ score: 100, reasons: [] });
  });

  // Each case changes one thing from the ideal day; expected values are worked out by hand
  // from defaultScoringConfig so a threshold change shows up here as a reviewable diff.
  it.each<[string, Partial<DailyWeather>, number, string]>([
    ['no snow on the ground', { snowDepthMaxM: 0 }, 40, 'Thin snow cover (0 cm) (-60)'],
    ['thin snow (25 cm)', { snowDepthMaxM: 0.25 }, 70, 'Thin snow cover (25 cm) (-30)'],
    ['enough snow (50 cm)', { snowDepthMaxM: 0.5 }, 100, ''],
    ['unknown snow depth', { snowDepthMaxM: null }, 70, 'Snow depth unknown (-30)'],
    ['warm (6°C)', { temperatureMaxC: 6 }, 85, 'Warm, slushy snow (max 6°C) (-15)'],
    ['very warm (12°C), capped', { temperatureMaxC: 12 }, 70, 'Warm, slushy snow (max 12°C) (-30)'],
    ['extreme cold (-25°C)', { temperatureMinC: -25 }, 85, 'Extreme cold (min -25°C) (-15)'],
    ['gusty (60 km/h)', { windGustsMaxKmh: 60 }, 80, 'Strong gusts 60 km/h may close lifts (-20)'],
    [
      'storm gusts (100 km/h), capped',
      { windGustsMaxKmh: 100 },
      60,
      'Strong gusts 100 km/h may close lifts (-40)',
    ],
    ['rain', { weatherCode: 61 }, 75, 'Rain on the slopes (-25)'],
    ['drizzle counts as rain', { weatherCode: 53 }, 75, 'Rain on the slopes (-25)'],
    ['thunderstorm', { weatherCode: 95 }, 70, 'Thunderstorms (-30)'],
    ['fog', { weatherCode: 45 }, 90, 'Fog / poor visibility (-10)'],
  ])('%s → %i', (_case, overrides, expectedScore, expectedReason) => {
    const result = score(overrides);

    expect(result.score).toBe(expectedScore);
    if (expectedReason) expect(result.reasons).toContain(expectedReason);
    else expect(result.reasons).toEqual([]);
  });

  it('rewards fresh snowfall, which can offset unknown depth', () => {
    expect(score({ snowDepthMaxM: null, snowfallSumCm: 10 })).toEqual({
      score: 80,
      reasons: ['Snow depth unknown (-30)', 'Fresh snowfall 10 cm (+10)'],
    });
  });

  it('does not exceed 100 with a bonus on a perfect day', () => {
    expect(score({ snowfallSumCm: 20 }).score).toBe(100);
  });

  it.each<[string, LocationContext, number]>([
    ['low elevation', { elevationM: 200 }, 85],
    ['elevation exactly at threshold', { elevationM: 500 }, 100],
    ['unknown elevation is not penalised', { elevationM: null }, 100],
  ])('%s → %i', (_case, location, expected) => {
    expect(score({}, location).score).toBe(expected);
  });

  it('clamps a terrible day at 0 and lists the biggest problem first', () => {
    const result = score({
      snowDepthMaxM: 0,
      temperatureMaxC: 15,
      windGustsMaxKmh: 100,
      weatherCode: 61,
    });

    expect(result.score).toBe(0);
    expect(result.reasons[0]).toBe('Thin snow cover (0 cm) (-60)');
  });
});
