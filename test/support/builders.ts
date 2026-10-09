import type { DailyWeather, DayConditions, MarineDay } from '../../src/types';

/**
 * Test data builders: each test states only what's *different* about its day, so the
 * intent ("gusts of 60 km/h") isn't buried in 12 irrelevant fields.
 */

/** A pleasant, dry, mild day: no penalties for outdoor sightseeing (sunshine bonus off). */
export function aDay(overrides: Partial<DailyWeather> = {}): DailyWeather {
  return {
    date: '2026-10-07',
    weatherCode: 0,
    temperatureMaxC: 21,
    temperatureMinC: 12,
    precipitationSumMm: 0,
    precipitationProbabilityMaxPct: 0,
    snowfallSumCm: 0,
    snowDepthMaxM: 0,
    windSpeedMaxKmh: 10,
    windGustsMaxKmh: 20,
    sunshineDurationS: 0,
    uvIndexMax: 4,
    ...overrides,
  };
}

/** A bluebird ski day: deep snow, cold, calm, clear. */
export function aSkiDay(overrides: Partial<DailyWeather> = {}): DailyWeather {
  return aDay({
    temperatureMaxC: -2,
    temperatureMinC: -8,
    snowDepthMaxM: 1.2,
    windSpeedMaxKmh: 10,
    windGustsMaxKmh: 20,
    ...overrides,
  });
}

/** Clean, mid-size swell with a long period: ideal surf. */
export function aMarineDay(overrides: Partial<MarineDay> = {}): MarineDay {
  return {
    date: '2026-10-07',
    waveHeightMaxM: 1.8,
    wavePeriodMaxS: 11,
    swellWaveHeightMaxM: 1.5,
    ...overrides,
  };
}

export function conditions(weather: DailyWeather, marine: MarineDay | null = null): DayConditions {
  return { weather, marine };
}

/** A week of days starting on `startDate`, each customised by index. */
export function aWeek(
  build: (index: number) => DayConditions,
  startDate = '2026-10-07',
  length = 7,
): DayConditions[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  return Array.from({ length }, (_, i) => {
    const date = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const day = build(i);
    return {
      weather: { ...day.weather, date },
      marine: day.marine === null ? null : { ...day.marine, date },
    };
  });
}
