import type { JsonHttpClient } from '../../../src/infrastructure/http/json-http-client';
import { UpstreamRequestError } from '../../../src/infrastructure/http/json-http-client';
import {
  DAILY_VARIABLES,
  maxPerDate,
  OpenMeteoForecast,
  toDailyWeather,
} from '../../../src/infrastructure/open-meteo/open-meteo-forecast';
import { OpenMeteoGeocoder } from '../../../src/infrastructure/open-meteo/open-meteo-geocoder';
import { OpenMeteoMarine } from '../../../src/infrastructure/open-meteo/open-meteo-marine';
import { loadFixture, type OpenMeteoFixture } from '../../support/fixtures';

/** Fake HTTP client that returns a recorded payload and remembers the URL it was asked for. */
function httpReturning(payload: unknown) {
  const calls: { url: URL; upstream: string }[] = [];
  const http: JsonHttpClient = {
    getJson: (url, { upstream }) => {
      calls.push({ url, upstream });
      return Promise.resolve(payload);
    },
  };
  return { http, calls, lastUrl: () => calls.at(-1)!.url };
}
const fixture = (name: OpenMeteoFixture) => httpReturning(loadFixture(name));
const chamonix = { latitude: 45.92375, longitude: 6.86933 };

describe('OpenMeteoGeocoder', () => {
  const BASE = 'https://geocoding-api.open-meteo.com/v1/search';

  it('maps a real response to domain locations', async () => {
    const { http } = fixture('geocode-chamonix');
    const [first] = await new OpenMeteoGeocoder(http, BASE).search({ name: 'Chamonix' });

    expect(first).toEqual({
      id: 3027301,
      name: 'Chamonix',
      region: 'Rhône-Alpes',
      country: 'France',
      countryCode: 'FR',
      latitude: 45.92375,
      longitude: 6.86933,
      elevationM: 1060,
      timezone: 'Europe/Paris',
      population: 10614,
    });
  });

  it('builds the query with URLSearchParams (user input stays an encoded value)', async () => {
    const { http, lastUrl, calls } = fixture('geocode-empty');
    await new OpenMeteoGeocoder(http, BASE).search({
      name: "Paris&count=1' OR 1=1",
      countryCode: 'US',
    });

    const url = lastUrl();
    expect(url.origin + url.pathname).toBe(BASE);
    expect(url.searchParams.get('name')).toBe("Paris&count=1' OR 1=1"); // one value, not new params
    expect(url.searchParams.get('count')).toBe('10');
    expect(url.searchParams.get('countryCode')).toBe('US');
    expect(calls[0]?.upstream).toBe('open-meteo.geocoding');
  });

  it('omits countryCode when not given', async () => {
    const { http, lastUrl } = fixture('geocode-empty');
    await new OpenMeteoGeocoder(http, BASE).search({ name: 'Paris' });

    expect(lastUrl().searchParams.has('countryCode')).toBe(false);
  });

  it('returns candidates best-first: Paris → France, Paris+US → Texas', async () => {
    const paris = await new OpenMeteoGeocoder(fixture('geocode-paris').http, BASE).search({
      name: 'Paris',
    });
    const parisUs = await new OpenMeteoGeocoder(fixture('geocode-paris-us').http, BASE).search({
      name: 'Paris',
      countryCode: 'US',
    });

    expect(paris[0]).toMatchObject({ countryCode: 'FR', region: 'Île-de-France Region' });
    expect(paris.length).toBeGreaterThan(1);
    expect(parisUs[0]).toMatchObject({ countryCode: 'US', region: 'Texas' });
  });

  it('returns [] when nothing matches (Open-Meteo omits "results" entirely)', async () => {
    const { http } = fixture('geocode-empty');
    await expect(new OpenMeteoGeocoder(http, BASE).search({ name: 'Xyzzyqwv' })).resolves.toEqual(
      [],
    );
  });

  it('rejects a payload that breaks the contract as a non-retryable upstream error', async () => {
    const { http } = httpReturning({ results: [{ id: 'not-a-number', name: 7 }] });

    await expect(new OpenMeteoGeocoder(http, BASE).search({ name: 'x' })).rejects.toMatchObject({
      failure: 'invalid_response',
      retryable: false,
    });
  });
});

