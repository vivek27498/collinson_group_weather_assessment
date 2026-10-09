import {
  DbFirstGeocoder,
  geocodeQueryKey,
  toGeocodeSearch,
} from '../../../../src/services/location/db-first-geocoder';
import type { Geocoder } from '../../../../src/services/interfaces';
import type { GeoLocation } from '../../../../src/types';
import { createLogger } from '../../../../src/modules/logger';
import { FakeClock, InMemoryGeocodeStore } from '../../../support/in-memory-repositories';
import { captureLogs } from '../../../support/log-capture';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const paris: GeoLocation = {
  id: 2988507,
  name: 'Paris',
  region: 'Île-de-France',
  country: 'France',
  countryCode: 'FR',
  latitude: 48.85,
  longitude: 2.35,
  elevationM: 42,
  timezone: 'Europe/Paris',
  population: 2_138_551,
};

function setup(results: GeoLocation[] = [paris]) {
  const inner: jest.Mocked<Geocoder> = { search: jest.fn().mockResolvedValue(results) };
  const cache = new InMemoryGeocodeStore();
  const clock = new FakeClock();
  const geocoder = new DbFirstGeocoder(inner, cache, {
    clock,
    logger: createLogger({ level: 'silent' }),
    ttlMs: 30 * DAY,
    negativeTtlMs: DAY,
  });
  return { geocoder, inner, cache, clock };
}

describe('geocodeQueryKey', () => {
  it('is case-insensitive on the name and includes the country filter', () => {
    expect(geocodeQueryKey({ name: 'Paris' })).toBe('paris|');
    expect(geocodeQueryKey({ name: 'PARIS', countryCode: 'US' })).toBe('paris|US');
  });
});

describe('toGeocodeSearch', () => {
  it('lower-cases the name and uses an empty country code when none is given', () => {
    expect(toGeocodeSearch({ name: 'Paris' })).toEqual({ name: 'paris', countryCode: '' });
    expect(toGeocodeSearch({ name: 'PARIS', countryCode: 'US' })).toEqual({
      name: 'paris',
      countryCode: 'US',
    });
  });
});

describe('DbFirstGeocoder', () => {
  it('caches results: the second identical query never reaches the provider', async () => {
    const { geocoder, inner } = setup();

    await geocoder.search({ name: 'Paris' });
    const second = await geocoder.search({ name: 'paris' });

    expect(second).toEqual([paris]);
    expect(inner.search).toHaveBeenCalledTimes(1);
  });

  it('keeps different country filters apart', async () => {
    const { geocoder, inner } = setup();

    await geocoder.search({ name: 'Paris' });
    await geocoder.search({ name: 'Paris', countryCode: 'US' });

    expect(inner.search).toHaveBeenCalledTimes(2);
  });

  it('refetches after the TTL', async () => {
    const { geocoder, inner, clock } = setup();
    await geocoder.search({ name: 'Paris' });

    clock.advance(30 * DAY);
    await geocoder.search({ name: 'Paris' });

    expect(inner.search).toHaveBeenCalledTimes(2);
  });

  it('caches "not found" too, but only for the shorter negative TTL', async () => {
    const { geocoder, inner, clock } = setup([]);

    await geocoder.search({ name: 'Xyzzy' });
    clock.advance(DAY - 1);
    await geocoder.search({ name: 'Xyzzy' });
    expect(inner.search).toHaveBeenCalledTimes(1);

    clock.advance(1);
    await geocoder.search({ name: 'Xyzzy' });
    expect(inner.search).toHaveBeenCalledTimes(2);
  });

  it('deduplication: concurrent identical lookups share one provider call and one cache write', async () => {
    const { geocoder, inner, cache } = setup();
    const put = jest.spyOn(cache, 'put');

    const results = await Promise.all(
      Array.from({ length: 50 }, () => geocoder.search({ name: 'Paris' })),
    );

    expect(inner.search).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r[0]?.id === paris.id)).toBe(true);
    expect(results[0]).not.toBe(results[1]); // each caller gets its own array
  });

  it('logs whether the location came from the cache or a live lookup', async () => {
    const { logger, lines } = captureLogs('info');
    const inner: Geocoder = { search: () => Promise.resolve([paris]) };
    const geocoder = new DbFirstGeocoder(inner, new InMemoryGeocodeStore(), {
      clock: new FakeClock(),
      logger,
      ttlMs: 30 * DAY,
      negativeTtlMs: DAY,
    });

    await geocoder.search({ name: 'Paris' });
    await geocoder.search({ name: 'Paris' });

    expect(lines().map((l) => [l.source, l.query])).toEqual([
      ['open-meteo', 'paris|'],
      ['cache', 'paris|'],
    ]);
  });

  it('still answers when the cache is unavailable (best-effort cache)', async () => {
    const { geocoder, cache, inner } = setup();
    cache.failReads = true;
    cache.failWrites = true;

    await expect(geocoder.search({ name: 'Paris' })).resolves.toEqual([paris]);
    expect(inner.search).toHaveBeenCalledTimes(1);
  });
});
