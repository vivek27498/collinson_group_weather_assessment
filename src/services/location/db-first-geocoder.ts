import type { GeoLocation } from '../../types';
import type { Logger } from '../../modules/logger';
import type { Clock } from '../../utils/clock';
import type { GeocodeSearch, GeocodeStore, Geocoder, LocationQuery } from '../interfaces';
import { RequestDeduplicator } from '../../utils/request-deduplicator';

export interface DbFirstGeocoderOptions {
  clock: Clock;
  logger: Logger;
  /** How long to keep places we found. Coordinates of a town practically never change. */
  ttlMs: number;
  /** How long to remember "no such place", so repeated typos don't each call Open-Meteo. */
  negativeTtlMs: number;
}

/** The search as saved in the database: lower-cased name, and '' when there's no country. */
export function toGeocodeSearch(query: LocationQuery): GeocodeSearch {
  return { name: query.name.toLocaleLowerCase('en'), countryCode: query.countryCode ?? '' };
}

/**
 * A short text label for a search, e.g. "paris|US" or "paris|" (no country). Used only in memory,
 * to spot identical lookups running at the same time, and in log lines. Not stored.
 */
export function geocodeQueryKey(query: LocationQuery): string {
  const search = toGeocodeSearch(query);
  return `${search.name}|${search.countryCode}`;
}

/**
 * Looks places up in our MySQL database first, and only asks Open-Meteo when we don't have a
 * recent answer saved (then saves it). It wraps another Geocoder (the Decorator pattern, the same
 * idea as RetryingJsonClient). If the database fails we still answer, straight from Open-Meteo.
 */
export class DbFirstGeocoder implements Geocoder {
  private inner: Geocoder;
  private store: GeocodeStore;
  private clock: Clock;
  private logger: Logger;
  private ttlMs: number;
  private negativeTtlMs: number;
  // Added after a load test: 200 requests at once for a new city made 200 Open-Meteo calls.
  // Now they share one lookup.
  private lookups = new RequestDeduplicator<GeoLocation[]>();

  constructor(inner: Geocoder, store: GeocodeStore, options: DbFirstGeocoderOptions) {
    this.inner = inner;
    this.store = store;
    this.clock = options.clock;
    this.logger = options.logger;
    this.ttlMs = options.ttlMs;
    this.negativeTtlMs = options.negativeTtlMs;
  }

  async search(query: LocationQuery): Promise<GeoLocation[]> {
    const key = geocodeQueryKey(query);
    const locations = await this.lookups.run(key, () => this.lookup(key, query));
    // Return a copy, so one caller changing the array can't affect the others waiting on it.
    return [...locations];
  }

  private async lookup(key: string, query: LocationQuery): Promise<GeoLocation[]> {
    const now = this.clock.now();

    // 1. Try the database (if it fails, we treat it as "not saved").
    const search = toGeocodeSearch(query);
    const saved = await this.store.get(search).catch((err: unknown) => {
      this.logger.error({ err }, 'Geocode cache read failed, reading through');
      return null;
    });

    if (saved) {
      const found = saved.locations.length > 0;
      const maxAgeMs = found ? this.ttlMs : this.negativeTtlMs;
      const ageMs = now.getTime() - saved.fetchedAt.getTime();
      if (ageMs < maxAgeMs) {
        this.logger.info(
          { source: 'cache', query: key, candidates: saved.locations.length },
          'Location served from cache (MySQL)',
        );
        return [...saved.locations];
      }
    }

    // 2. Ask Open-Meteo. (`key` contains only validated characters, so it's safe to log.)
    this.logger.info(
      { source: 'open-meteo', query: key },
      'Location not in cache; looking it up live on Open-Meteo geocoding',
    );
    const locations = await this.inner.search(query);

    // 3. Save the result for next time (even an empty one). A failed save is only logged.
    await this.store.put(search, locations, now).catch((err: unknown) => {
      this.logger.error({ err }, 'Geocode cache write failed');
    });
    return locations;
  }
}