describe('OpenMeteoForecast', () => {
  const BASE = 'https://api.open-meteo.com/v1/forecast';

  it('requests 7 local days with every variable the scorers need', async () => {
    const { http, lastUrl } = fixture('forecast-chamonix');
    await new OpenMeteoForecast(http, BASE).getDailyForecast(chamonix);

    const params = lastUrl().searchParams;
    expect(params.get('latitude')).toBe('45.92375');
    expect(params.get('longitude')).toBe('6.86933');
    expect(params.get('daily')?.split(',')).toEqual([...DAILY_VARIABLES]);
    expect(params.get('hourly')).toBe('snow_depth');
    expect(params.get('timezone')).toBe('auto');
    expect(params.get('forecast_days')).toBe('7');
  });

  it('maps the real column-oriented response into 7 day rows', async () => {
    const days = await new OpenMeteoForecast(
      fixture('forecast-chamonix').http,
      BASE,
    ).getDailyForecast(chamonix);

    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({
      date: '2026-10-06',
      weatherCode: 3,
      temperatureMaxC: 19.7,
      temperatureMinC: 11.4,
      precipitationSumMm: 0,
      precipitationProbabilityMaxPct: 0,
      snowfallSumCm: 0,
      snowDepthMaxM: 0,
      windSpeedMaxKmh: 9.9,
      windGustsMaxKmh: 17.6,
      sunshineDurationS: 37951.85,
      uvIndexMax: 4.55,
    });
  });

  const column = (values: (number | null)[]) => values;
  const minimal = (overrides: Record<string, (number | null)[]> = {}) => ({
    daily: {
      time: ['2026-10-07', '2026-10-08'],
      weather_code: column([0, 0]),
      temperature_2m_max: column([10, 11]),
      temperature_2m_min: column([1, 2]),
      precipitation_sum: column([0, 0]),
      precipitation_probability_max: column([null, 10]),
      snowfall_sum: column([0, 0]),
      wind_speed_10m_max: column([5, 5]),
      wind_gusts_10m_max: column([9, 9]),
      sunshine_duration: column([null, 100]),
      uv_index_max: column([null, 2]),
      ...overrides,
    },
  });

  it('keeps optional nulls as null', () => {
    const [first] = toDailyWeather(minimal());

    expect(first).toMatchObject({
      precipitationProbabilityMaxPct: null,
      sunshineDurationS: null,
      uvIndexMax: null,
      snowDepthMaxM: null, // no hourly block at all
    });
  });

  it('skips a day whose core values are missing instead of inventing zeros', () => {
    const days = toDailyWeather(minimal({ temperature_2m_max: [null, 11] }));

    expect(days.map((d) => d.date)).toEqual(['2026-10-08']);
  });

  it('rejects a payload missing a daily column', async () => {
    const { http } = httpReturning({ daily: { time: ['2026-10-07'] } });

    await expect(
      new OpenMeteoForecast(http, BASE).getDailyForecast(chamonix),
    ).rejects.toBeInstanceOf(UpstreamRequestError);
  });
});

describe('maxPerDate', () => {
  it('takes the daily max of hourly values, ignoring nulls', () => {
    const result = maxPerDate(
      ['2026-10-07T00:00', '2026-10-07T12:00', '2026-10-08T00:00', '2026-10-08T01:00'],
      [0.4, 0.6, null, null],
    );

    expect(Object.fromEntries(result)).toEqual({ '2026-10-07': 0.6 });
  });
});

describe('OpenMeteoMarine', () => {
  const BASE = 'https://marine-api.open-meteo.com/v1/marine';

  it('maps a real coastal response', async () => {
    const { http, lastUrl } = fixture('marine-biarritz');
    const days = await new OpenMeteoMarine(http, BASE).getDailyMarine({
      latitude: 43.48,
      longitude: -1.55,
    });

    expect(days).toHaveLength(7);
    expect(days?.[0]).toEqual({
      date: '2026-10-06',
      waveHeightMaxM: 0.9,
      wavePeriodMaxS: 10.8,
      swellWaveHeightMaxM: 0.9,
    });
    expect(lastUrl().searchParams.get('daily')).toBe(
      'wave_height_max,wave_period_max,swell_wave_height_max',
    );
  });

  it('returns null for an inland point (the real API answers 200 with all-null waves)', async () => {
    const { http } = fixture('marine-inland-chamonix');

    await expect(new OpenMeteoMarine(http, BASE).getDailyMarine(chamonix)).resolves.toBeNull();
  });
});
