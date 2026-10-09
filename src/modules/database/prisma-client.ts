import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../../generated/prisma/client';

export type Database = PrismaClient;

export interface DatabaseOptions {
  /**
   * Maximum open connections in the pool. Every request that misses the in-process work holds a
   * connection briefly, so this caps DB concurrency per instance. Load testing showed it was the
   * main throughput lever (10 → 20 connections: 69 → 200 req/s on the warm path).
   */
  readonly poolSize?: number;
}

/**
 * Prisma 7 talks to MySQL through a driver adapter (the MariaDB connector, which speaks the
 * MySQL protocol). The adapter owns a connection pool, sized explicitly here and released by
 * `$disconnect()` during graceful shutdown.
 */
export function createDatabase(databaseUrl: string, options: DatabaseOptions = {}): Database {
  return new PrismaClient({
    adapter: new PrismaMariaDb(withPoolSize(databaseUrl, options.poolSize)),
  });
}

/** Sets the connector's `connectionLimit` on the URL, unless the URL already specifies one. */
export function withPoolSize(databaseUrl: string, poolSize: number | undefined): string {
  if (poolSize === undefined) return databaseUrl;
  const url = new URL(databaseUrl);
  if (!url.searchParams.has('connectionLimit')) {
    url.searchParams.set('connectionLimit', String(poolSize));
  }
  return url.toString();
}

/** Readiness probe: a trivial round-trip. Tagged template, so it's parameterised like all SQL here. */
export async function pingDatabase(db: Database): Promise<void> {
  await db.$queryRaw`SELECT 1`;
}
