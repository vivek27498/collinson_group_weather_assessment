import type { Coordinates } from '../../../src/application/ports';
import {
  ForecastService,
  gridCell,
  joinByDate,
  MARINE_UNAVAILABLE_WARNING,
} from '../../../src/application/forecast-service';
import type {
  MarineForecastProvider,
  WeatherForecastProvider,
} from '../../../src/application/ports';
import type { DailyWeather, MarineDay } from '../../../src/domain/types';
import { createLogger } from '../../../src/observability/logger';
import { aDay, aMarineDay } from '../../support/builders';
import { captureLogs } from '../../support/log-capture';
import { FakeClock, InMemoryForecastRepository } from '../../support/in-memory-repositories';

const MIN = 60_000;
const HOUR = 60 * MIN;
const policy = { freshForMs: 3 * HOUR, degradedFreshForMs: 15 * MIN, maxStaleMs: 24 * HOUR };
const biarritz = { latitude: 43.4806, longitude: -1.5568 };

function setup(
  options: {
    weather?: () => Promise<DailyWeather[]>;
    marine?: () => Promise<MarineDay[] | null>;
  } = {},
) {
  const repository = new InMemoryForecastRepository();
  const clock = new FakeClock();
  const weather: jest.Mocked<WeatherForecastProvider> = {
    getDailyForecast: jest.fn<Promise<DailyWeather[]>, [Coordinates]>(
      options.weather ?? (() => Promise.resolve([aDay({ date: '2026-10-07' })])),
    ),
  };
  const marine: jest.Mocked<MarineForecastProvider> = {
    getDailyMarine: jest.fn<Promise<MarineDay[] | null>, [Coordinates]>(
      options.marine ?? (() => Promise.resolve([aMarineDay({ date: '2026-10-07' })])),
    ),
  };
  const service = new ForecastService({
    repository,
    weather,
    marine,
    clock,
    logger: createLogger({ level: 'silent' }),
    policy,
  });
  return { service, repository, clock, weather, marine };
}

describe('gridCell', () => {
  it.each([
    [{ latitude: 43.4806, longitude: -1.5568 }, '43.5,-1.6'],
    [{ latitude: 45.92375, longitude: 6.86933 }, '45.9,6.9'],
    [{ latitude: 0.04, longitude: -0.04 }, '0.0,0.0'], // no "-0.0" key
    [{ latitude: -33.86, longitude: 151.21 }, '-33.9,151.2'],
  ])('%p → %s', (coords, key) => {
    expect(gridCell(coords).key).toBe(key);
  });

  it('nearby places share a cell; the fetch uses the cell centre', () => {
    const a = gridCell({ latitude: 43.4806, longitude: -1.5568 });
    const b = gridCell({ latitude: 43.47, longitude: -1.57 });

    expect(a).toEqual(b);
    expect(a).toMatchObject({ latitude: 43.5, longitude: -1.6 });
  });
});

