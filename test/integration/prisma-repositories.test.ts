import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql';
import type { ForecastSnapshot } from '../../src/application/ports';
import type { GeoLocation } from '../../src/domain/types';
import { createDatabase, pingDatabase, type Database } from '../../src/modules/database';
import { PrismaForecastRepository } from '../../src/infrastructure/repositories/prisma-forecast-repository';
import { PrismaGeocodeCache } from '../../src/infrastructure/repositories/prisma-geocode-cache';
import { aDay, aMarineDay, conditions } from '../support/builders';

/**
 * The Prisma adapters against a real, throwaway MySQL 8.4 (Testcontainers), with the real
 * migrations applied, so we test the actual SQL, types, charset and transactions, not a mock.
 * Requires Docker. Runs in CI on ubuntu-latest.
 */
jest.setTimeout(180_000);

let container: StartedMySqlContainer;
let db: Database;

beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.4').withDatabase('weather').start();
  const url = container.getConnectionUri(true);
  // Apply the committed migrations exactly as a deploy would.
  const prismaCli = path.join(__dirname, '..', '..', 'node_modules', 'prisma', 'build', 'index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, MIGRATE_DATABASE_URL: url, SHADOW_DATABASE_URL: '' },
    stdio: 'pipe',
  });
  // Fresh MySQL 8 server: caching_sha2_password needs TLS or key retrieval (see ADR-004).
  db = createDatabase(`${url}?allowPublicKeyRetrieval=true`);
});

afterAll(async () => {
  await db.$disconnect();
  await container.stop();
});

const tableCount = async (): Promise<number> => {
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()`;
  return Number(rows[0]?.n ?? 0);
};

describe('pingDatabase', () => {
  it('succeeds against a live database', async () => {
    await expect(pingDatabase(db)).resolves.toBeUndefined();
  });
});

describe('PrismaForecastRepository', () => {
  const repo = () => new PrismaForecastRepository(db);
  const snapshot = (overrides: Partial<ForecastSnapshot> = {}): ForecastSnapshot => ({
    gridKey: '43.5,-1.6',
    latitude: 43.5,
    longitude: -1.6,
    fetchedAt: new Date('2026-10-07T09:15:30.123Z'),
    marineStatus: 'available',
    days: [
      conditions(
        aDay({ date: '2026-10-07', precipitationProbabilityMaxPct: null, snowDepthMaxM: 0.25 }),
        aMarineDay({ date: '2026-10-07', wavePeriodMaxS: null }),
      ),
      conditions(
        aDay({ date: '2026-10-08', uvIndexMax: null }),
        aMarineDay({ date: '2026-10-08' }),
      ),
    ],
    ...overrides,
  });

  it('returns null for an unknown cell', async () => {
    await expect(repo().get('0.0,0.0')).resolves.toBeNull();
  });

  it('round-trips a snapshot exactly: nulls, millisecond timestamps, and dates with no timezone shift', async () => {
    const original = snapshot();
    await repo().save(original);

    await expect(repo().get(original.gridKey)).resolves.toEqual(original);
  });

  it('replaces the previous snapshot for the cell, leaving no stale days behind', async () => {
    await repo().save(snapshot());
    const refreshed = snapshot({
      fetchedAt: new Date('2026-10-07T12:00:00.000Z'),
      days: [conditions(aDay({ date: '2026-10-09' }), aMarineDay({ date: '2026-10-09' }))],
    });

    await repo().save(refreshed);

    const stored = await repo().get(refreshed.gridKey);
    expect(stored?.days.map((d) => d.weather.date)).toEqual(['2026-10-09']);
    expect(stored?.fetchedAt).toEqual(refreshed.fetchedAt);
  });

  it.each(['none', 'unavailable'] as const)(
    'marine status "%s" comes back with no sea data per day',
    async (marineStatus) => {
      const inland = snapshot({
        gridKey: `45.9,6.9-${marineStatus}`,
        marineStatus,
        days: [conditions(aDay({ date: '2026-10-07' }))],
      });
      await repo().save(inland);

      const stored = await repo().get(inland.gridKey);
      expect(stored?.marineStatus).toBe(marineStatus);
      expect(stored?.days[0]?.marine).toBeNull();
    },
  );
});

describe('PrismaGeocodeCache', () => {
  const cache = () => new PrismaGeocodeCache(db);
  const place = (id: number, name: string, countryCode: string): GeoLocation => ({
    id,
    name,
    region: 'Region',
    country: 'Country',
    countryCode,
    latitude: 10 + id / 1000,
    longitude: 20,
    elevationM: null,
    timezone: 'Europe/Paris',
    population: null,
  });
  const fetchedAt = new Date('2026-10-07T09:00:00.000Z');

  it('returns null for an unknown query', async () => {
    await expect(cache().get('nowhere|')).resolves.toBeNull();
  });

  it('round-trips candidates, keeping best-first order', async () => {
    const candidates = [place(3, 'Paris', 'FR'), place(1, 'Paris', 'US'), place(2, 'Paris', 'US')];
    await cache().put('paris|', candidates, fetchedAt);

    await expect(cache().get('paris|')).resolves.toEqual({ locations: candidates, fetchedAt });
  });

  it('stores a negative result ("no such place") as an empty list', async () => {
    await cache().put('xyzzy|', [], fetchedAt);

    await expect(cache().get('xyzzy|')).resolves.toEqual({ locations: [], fetchedAt });
  });

  it('stores Unicode names correctly (utf8mb4)', async () => {
    const tokyo = place(10, '東京', 'JP');
    const etienne = place(11, 'Saint-Étienne', 'FR');
    await cache().put('東京|', [tokyo, etienne], fetchedAt);

    expect((await cache().get('東京|'))?.locations.map((l) => l.name)).toEqual([
      '東京',
      'Saint-Étienne',
    ]);
  });

  it('updates a location that changed upstream', async () => {
    await cache().put('a|', [place(20, 'Old name', 'FR')], fetchedAt);
    await cache().put('b|', [place(20, 'New name', 'FR')], fetchedAt);

    expect((await cache().get('a|'))?.locations[0]?.name).toBe('New name');
  });

  it('treats injection payloads as plain data (parameterised queries), and the schema survives', async () => {
    const tablesBefore = await tableCount();
    const payloads = [
      "x'; DROP TABLE locations;--",
      "' OR '1'='1",
      'x"); DELETE FROM geocode_queries;--',
    ];

    for (const key of payloads) {
      await cache().put(key, [place(30, key, 'FR')], fetchedAt);
      expect((await cache().get(key))?.locations[0]?.name).toBe(key);
    }

    expect(await tableCount()).toBe(tablesBefore);
    await expect(cache().get('paris|')).resolves.not.toBeNull(); // other data untouched
  });
});
