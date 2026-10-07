import type { GeoLocation } from '../domain/types';
import type { Logger } from '../observability/logger';
import type { Clock } from './clock';
import type { GeocodeCache, Geocoder, LocationQuery } from './ports';

export interface CachedGeocoderOptions {
  readonly clock: Clock;
  readonly logger: Logger;
  /** Place names → coordinates practically never change: cache found results for a long time. */
  readonly ttlMs: number;
  /** "No such place" is cached too, briefly, so repeated typos don't each cost an upstream call. */
  readonly negativeTtlMs: number;
  readonly onCacheOutcome?: (outcome: 'hit' | 'miss') => void;
}

/** One cache key per normalised query: "paris|US", "paris|". */
export function geocodeQueryKey(query: LocationQuery): string {
  return `${query.name.toLocaleLowerCase('en')}|${query.countryCode ?? ''}`;
}

/**
 * Decorator: adds a persistent cache in front of any Geocoder (the same pattern as the HTTP
 * retry decorator). The cache is best-effort: if MySQL is unavailable we still answer,
 * straight from the provider.
 */
export class CachedGeocoder implements Geocoder {
  constructor(
    private readonly inner: Geocoder,
    private readonly cache: GeocodeCache,
    private readonly options: CachedGeocoderOptions,
  ) {}

  async search(query: LocationQuery): Promise<GeoLocation[]> {
    const key = geocodeQueryKey(query);
    const now = this.options.clock.now();

    const cached = await this.cache.get(key).catch((err: unknown) => {
      this.options.logger.error({ err }, 'Geocode cache read failed, reading through');
      return null;
    });
    if (cached) {
      const ttl = cached.locations.length > 0 ? this.options.ttlMs : this.options.negativeTtlMs;
      if (now.getTime() - cached.fetchedAt.getTime() < ttl) {
        this.options.onCacheOutcome?.('hit');
        return [...cached.locations];
      }
    }

    this.options.onCacheOutcome?.('miss');
    const locations = await this.inner.search(query);
    await this.cache.put(key, locations, now).catch((err: unknown) => {
      this.options.logger.error({ err }, 'Geocode cache write failed');
    });
    return locations;
  }
}
