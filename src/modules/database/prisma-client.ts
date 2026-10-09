import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../../generated/prisma/client';

export type Database = PrismaClient;

export interface DatabaseOptions {
  /**
   * The most database connections this server keeps open at once (the "connection pool").
   * Each query borrows a connection and gives it back. A load test showed this was the main
   * limit on speed for cached requests (10 → 20 connections: 69 → 200 requests per second).
   */
  poolSize?: number;
}

/**
 * Creates the Prisma client. Prisma 7 connects to MySQL through the MariaDB driver (MariaDB
 * and MySQL use the same protocol). The driver keeps the connection pool; `$disconnect()`
 * closes it during shutdown.
 */
export function createDatabase(databaseUrl: string, options: DatabaseOptions = {}): Database {
  return new PrismaClient({
    adapter: new PrismaMariaDb(withPoolSize(databaseUrl, options.poolSize)),
  });
}

/** Adds `connectionLimit=<poolSize>` to the database URL, unless the URL already sets it. */
export function withPoolSize(databaseUrl: string, poolSize: number | undefined): string {
  if (poolSize === undefined) return databaseUrl;
  const url = new URL(databaseUrl);
  if (!url.searchParams.has('connectionLimit')) {
    url.searchParams.set('connectionLimit', String(poolSize));
  }
  return url.toString();
}

/** Used by /readyz: a tiny query to check the database is reachable. */
export async function pingDatabase(db: Database): Promise<void> {
  await db.$queryRaw`SELECT 1`;
}
