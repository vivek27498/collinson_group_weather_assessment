import { z } from 'zod';
import type { GeocodeSearch, SavedGeocode, GeocodeStore } from '../services/interfaces';
import type { GeoLocation } from '../types';
import type { Location } from '../generated/prisma/client';
import type { Database } from '../modules/database';

// Even our own JSON column is validated on the way out: a bad row is a cache miss, not a crash.
const locationIdsSchema = z.array(z.number().int());

/** Stores place-name lookups in MySQL using Prisma (values are always sent as parameters). */
export class PrismaGeocodeStore implements GeocodeStore {
  constructor(private db: Database) {}

  async get(search: GeocodeSearch): Promise<SavedGeocode | null> {
    const row = await this.db.geocodeQuery.findUnique({
      where: { name_countryCode: { name: search.name, countryCode: search.countryCode } },
    });
    if (!row) return null;

    const ids = locationIdsSchema.safeParse(row.locationIds);
    if (!ids.success) return null;

    const rows = await this.db.location.findMany({ where: { id: { in: ids.data } } });
    const byId = new Map(rows.map((r) => [r.id, toGeoLocation(r)]));
    const locations: GeoLocation[] = [];
    for (const id of ids.data) {
      const location = byId.get(id);
      // A referenced location has gone missing: treat the entry as a miss and refetch.
      if (!location) return null;
      locations.push(location);
    }
    return { locations, fetchedAt: row.fetchedAt };
  }

  async put(search: GeocodeSearch, locations: GeoLocation[], fetchedAt: Date): Promise<void> {
    const locationIds = locations.map((l) => l.id);
    await this.db.$transaction([
      ...locations.map((location) => {
        const data = toRow(location);
        return this.db.location.upsert({ where: { id: location.id }, create: data, update: data });
      }),
      this.db.geocodeQuery.upsert({
        where: { name_countryCode: { name: search.name, countryCode: search.countryCode } },
        create: { name: search.name, countryCode: search.countryCode, locationIds, fetchedAt },
        update: { locationIds, fetchedAt },
      }),
    ]);
  }
}

function toRow(location: GeoLocation) {
  return {
    id: location.id,
    name: location.name,
    region: location.region,
    country: location.country,
    countryCode: location.countryCode,
    latitude: location.latitude,
    longitude: location.longitude,
    elevationM: location.elevationM,
    timezone: location.timezone,
    population: location.population,
  };
}

function toGeoLocation(row: Location): GeoLocation {
  return {
    id: row.id,
    name: row.name,
    region: row.region,
    country: row.country,
    countryCode: row.countryCode,
    latitude: row.latitude,
    longitude: row.longitude,
    elevationM: row.elevationM,
    timezone: row.timezone,
    population: row.population,
  };
}
