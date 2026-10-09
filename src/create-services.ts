import { DbFirstGeocoder } from './services/location/db-first-geocoder';
import { systemClock, type Clock } from './utils/clock';
import { ForecastService } from './services/forecast/forecast-service';
import type { ForecastRepository, GeocodeStore } from './services/interfaces';
import { RankingService } from './services/ranking/ranking-service';
import type { AppConfig } from './config/env';
import { defaultScoringConfig } from './config/scoring';
import { createScorers } from './scoring/registry';
import { AxiosJsonClient, RetryingJsonClient } from './modules/http';
import { OpenMeteoForecast } from './providers/open-meteo/open-meteo-forecast';
import { OpenMeteoGeocoder } from './providers/open-meteo/open-meteo-geocoder';
import { OpenMeteoMarine } from './providers/open-meteo/open-meteo-marine';
import type { Logger } from './modules/logger';

/** Where data is stored: MySQL in production, in-memory in tests. */
export interface Storage {
  forecasts: ForecastRepository;
  geocodes: GeocodeStore;
}

export interface Services {
  rankingService: RankingService;
  forecastService: ForecastService;
}

/**
 * Creates all the services and connects them together. This is the one file to read to see
 * how the app is assembled. Each object gets what it needs through its constructor
 * ("dependency injection"), done by hand without a framework.
 *
 * Storage is passed in rather than created here, so tests can use in-memory storage
 * or a throwaway MySQL database instead.
 */
export function createServices(
  config: AppConfig,
  logger: Logger,
  storage: Storage,
  clock: Clock = systemClock,
): Services {
  // single http client every Open-Meteo call goes through using axios
  const http = new RetryingJsonClient(
    new AxiosJsonClient({ timeoutMs: config.upstream.timeoutMs }),
    { maxRetries: config.upstream.maxRetries, logger },
  );

  // Place-name lookup: Open-Meteo, with a MySQL db in front of it.
  const openMeteoGeocoder = new OpenMeteoGeocoder(http, config.openMeteo.geocodingUrl);
  const geocoder = new DbFirstGeocoder(openMeteoGeocoder, storage.geocodes, {
    clock,
    logger,
    ttlMs: config.cache.geocodeTtlMs,
    negativeTtlMs: config.cache.geocodeNegativeTtlMs,
  });

  // Forecasts: weather + sea data from Open-Meteo, stored in MySQL.
  const forecastService = new ForecastService({
    repository: storage.forecasts,
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

  // The main use case: find the place, get its forecast, score and rank the activities.
  const rankingService = new RankingService({
    geocoder,
    forecasts: forecastService,
    scorers: createScorers(defaultScoringConfig),
    scoringConfig: defaultScoringConfig,
  });

  return { rankingService, forecastService };
}
