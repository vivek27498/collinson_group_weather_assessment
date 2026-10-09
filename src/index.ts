import { createApp } from './app';
import { loadConfig } from './config/env';
import { createServices } from './create-services';
import { createGraphQLHandler } from './graphql/create-graphql-handler';
import { createDatabase, pingDatabase } from './modules/database';
import { PrismaForecastRepository } from './repositories/prisma-forecast-repository';
import { PrismaGeocodeStore } from './repositories/prisma-geocode-store';
import { createLogger } from './modules/logger';
import { setupGracefulShutdown } from './modules/lifecycle';

/**
 * The app's starting point. This is the only file that reads environment variables, opens the
 * database connection, starts listening on a port and handles process signals.
 * Everything else receives what it needs through its constructor.
 */
async function main(): Promise<void> {
  const config = loadConfig();

  const logger = createLogger({ level: config.logLevel, pretty: config.env === 'development' });

  const db = createDatabase(config.databaseUrl, { poolSize: config.databasePoolSize });

  const { rankingService, forecastService } = createServices(config, logger, {
    forecasts: new PrismaForecastRepository(db),
    geocodes: new PrismaGeocodeStore(db),
  });

  const graphql = await createGraphQLHandler({
    rankingService,
    isProduction: config.isProduction,
    limits: config.graphql,
  });

  // /readyz needs `shutdown`, which is created further down (it needs `server` first).
  // That's fine: this arrow function only runs when a request arrives, after startup is done.
  const app = createApp({
    logger,
    isShuttingDown: () => shutdown.isShuttingDown(),
    readinessCheck: () => pingDatabase(db),
    graphqlHandler: graphql.handler,
  });

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'Server listening');
  });

  const shutdown = setupGracefulShutdown({
    server,
    logger,
    // Runs after in-flight requests have finished.
    cleanup: async () => {
      await graphql.stop(); // stop Apollo
      await forecastService.drain(); // let background forecast saves finish
      await db.$disconnect(); // close the database connections
    },
  });
}

main().catch((err: unknown) => {
  // Logger may not exist yet (e.g. invalid config), so fall back to stderr.
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
