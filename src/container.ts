import { CachedGeocoder } from './application/cached-geocoder';
import { systemClock, type Clock } from './application/clock';
import { ForecastService } from './application/forecast-service';
import type { ForecastRepository, GeocodeCache } from './application/ports';
import { RankingService } from './application/ranking-service';
import type { AppConfig } from './config/env';
import { defaultScoringConfig } from './config/scoring';
import { createScorers } from './domain/scoring/registry';
import { AxiosJsonClient, RetryingJsonClient } from './modules/http';
import { OpenMeteoForecast } from './infrastructure/open-meteo/open-meteo-forecast';
import { OpenMeteoGeocoder } from './infrastructure/open-meteo/open-meteo-geocoder';
import { OpenMeteoMarine } from './infrastructure/open-meteo/open-meteo-marine';
import type { Logger } from './modules/logger';

export interface Persistence {
  readonly forecasts: ForecastRepository;
  readonly geocodes: GeocodeCache;
}

export interface Services {
  readonly rankingService: RankingService;
  readonly forecastService: ForecastService;
}

/**
 * Wiring only: which implementation backs which port. Plain constructor injection, no DI
 * framework. This file is the single place to look to see how the app is assembled.
 *
 * Persistence is passed in (rather than created here) so tests can wire the real graph
 * against in-memory repositories or a Testcontainers MySQL.
 */
export function createServices(
  config: AppConfig,
  logger: Logger,
  persistence: Persistence,
  clock: Clock = systemClock,
): Services {
  // Decorator: resilience (retries) wraps the plain client (timeout + error classification).
  const http = new RetryingJsonClient(
    new AxiosJsonClient({ timeoutMs: config.upstream.timeoutMs }),
    { maxRetries: config.upstream.maxRetries, logger },
  );

  // Decorator again: a persistent cache in front of the Open-Meteo geocoder.
  const geocoder = new CachedGeocoder(
    new OpenMeteoGeocoder(http, config.openMeteo.geocodingUrl),
    persistence.geocodes,
    {
      clock,
      logger,
      ttlMs: config.cache.geocodeTtlMs,
      negativeTtlMs: config.cache.geocodeNegativeTtlMs,
    },
  );

  const forecastService = new ForecastService({
    repository: persistence.forecasts,
    weather: new OpenMeteoForecast(http, config.openMeteo.forecastUrl),
    marine: new OpenMeteoMarine(http, config.openMeteo.marineUrl),
    clock,
    logger,
    policy: {
      freshForMs: config.cache.forecastFreshMs,
      degradedFreshForMs: config.cache.forecastDegradedFreshMs,
      maxStaleMs: config.cache.forecastMaxStaleMs,
    },
  });

  const rankingService = new RankingService({
    geocoder,
    forecasts: forecastService,
    scorers: createScorers(defaultScoringConfig),
    scoringConfig: defaultScoringConfig,
  });

  return { rankingService, forecastService };
}
