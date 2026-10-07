import { z } from 'zod';

/**
 * Environment is parsed once at startup and the service refuses to boot on bad config.
 * Failing fast here is cheaper than discovering a typo in DATABASE_URL on the first request.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z
    .url()
    .refine((url) => url.startsWith('mysql://'), 'DATABASE_URL must be a mysql:// URL'),

  // Upstream hosts come from config, never from user input (no SSRF). Overridable so load
  // tests can point at a mock instead of hammering the real (free, rate-limited) API.
  OPEN_METEO_GEOCODING_URL: z.url().default('https://geocoding-api.open-meteo.com/v1/search'),
  OPEN_METEO_FORECAST_URL: z.url().default('https://api.open-meteo.com/v1/forecast'),
  OPEN_METEO_MARINE_URL: z.url().default('https://marine-api.open-meteo.com/v1/marine'),
  // Tuned from measurement: Open-Meteo's forecast endpoint took 1.4-3.1 s (2026-10-07). A 3 s
  // timeout aborted healthy-but-slow responses and the retries piled on more slow requests.
  // Per-attempt timeout sits above the observed max; one retry bounds the worst case (~12 s).
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(6000),
  UPSTREAM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(1),

  // Abuse protection for /graphql (per client IP, per instance; see ADR-004).
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
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
  readonly env: Env['NODE_ENV'];
  readonly isProduction: boolean;
  readonly port: number;
  readonly logLevel: Env['LOG_LEVEL'];
  readonly databaseUrl: string;
  readonly openMeteo: {
    readonly geocodingUrl: string;
    readonly forecastUrl: string;
    readonly marineUrl: string;
  };
  readonly upstream: { readonly timeoutMs: number; readonly maxRetries: number };
  readonly rateLimit: { readonly windowMs: number; readonly max: number };
  readonly graphql: { readonly maxDepth: number; readonly maxRootFields: number };
  readonly cache: {
    readonly forecastFreshMs: number;
    readonly forecastDegradedFreshMs: number;
    readonly forecastMaxStaleMs: number;
    readonly geocodeTtlMs: number;
    readonly geocodeNegativeTtlMs: number;
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
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
    openMeteo: {
      geocodingUrl: env.OPEN_METEO_GEOCODING_URL,
      forecastUrl: env.OPEN_METEO_FORECAST_URL,
      marineUrl: env.OPEN_METEO_MARINE_URL,
    },
    upstream: { timeoutMs: env.UPSTREAM_TIMEOUT_MS, maxRetries: env.UPSTREAM_MAX_RETRIES },
    rateLimit: { windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX },
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
