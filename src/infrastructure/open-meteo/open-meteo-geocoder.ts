import { z } from 'zod';
import type { Geocoder, LocationQuery } from '../../application/ports';
import type { GeoLocation } from '../../domain/types';
import type { JsonHttpClient } from '../../modules/http';
import { parseResponse } from './parse-response';

const UPSTREAM = 'open-meteo.geocoding';
const MAX_CANDIDATES = 10;

// Only the fields we use. Unknown fields are ignored, so Open-Meteo adding fields can't break us.
const resultSchema = z.object({
  id: z.number(),
  name: z.string(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  elevation: z.number().optional(),
  country_code: z.string().optional(),
  country: z.string().optional(),
  admin1: z.string().optional(),
  timezone: z.string().optional(),
  population: z.number().optional(),
});

// Note: when nothing matches, Open-Meteo omits `results` entirely rather than returning [].
const responseSchema = z.object({ results: z.array(resultSchema).optional() });

/** Adapter: Open-Meteo Geocoding API → domain GeoLocation[]. */
export class OpenMeteoGeocoder implements Geocoder {
  constructor(
    private readonly http: JsonHttpClient,
    private readonly baseUrl: string,
  ) {}

  async search(query: LocationQuery): Promise<GeoLocation[]> {
    // Built with URL/URLSearchParams: user input is always encoded as a value, never spliced
    // into the URL string, so it can't change the path or add parameters.
    const url = new URL(this.baseUrl);
    url.searchParams.set('name', query.name);
    url.searchParams.set('count', String(MAX_CANDIDATES));
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');
    if (query.countryCode) url.searchParams.set('countryCode', query.countryCode);

    const payload = await this.http.getJson(url, { upstream: UPSTREAM });
    const { results = [] } = parseResponse(responseSchema, payload, UPSTREAM);

    return results.map((r) => ({
      id: r.id,
      name: r.name,
      region: r.admin1 ?? null,
      country: r.country ?? null,
      countryCode: r.country_code ?? null,
      latitude: r.latitude,
      longitude: r.longitude,
      elevationM: r.elevation ?? null,
      timezone: r.timezone ?? null,
      population: r.population ?? null,
    }));
  }
}
