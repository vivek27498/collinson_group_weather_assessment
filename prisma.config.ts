import { defineConfig } from 'prisma/config';

// Prisma 7 doesn't load .env by itself. Node 22 can, so no dotenv dependency is needed.
try {
  process.loadEnvFile();
} catch {
  // No .env file (CI, containers): variables come from the real environment.
}

/**
 * Used by the Prisma CLI only (migrate/generate), never by the running service.
 * Migrations run as the `migrator` user (DDL rights); the service connects as `app` (DML only).
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.MIGRATE_DATABASE_URL ?? '',
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
});
