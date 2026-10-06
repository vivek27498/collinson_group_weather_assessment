import { systemClock } from './application/clock';
import { RankingService } from './application/ranking-service';
import type { AppConfig } from './config/env';
import { defaultScoringConfig } from './config/scoring';
import { createScorers } from './domain/scoring/registry';
import { FetchJsonClient } from './infrastructure/http/json-http-client';
import { RetryingJsonClient } from './infrastructure/http/retrying-json-client';
import { OpenMeteoForecast } from './infrastructure/open-meteo/open-meteo-forecast';
import { OpenMeteoGeocoder } from './infrastructure/open-meteo/open-meteo-geocoder';
import { OpenMeteoMarine } from './infrastructure/open-meteo/open-meteo-marine';
import type { Logger } from './observability/logger';

/**
 * Wiring only: which implementation backs which port. Plain constructor injection, no DI
 * framework. This file is the single place to look to see how the app is assembled.
 */
export function createRankingService(config: AppConfig, logger: Logger): RankingService {
  // Decorator: resilience (retries) wraps the plain client (timeout + error classification).
  const http = new RetryingJsonClient(
    new FetchJsonClient({ timeoutMs: config.upstream.timeoutMs }),
    {
      maxRetries: config.upstream.maxRetries,
      logger,
    },
  );

  return new RankingService({
    geocoder: new OpenMeteoGeocoder(http, config.openMeteo.geocodingUrl),
    forecast: new OpenMeteoForecast(http, config.openMeteo.forecastUrl),
    marine: new OpenMeteoMarine(http, config.openMeteo.marineUrl),
    scorers: createScorers(defaultScoringConfig),
    scoringConfig: defaultScoringConfig,
    clock: systemClock,
    logger,
  });
}
