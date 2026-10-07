import type { Forecast, ForecastSource } from '../../../src/application/forecast-service';
import type { Coordinates, Geocoder } from '../../../src/application/ports';
import { RankingService, sameNameAlternatives } from '../../../src/application/ranking-service';
import { defaultScoringConfig } from '../../../src/config/scoring';
import { createScorers } from '../../../src/domain/scoring/registry';
import { Activity, type GeoLocation } from '../../../src/domain/types';
import { aDay, aMarineDay, conditions } from '../../support/builders';

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
const fetchedAt = new Date('2026-10-07T09:00:00Z');
const aForecast = (overrides: Partial<Forecast> = {}): Forecast => ({
  days: [
    conditions(aDay({ date: '2026-10-07' }), aMarineDay({ date: '2026-10-07' })),
    conditions(aDay({ date: '2026-10-08' }), aMarineDay({ date: '2026-10-08' })),
  ],
  fetchedAt,
  isStale: false,
  warnings: [],
  ...overrides,
});

/** Fakes for both collaborators: ranking is tested without HTTP, a database or a cache. */
function setup(options: { locations?: GeoLocation[]; forecast?: () => Promise<Forecast> } = {}) {
  const geocoder: jest.Mocked<Geocoder> = {
    search: jest.fn().mockResolvedValue(options.locations ?? [biarritz]),
  };
  const forecasts: jest.Mocked<ForecastSource> = {
    getForecast: jest.fn<Promise<Forecast>, [Coordinates]>(
      options.forecast ?? (() => Promise.resolve(aForecast())),
    ),
  };
  const service = new RankingService({
    geocoder,
    forecasts,
    scorers: createScorers(defaultScoringConfig),
    scoringConfig: defaultScoringConfig,
  });
  return { service, geocoder, forecasts };
}

describe('RankingService', () => {
  it('validates, geocodes, gets the forecast for the top match, and ranks all activities', async () => {
    const { service, geocoder, forecasts } = setup();

    const outcome = await service.rank({ city: '  Biarritz ', countryCode: 'fr' });

    expect(geocoder.search).toHaveBeenCalledWith({ name: 'Biarritz', countryCode: 'FR' });
    expect(forecasts.getForecast).toHaveBeenCalledWith(biarritz);
    expect(outcome).toMatchObject({
      kind: 'ranked',
      location: biarritz,
      alternatives: [],
      forecastFetchedAt: fetchedAt,
      isStale: false,
      warnings: [],
    });
    if (outcome.kind !== 'ranked') throw new Error('expected ranked');
    expect(outcome.activities.map((a) => a.activity).sort()).toEqual(
      Object.values(Activity).sort(),
    );
  });

  it('passes freshness and warnings from the forecast straight through', async () => {
    const { service } = setup({
      forecast: () =>
        Promise.resolve(aForecast({ isStale: true, warnings: ['sea data unavailable'] })),
    });

    await expect(service.rank({ city: 'Biarritz' })).resolves.toMatchObject({
      isStale: true,
      warnings: ['sea data unavailable'],
    });
  });

  it('rejects invalid input without calling any collaborator', async () => {
    const { service, geocoder, forecasts } = setup();

    const outcome = await service.rank({ city: "'; DROP TABLE locations;--" });

    expect(outcome).toMatchObject({ kind: 'invalidInput', errors: [{ path: 'city' }] });
    expect(geocoder.search).not.toHaveBeenCalled();
    expect(forecasts.getForecast).not.toHaveBeenCalled();
  });

  it('returns locationNotFound (a value, not an exception) and skips the forecast', async () => {
    const { service, forecasts } = setup({ locations: [] });

    await expect(service.rank({ city: 'Atlantis' })).resolves.toEqual({
      kind: 'locationNotFound',
      query: { name: 'Atlantis' },
    });
    expect(forecasts.getForecast).not.toHaveBeenCalled();
  });

  it('returns same-name alternatives so ambiguous names are visible', async () => {
    const texan = { ...biarritz, id: 2, countryCode: 'US', region: 'Texas' };
    const { service } = setup({ locations: [biarritz, texan] });

    const outcome = await service.rank({ city: 'Biarritz' });

    if (outcome.kind !== 'ranked') throw new Error('expected ranked');
    expect(outcome.alternatives).toEqual([texan]);
  });

  it('propagates a forecast failure (the shared error policy turns it into a clean error)', async () => {
    const failure = new Error('provider down');
    const { service } = setup({ forecast: () => Promise.reject(failure) });

    await expect(service.rank({ city: 'Biarritz' })).rejects.toBe(failure);
  });
});

describe('sameNameAlternatives', () => {
  const place = (id: number, name: string) => ({ ...biarritz, id, name });

  it('keeps only other places with the same name (case-insensitive), max 5', () => {
    const chosen = place(1, 'Paris');
    const candidates = [
      chosen,
      place(2, 'PARIS'),
      place(3, 'Parisot'), // fuzzy match, not an ambiguity
      ...[4, 5, 6, 7, 8].map((id) => place(id, 'Paris')),
    ];

    expect(sameNameAlternatives(chosen, candidates).map((c) => c.id)).toEqual([2, 4, 5, 6, 7]);
  });
});
