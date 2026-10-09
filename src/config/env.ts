import { z } from 'zod';

/**
 * Reads and checks all environment variables once, at startup. If anything is wrong the app
 * refuses to start, which is much better than finding a typo in DATABASE_URL on the first request.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z
    .url()
    .refine((url) => url.startsWith('mysql://'), 'DATABASE_URL must be a mysql:// URL'),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),

  // Open-Meteo addresses come from config, never from user input (so users can't make us call
  // other servers). They can be changed to point tests at a fake server instead of the real API.
  OPEN_METEO_GEOCODING_URL: z.url().default('https://geocoding-api.open-meteo.com/v1/search'),
  OPEN_METEO_FORECAST_URL: z.url().default('https://api.open-meteo.com/v1/forecast'),
  OPEN_METEO_MARINE_URL: z.url().default('https://marine-api.open-meteo.com/v1/marine'),
  // Chosen from real measurements: Open-Meteo took 1.4–3.1 s (2026-10-07). A 3 s timeout cut off
  // slow-but-fine responses. 6 s is above the slowest we saw; one retry caps the worst case (~12 s).
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(6000),
  UPSTREAM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(1),

  // Query-shape limits for /graphql (see ADR-004).
  GRAPHQL_MAX_DEPTH: z.coerce.number().int().min(2).max(20).default(6),
  GRAPHQL_MAX_ROOT_FIELDS: z.coerce.number().int().min(1).max(10).default(3),

  // Cache lifetimes (ADR-003). Open-Meteo refreshes its models every few hours.
  FORECAST_FRESH_MINUTES: z.coerce.number().int().min(1).default(180),
  FORECAST_DEGRADED_FRESH_MINUTES: z.coerce.number().int().min(1).default(15),
  FORECAST_MAX_STALE_HOURS: z.coerce.number().int().min(1).default(24),
  GEOCODE_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  GEOCODE_NEGATIVE_TTL_HOURS: z.coerce.number().int().min(1).default(24),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig {
  env: Env['NODE_ENV'];
  isProduction: boolean;
  port: number;
  logLevel: Env['LOG_LEVEL'];
  databaseUrl: string;
  databasePoolSize: number;
  openMeteo: {
    geocodingUrl: string;
    forecastUrl: string;
    marineUrl: string;
  };
  upstream: { timeoutMs: number; maxRetries: number };
  graphql: { maxDepth: number; maxRootFields: number };
  cache: {
    forecastFreshMs: number;
    forecastDegradedFreshMs: number;
    forecastMaxStaleMs: number;
    geocodeTtlMs: number;
    geocodeNegativeTtlMs: number;
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export class ConfigError extends Error {
  constructor(issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Report which variable is wrong and why, but never echo its value: it may be a secret.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(issues);
  }
  const env = parsed.data;
  return Object.freeze({
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    databasePoolSize: env.DB_POOL_SIZE,
    openMeteo: {
      geocodingUrl: env.OPEN_METEO_GEOCODING_URL,
      forecastUrl: env.OPEN_METEO_FORECAST_URL,
      marineUrl: env.OPEN_METEO_MARINE_URL,
    },
    upstream: { timeoutMs: env.UPSTREAM_TIMEOUT_MS, maxRetries: env.UPSTREAM_MAX_RETRIES },
    graphql: { maxDepth: env.GRAPHQL_MAX_DEPTH, maxRootFields: env.GRAPHQL_MAX_ROOT_FIELDS },
    cache: {
      forecastFreshMs: env.FORECAST_FRESH_MINUTES * MINUTE,
      forecastDegradedFreshMs: env.FORECAST_DEGRADED_FRESH_MINUTES * MINUTE,
      forecastMaxStaleMs: env.FORECAST_MAX_STALE_HOURS * HOUR,
      geocodeTtlMs: env.GEOCODE_TTL_DAYS * DAY,
      geocodeNegativeTtlMs: env.GEOCODE_NEGATIVE_TTL_HOURS * HOUR,
    },
  });
}