describe('ForecastService', () => {
  it('miss: fetches from the provider (at the cell centre), stores, and serves', async () => {
    const { service, repository, weather } = setup();

    const forecast = await service.getForecast(biarritz);

    expect(weather.getDailyForecast).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 43.5, longitude: -1.6 }),
    );
    expect(forecast).toMatchObject({ isStale: false, warnings: [] });
    expect(forecast.days[0]?.marine?.waveHeightMaxM).toBe(1.8);
    expect(repository.snapshots.get('43.5,-1.6')?.marineStatus).toBe('available');
  });

  it('hit: serves from the cache without calling the provider while fresh', async () => {
    const { service, clock, weather } = setup();
    const first = await service.getForecast(biarritz);

    clock.advance(3 * HOUR - 1);
    const second = await service.getForecast(biarritz);

    expect(weather.getDailyForecast).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('stale: serves the cached copy immediately (isStale) and refreshes in the background', async () => {
    const { service, clock, weather, repository } = setup();
    await service.getForecast(biarritz);
    const firstFetch = repository.snapshots.get('43.5,-1.6')?.fetchedAt;

    clock.advance(3 * HOUR);
    const stale = await service.getForecast(biarritz);

    expect(stale.isStale).toBe(true);
    expect(stale.fetchedAt).toEqual(firstFetch);
    await service.drain(); // let the background refresh finish
    expect(weather.getDailyForecast).toHaveBeenCalledTimes(2);
    expect(repository.snapshots.get('43.5,-1.6')?.fetchedAt).not.toEqual(firstFetch);

    // The next request gets the refreshed data.
    expect((await service.getForecast(biarritz)).isStale).toBe(false);
  });

  it('expired: beyond maxStale it fetches synchronously instead of serving old data', async () => {
    const { service, clock, weather } = setup();
    await service.getForecast(biarritz);

    clock.advance(24 * HOUR);
    const forecast = await service.getForecast(biarritz);

    expect(forecast.isStale).toBe(false);
    expect(weather.getDailyForecast).toHaveBeenCalledTimes(2);
  });

  it('stale + provider down: still serves stale data; the failed background refresh is only logged', async () => {
    const { service, clock, weather } = setup();
    await service.getForecast(biarritz);
    weather.getDailyForecast.mockRejectedValue(new Error('provider down'));

    clock.advance(5 * HOUR);
    const forecast = await service.getForecast(biarritz);
    await service.drain();

    expect(forecast.isStale).toBe(true);
  });

  it('miss + provider down: the error propagates (nothing to serve)', async () => {
    const failure = new Error('provider down');
    const { service } = setup({ weather: () => Promise.reject(failure) });

    await expect(service.getForecast(biarritz)).rejects.toBe(failure);
  });

  it('single-flight: concurrent requests for one cell share a single provider call', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { service, weather } = setup({
      weather: async () => {
        await gate;
        return [aDay({ date: '2026-10-07' })];
      },
    });

    const requests = Array.from({ length: 50 }, () => service.getForecast(biarritz));
    release();
    const results = await Promise.all(requests);

    expect(weather.getDailyForecast).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((r) => r.fetchedAt.getTime())).size).toBe(1);
  });

  describe('marine data', () => {
    it('inland (no sea): stored as "none", no warning, normal freshness', async () => {
      const { service, repository, clock, weather } = setup({
        marine: () => Promise.resolve(null),
      });

      const forecast = await service.getForecast(biarritz);
      clock.advance(2 * HOUR);
      await service.getForecast(biarritz);

      expect(forecast.warnings).toEqual([]);
      expect(forecast.days[0]?.marine).toBeNull();
      expect(repository.snapshots.get('43.5,-1.6')?.marineStatus).toBe('none');
      expect(weather.getDailyForecast).toHaveBeenCalledTimes(1);
    });

    it('marine API down: serves weather with a warning, and the degraded snapshot expires sooner', async () => {
      const { service, repository, clock, weather } = setup({
        marine: () => Promise.reject(new Error('marine 503')),
      });

      const forecast = await service.getForecast(biarritz);
      expect(forecast.warnings).toEqual([MARINE_UNAVAILABLE_WARNING]);
      expect(repository.snapshots.get('43.5,-1.6')?.marineStatus).toBe('unavailable');

      clock.advance(15 * MIN); // degraded freshness (15 min), not the normal 3 hours
      const later = await service.getForecast(biarritz);
      await service.drain();

      expect(later.isStale).toBe(true);
      expect(weather.getDailyForecast).toHaveBeenCalledTimes(2);
    });
  });

  describe('the database is an optimisation, not a dependency', () => {
    it('reads through to the provider when the cache read fails', async () => {
      const { service, repository, weather } = setup();
      repository.failReads = true;

      await expect(service.getForecast(biarritz)).resolves.toMatchObject({ isStale: false });
      expect(weather.getDailyForecast).toHaveBeenCalledTimes(1);
    });

    it('still serves fetched data when the cache write fails', async () => {
      const { service, repository } = setup();
      repository.failWrites = true;

      await expect(service.getForecast(biarritz)).resolves.toMatchObject({ isStale: false });
      expect(repository.snapshots.size).toBe(0);
    });
  });
});

describe('ForecastService logs where the data came from', () => {
  it('logs source=open-meteo on a miss, source=cache on a hit, source=cache-stale when stale', async () => {
    const { logger, lines } = captureLogs('info');
    const clock = new FakeClock();
    const service = new ForecastService({
      repository: new InMemoryForecastRepository(),
      weather: { getDailyForecast: () => Promise.resolve([aDay({ date: '2026-10-07' })]) },
      marine: { getDailyMarine: () => Promise.resolve(null) },
      clock,
      logger,
      policy,
    });

    await service.getForecast(biarritz); // miss → live fetch
    clock.advance(10 * MIN);
    await service.getForecast(biarritz); // fresh → cache
    clock.advance(3 * HOUR);
    await service.getForecast(biarritz); // stale → cache + background refresh
    await service.drain();

    expect(lines().map((l) => [l.source, l.msg])).toEqual([
      ['open-meteo', 'Forecast not in cache; fetching live from Open-Meteo'],
      ['open-meteo', 'Forecast fetched live from Open-Meteo and stored in cache'],
      ['cache', 'Forecast served from cache (MySQL)'],
      [
        'cache-stale',
        'Forecast served STALE from cache; refreshing from Open-Meteo in the background',
      ],
      ['open-meteo', 'Forecast fetched live from Open-Meteo and stored in cache'],
    ]);
    expect(lines()[2]).toMatchObject({ gridKey: '43.5,-1.6', ageSeconds: 600 });
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
