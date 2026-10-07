import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../../generated/prisma/client';

export type Database = PrismaClient;

/**
 * Prisma 7 talks to MySQL through a driver adapter (the MariaDB connector, which speaks the
 * MySQL protocol). The adapter owns a connection pool, released by `$disconnect()` during
 * graceful shutdown.
 */
export function createDatabase(databaseUrl: string): Database {
  return new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });
}

/** Readiness probe: a trivial round-trip. Tagged template, so it's parameterised like all SQL here. */
export async function pingDatabase(db: Database): Promise<void> {
  await db.$queryRaw`SELECT 1`;
}
