import { ConfigError, loadConfig } from '../../../src/config/env';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '4100',
  LOG_LEVEL: 'warn',
  DATABASE_URL: 'mysql://app:secret@localhost:3306/weather',
};

describe('loadConfig', () => {
  it('parses a valid environment into a typed, frozen config', () => {
    const config = loadConfig(validEnv);

    expect(config).toEqual({
      env: 'test',
      isProduction: false,
      port: 4100,
      logLevel: 'warn',
      databaseUrl: 'mysql://app:secret@localhost:3306/weather',
      openMeteo: {
        geocodingUrl: 'https://geocoding-api.open-meteo.com/v1/search',
        forecastUrl: 'https://api.open-meteo.com/v1/forecast',
        marineUrl: 'https://marine-api.open-meteo.com/v1/marine',
      },
      upstream: { timeoutMs: 6000, maxRetries: 1 },
      graphql: { maxDepth: 6, maxRootFields: 3 },
      cache: {
        forecastFreshMs: 3 * 3_600_000,
        forecastDegradedFreshMs: 15 * 60_000,
        forecastMaxStaleMs: 24 * 3_600_000,
        geocodeTtlMs: 30 * 86_400_000,
        geocodeNegativeTtlMs: 24 * 3_600_000,
      },
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('applies defaults for optional variables', () => {
    const config = loadConfig({ DATABASE_URL: validEnv.DATABASE_URL });

    expect(config.env).toBe('development');
    expect(config.port).toBe(4000);
    expect(config.logLevel).toBe('info');
  });

  it.each([
    ['missing DATABASE_URL', { ...validEnv, DATABASE_URL: undefined }, 'DATABASE_URL'],
    ['non-mysql DATABASE_URL', { ...validEnv, DATABASE_URL: 'postgres://x@y/z' }, 'DATABASE_URL'],
    ['non-numeric PORT', { ...validEnv, PORT: 'abc' }, 'PORT'],
    ['out of range PORT', { ...validEnv, PORT: '70000' }, 'PORT'],
    ['unknown NODE_ENV', { ...validEnv, NODE_ENV: 'staging' }, 'NODE_ENV'],
    ['unknown LOG_LEVEL', { ...validEnv, LOG_LEVEL: 'verbose' }, 'LOG_LEVEL'],
    [
      'non-URL upstream',
      { ...validEnv, OPEN_METEO_FORECAST_URL: 'not a url' },
      'OPEN_METEO_FORECAST_URL',
    ],
    ['timeout too small', { ...validEnv, UPSTREAM_TIMEOUT_MS: '5' }, 'UPSTREAM_TIMEOUT_MS'],
    ['too many retries', { ...validEnv, UPSTREAM_MAX_RETRIES: '50' }, 'UPSTREAM_MAX_RETRIES'],
  ])('rejects %s and names the variable', (_case, env, variable) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(variable);
  });

  it('never echoes secret values in the error message', () => {
    const env = { ...validEnv, DATABASE_URL: 'postgres://user:SuperSecret123@db/x' };

    expect(() => loadConfig(env)).toThrow(ConfigError);
    try {
      loadConfig(env);
    } catch (err) {
      expect((err as Error).message).not.toContain('SuperSecret123');
    }
  });
});
