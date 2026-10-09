import { z } from 'zod';
import type { Coordinates, WeatherForecastProvider } from '../../services/interfaces';
import type { DailyWeather } from '../../types';
import type { JsonHttpClient } from '../../modules/http';
import { nullableNumberArray, parseResponse } from './parse-response';

const SERVICE_NAME = 'open-meteo.forecast';
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
 * Gets the 7-day weather forecast from Open-Meteo and converts it into our DailyWeather objects.
 * `timezone=auto` means each "day" is a local calendar day at that place, not a UTC day.
 */
export class OpenMeteoForecast implements WeatherForecastProvider {
  constructor(
    private http: JsonHttpClient,
    private baseUrl: string,
  ) {}

  async getDailyForecast({ latitude, longitude }: Coordinates): Promise<DailyWeather[]> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('daily', DAILY_VARIABLES.join(','));
    url.searchParams.set('hourly', 'snow_depth');
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('forecast_days', String(FORECAST_DAYS));

    const payload = await this.http.getJson(url, SERVICE_NAME);
    return toDailyWeather(parseResponse(responseSchema, payload, SERVICE_NAME));
  }
}

/**
 * Open-Meteo sends one array per variable ("columns"):
 *   daily.time = [day1, day2, ...], daily.temperature_2m_max = [19.7, 17.3, ...]
 * We turn that into one object per day ("rows"):
 *   [{ date: day1, temperatureMaxC: 19.7, ... }, { date: day2, temperatureMaxC: 17.3, ... }]
 */
export function toDailyWeather({ daily, hourly }: ForecastResponse): DailyWeather[] {
  const snowDepthByDate = maxPerDate(hourly?.time ?? [], hourly?.snow_depth ?? []);
  const days: DailyWeather[] = [];

  daily.time.forEach((date, i) => {
    // The value for day `i` in a column, or null if missing.
    const valueFor = (column: (number | null)[]): number | null => column.at(i) ?? null;

    const weatherCode = valueFor(daily.weather_code);
    const temperatureMaxC = valueFor(daily.temperature_2m_max);
    const temperatureMinC = valueFor(daily.temperature_2m_min);
    const precipitationSumMm = valueFor(daily.precipitation_sum);
    const snowfallSumCm = valueFor(daily.snowfall_sum);
    const windSpeedMaxKmh = valueFor(daily.wind_speed_10m_max);
    const windGustsMaxKmh = valueFor(daily.wind_gusts_10m_max);

    // Without these core values we can't score the day fairly, so we skip it
    // rather than pretend the missing values are 0.
    if (
      weatherCode === null ||
      temperatureMaxC === null ||
      temperatureMinC === null ||
      precipitationSumMm === null ||
      snowfallSumCm === null ||
      windSpeedMaxKmh === null ||
      windGustsMaxKmh === null
    ) {
      return;
    }

    days.push({
      date,
      weatherCode,
      temperatureMaxC,
      temperatureMinC,
      precipitationSumMm,
      snowfallSumCm,
      windSpeedMaxKmh,
      windGustsMaxKmh,
      // These are optional: the scorers cope with null.
      precipitationProbabilityMaxPct: valueFor(daily.precipitation_probability_max),
      snowDepthMaxM: snowDepthByDate.get(date) ?? null,
      sunshineDurationS: valueFor(daily.sunshine_duration),
      uvIndexMax: valueFor(daily.uv_index_max),
    });
  });

  return days;
}

/** Groups hourly values ("2026-10-07T13:00") by local date and keeps the max non-null value. */
export function maxPerDate(times: string[], values: (number | null)[]): Map<string, number> {
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
