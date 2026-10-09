import { createApp } from './app';
import { loadConfig } from './config/env';
import { createServices } from './container';
import { createGraphQLHandler } from './graphql/create-graphql-handler';
import { createDatabase, pingDatabase } from './modules/database';
import { PrismaForecastRepository } from './infrastructure/repositories/prisma-forecast-repository';
import { PrismaGeocodeCache } from './infrastructure/repositories/prisma-geocode-cache';
import { createLogger } from './modules/logger';
import { createShutdownController, registerProcessHandlers } from './modules/lifecycle';

/**
 * Composition root: the only place that reads the environment, creates long-lived
 * resources and touches the process (ports, signals). Everything else is injected.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, pretty: config.env === 'development' });

  const db = createDatabase(config.databaseUrl, { poolSize: config.databasePoolSize });
  const { rankingService, forecastService } = createServices(config, logger, {
    forecasts: new PrismaForecastRepository(db),
    geocodes: new PrismaGeocodeCache(db),
  });
  const graphql = await createGraphQLHandler({
    rankingService,
    isProduction: config.isProduction,
    limits: config.graphql,
  });

  // /readyz needs the controller, and the controller needs the server the app creates.
  // The closure only runs per request, long after `controller` is initialised below.
  const app = createApp({
    logger,
    isShuttingDown: () => controller.isShuttingDown(),
    readinessCheck: () => pingDatabase(db),
    graphqlHandler: graphql.handler,
  });

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'Server listening');
  });

  const controller = createShutdownController({
    server,
    logger,
    timeoutMs: 10_000,
    // Closed in REVERSE order after the HTTP server drains: stop Apollo, let background
    // forecast refreshes finish writing, then release the DB pool.
    resources: [
      { name: 'database', close: () => db.$disconnect() },
      { name: 'background-refreshes', close: () => forecastService.drain() },
      { name: 'apollo', close: graphql.stop },
    ],
  });
  registerProcessHandlers(controller, logger);
}

main().catch((err: unknown) => {
  // Logger may not exist yet (e.g. invalid config), so fall back to stderr.
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
