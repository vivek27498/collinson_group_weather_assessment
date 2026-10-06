import { z } from 'zod';
import type { Coordinates, WeatherForecastProvider } from '../../application/ports';
import type { DailyWeather } from '../../domain/types';
import type { JsonHttpClient } from '../http/json-http-client';
import { nullableNumberArray, parseResponse } from './parse-response';

const UPSTREAM = 'open-meteo.forecast';
export const FORECAST_DAYS = 7;

export const DAILY_VARIABLES = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'snowfall_sum',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'sunshine_duration',
  'uv_index_max',
] as const;

const responseSchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    weather_code: nullableNumberArray,
    temperature_2m_max: nullableNumberArray,
    temperature_2m_min: nullableNumberArray,
    precipitation_sum: nullableNumberArray,
    precipitation_probability_max: nullableNumberArray,
    snowfall_sum: nullableNumberArray,
    wind_speed_10m_max: nullableNumberArray,
    wind_gusts_10m_max: nullableNumberArray,
    sunshine_duration: nullableNumberArray,
    uv_index_max: nullableNumberArray,
  }),
  // Snow depth is only available hourly; we take each day's maximum.
  hourly: z.object({ time: z.array(z.string()), snow_depth: nullableNumberArray }).optional(),
});
type ForecastResponse = z.infer<typeof responseSchema>;

/**
 * Adapter (anti-corruption layer): Open-Meteo's column-oriented arrays → domain DailyWeather rows.
 * `timezone=auto` makes "days" the location's local calendar days, not UTC.
 */
export class OpenMeteoForecast implements WeatherForecastProvider {
  constructor(
    private readonly http: JsonHttpClient,
    private readonly baseUrl: string,
  ) {}

  async getDailyForecast({ latitude, longitude }: Coordinates): Promise<DailyWeather[]> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('daily', DAILY_VARIABLES.join(','));
    url.searchParams.set('hourly', 'snow_depth');
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('forecast_days', String(FORECAST_DAYS));

    const payload = await this.http.getJson(url, { upstream: UPSTREAM });
    return toDailyWeather(parseResponse(responseSchema, payload, UPSTREAM));
  }
}

export function toDailyWeather({ daily, hourly }: ForecastResponse): DailyWeather[] {
  const snowDepthByDate = maxPerDate(hourly?.time ?? [], hourly?.snow_depth ?? []);
  const days: DailyWeather[] = [];

  daily.time.forEach((date, i) => {
    const at = (column: readonly (number | null)[]): number | null => column.at(i) ?? null;
    const core = {
      weatherCode: at(daily.weather_code),
      temperatureMaxC: at(daily.temperature_2m_max),
      temperatureMinC: at(daily.temperature_2m_min),
      precipitationSumMm: at(daily.precipitation_sum),
      snowfallSumCm: at(daily.snowfall_sum),
      windSpeedMaxKmh: at(daily.wind_speed_10m_max),
      windGustsMaxKmh: at(daily.wind_gusts_10m_max),
    };
    // Without the core values we can't score the day honestly; skip it rather than invent zeros.
    if (!allPresent(core)) return;

    days.push({
      date,
      ...core,
      precipitationProbabilityMaxPct: at(daily.precipitation_probability_max),
      snowDepthMaxM: snowDepthByDate.get(date) ?? null,
      sunshineDurationS: at(daily.sunshine_duration),
      uvIndexMax: at(daily.uv_index_max),
    });
  });

  return days;
}

/** Type guard: narrows `{ a: number | null }` to `{ a: number }` when nothing is null. */
function allPresent<T extends Record<string, number | null>>(
  values: T,
): values is { [K in keyof T]: Exclude<T[K], null> } {
  return Object.values(values).every((v) => v !== null);
}

/** Groups hourly values ("2026-10-07T13:00") by local date and keeps the max non-null value. */
export function maxPerDate(
  times: readonly string[],
  values: readonly (number | null)[],
): Map<string, number> {
  const result = new Map<string, number>();
  times.forEach((time, i) => {
    const value = values.at(i);
    if (value === null || value === undefined) return;
    const date = time.slice(0, 10);
    const current = result.get(date);
    if (current === undefined || value > current) result.set(date, value);
  });
  return result;
}
