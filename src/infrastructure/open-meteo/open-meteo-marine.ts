import { z } from 'zod';
import type { Coordinates, MarineForecastProvider } from '../../application/ports';
import type { MarineDay } from '../../domain/types';
import type { JsonHttpClient } from '../../modules/http';
import { FORECAST_DAYS } from './open-meteo-forecast';
import { nullableNumberArray, parseResponse } from './parse-response';

const UPSTREAM = 'open-meteo.marine';

const responseSchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    wave_height_max: nullableNumberArray,
    wave_period_max: nullableNumberArray,
    swell_wave_height_max: nullableNumberArray,
  }),
});

/**
 * Adapter: Open-Meteo Marine API → domain MarineDay[].
 *
 * For inland points the API does NOT return an error: it returns HTTP 200 with every value null
 * (verified against the live API, see test/fixtures/open-meteo/marine-inland-chamonix.json).
 * We translate "no wave data at all" into `null` = no sea here, which the surf scorer turns into
 * NOT_APPLICABLE.
 */
export class OpenMeteoMarine implements MarineForecastProvider {
  constructor(
    private readonly http: JsonHttpClient,
    private readonly baseUrl: string,
  ) {}

  async getDailyMarine({ latitude, longitude }: Coordinates): Promise<MarineDay[] | null> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('daily', 'wave_height_max,wave_period_max,swell_wave_height_max');
    url.searchParams.set('timezone', 'auto');
    url.searchParams.set('forecast_days', String(FORECAST_DAYS));

    const payload = await this.http.getJson(url, { upstream: UPSTREAM });
    const { daily } = parseResponse(responseSchema, payload, UPSTREAM);

    if (daily.wave_height_max.every((h) => h === null)) {
      return null;
    }
    return daily.time.map((date, i) => ({
      date,
      waveHeightMaxM: daily.wave_height_max.at(i) ?? null,
      wavePeriodMaxS: daily.wave_period_max.at(i) ?? null,
      swellWaveHeightMaxM: daily.swell_wave_height_max.at(i) ?? null,
    }));
  }
}
