import type { GeoLocation } from '../domain/types';
import type { Logger } from '../observability/logger';
import type { Clock } from './clock';
import type { GeocodeCache, Geocoder, LocationQuery } from './ports';
import { SingleFlight } from './single-flight';

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
  // Added after the k6 stampede test: 200 concurrent requests for a new city made 200 geocoding
  // calls and 200 competing upserts of the same rows (p95 6.3 s). Now they share one lookup.
  private readonly flights = new SingleFlight<GeoLocation[]>();

  constructor(
    private readonly inner: Geocoder,
    private readonly cache: GeocodeCache,
    private readonly options: CachedGeocoderOptions,
  ) {}

  async search(query: LocationQuery): Promise<GeoLocation[]> {
    const key = geocodeQueryKey(query);
    // Copy, so one caller can't mutate the array other waiters receive.
    return [...(await this.flights.run(key, () => this.lookup(key, query)))];
  }

  private async lookup(key: string, query: LocationQuery): Promise<GeoLocation[]> {
    const now = this.options.clock.now();

    const cached = await this.cache.get(key).catch((err: unknown) => {
      this.options.logger.error({ err }, 'Geocode cache read failed, reading through');
      return null;
    });
    if (cached) {
      const ttl = cached.locations.length > 0 ? this.options.ttlMs : this.options.negativeTtlMs;
      if (now.getTime() - cached.fetchedAt.getTime() < ttl) {
        this.options.onCacheOutcome?.('hit');
        this.options.logger.info(
          { source: 'cache', query: key, candidates: cached.locations.length },
          'Location served from cache (MySQL)',
        );
        return [...cached.locations];
      }
    }

    this.options.onCacheOutcome?.('miss');
    // `key` is the validated, normalised query (allow-listed characters only), so safe to log.
    this.options.logger.info(
      { source: 'open-meteo', query: key },
      'Location not in cache; looking it up live on Open-Meteo geocoding',
    );
    const locations = await this.inner.search(query);
    await this.cache.put(key, locations, now).catch((err: unknown) => {
      this.options.logger.error({ err }, 'Geocode cache write failed');
    });
    return locations;
  }
}
