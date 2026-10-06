import type {
  Geocoder,
  MarineForecastProvider,
  WeatherForecastProvider,
} from '../../../src/application/ports';
import {
  joinByDate,
  MARINE_UNAVAILABLE_WARNING,
  RankingService,
} from '../../../src/application/ranking-service';
import { defaultScoringConfig } from '../../../src/config/scoring';
import { createScorers } from '../../../src/domain/scoring/registry';
import { Activity, type GeoLocation } from '../../../src/domain/types';
import { UpstreamRequestError } from '../../../src/infrastructure/http/json-http-client';
import { createLogger } from '../../../src/observability/logger';
import { aDay, aMarineDay } from '../../support/builders';

const biarritz: GeoLocation = {
  id: 1,
  name: 'Biarritz',
  region: 'Nouvelle-Aquitaine',
  country: 'France',
  countryCode: 'FR',
  latitude: 43.48,
  longitude: -1.55,
  elevationM: 39,
  timezone: 'Europe/Paris',
  population: 25_000,
};
const fixedNow = new Date('2026-10-07T09:00:00Z');

/** In-memory fakes for every port: the service is tested without HTTP or a database. */
function setup(overrides: {
  locations?: GeoLocation[];
  marine?: MarineForecastProvider['getDailyMarine'];
  forecast?: WeatherForecastProvider['getDailyForecast'];
}) {
  const geocoder: jest.Mocked<Geocoder> = {
    search: jest.fn().mockResolvedValue(overrides.locations ?? [biarritz]),
  };
  const forecast: jest.Mocked<WeatherForecastProvider> = {
    getDailyForecast: jest.fn(
      overrides.forecast ??
        (() => Promise.resolve([aDay({ date: '2026-10-07' }), aDay({ date: '2026-10-08' })])),
    ),
  };
  const marine: jest.Mocked<MarineForecastProvider> = {
    getDailyMarine: jest.fn(
      overrides.marine ??
        (() =>
          Promise.resolve([
            aMarineDay({ date: '2026-10-07' }),
            aMarineDay({ date: '2026-10-08' }),
          ])),
    ),
  };
  const service = new RankingService({
    geocoder,
    forecast,
    marine,
    scorers: createScorers(defaultScoringConfig),
    scoringConfig: defaultScoringConfig,
    clock: { now: () => fixedNow },
    logger: createLogger({ level: 'silent' }),
  });
  return { service, geocoder, forecast, marine };
}

describe('RankingService', () => {
  it('geocodes, fetches weather + marine for the top match, and ranks all activities', async () => {
    const { service, geocoder, forecast, marine } = setup({});

    const outcome = await service.rank({ name: 'Biarritz', countryCode: 'FR' });

    expect(geocoder.search).toHaveBeenCalledWith({ name: 'Biarritz', countryCode: 'FR' });
    expect(forecast.getDailyForecast).toHaveBeenCalledWith({ latitude: 43.48, longitude: -1.55 });
    expect(marine.getDailyMarine).toHaveBeenCalledWith({ latitude: 43.48, longitude: -1.55 });
    expect(outcome).toMatchObject({
      kind: 'ranked',
      location: biarritz,
      forecastFetchedAt: fixedNow,
      isStale: false,
      warnings: [],
    });
    if (outcome.kind !== 'ranked') throw new Error('expected ranked');
    expect(outcome.activities.map((a) => a.activity).sort()).toEqual(
      Object.values(Activity).sort(),
    );
    expect(outcome.activities.find((a) => a.activity === Activity.Surfing)?.applicable).toBe(true);
  });

  it('returns locationNotFound (a value, not an exception) and skips the weather calls', async () => {
    const { service, forecast, marine } = setup({ locations: [] });

    await expect(service.rank({ name: 'Atlantis' })).resolves.toEqual({
      kind: 'locationNotFound',
      query: { name: 'Atlantis' },
    });
    expect(forecast.getDailyForecast).not.toHaveBeenCalled();
    expect(marine.getDailyMarine).not.toHaveBeenCalled();
  });

  it('degrades gracefully when only marine data fails: ranks the rest, warns about surfing', async () => {
    const { service } = setup({
      marine: () =>
        Promise.reject(new UpstreamRequestError('open-meteo.marine', 'http_status', 503, true)),
    });

    const outcome = await service.rank({ name: 'Biarritz' });

    if (outcome.kind !== 'ranked') throw new Error('expected ranked');
    expect(outcome.warnings).toEqual([MARINE_UNAVAILABLE_WARNING]);
    expect(outcome.activities.find((a) => a.activity === Activity.Surfing)?.applicable).toBe(false);
    expect(outcome.activities[0]?.applicable).toBe(true);
  });

  it('fails the request when the main forecast fails (nothing meaningful to rank)', async () => {
    const failure = new UpstreamRequestError('open-meteo.forecast', 'timeout', undefined, true);
    const { service } = setup({ forecast: () => Promise.reject(failure) });

    await expect(service.rank({ name: 'Biarritz' })).rejects.toBe(failure);
  });
});

describe('joinByDate', () => {
  it('pairs marine days to weather days by date, null where missing', () => {
    const joined = joinByDate(
      [aDay({ date: '2026-10-07' }), aDay({ date: '2026-10-08' })],
      [aMarineDay({ date: '2026-10-08', waveHeightMaxM: 2 })],
    );

    expect(joined.map((d) => [d.weather.date, d.marine?.waveHeightMaxM ?? null])).toEqual([
      ['2026-10-07', null],
      ['2026-10-08', 2],
    ]);
  });

  it('handles no marine data at all (inland)', () => {
    expect(joinByDate([aDay()], null)[0]?.marine).toBeNull();
  });
});
