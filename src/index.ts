import { createApp } from './app';
import { loadConfig } from './config/env';
import { createRankingService } from './container';
import { createGraphQLHandler } from './graphql/create-graphql-handler';
import { createLogger } from './observability/logger';
import {
  createShutdownController,
  registerProcessHandlers,
} from './shared/process/graceful-shutdown';

/**
 * Composition root: the only place that reads the environment, creates long-lived
 * resources and touches the process (ports, signals). Everything else is injected.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, pretty: config.env === 'development' });

  const rankingService = createRankingService(config, logger);
  const graphql = await createGraphQLHandler({
    rankingService,
    isProduction: config.isProduction,
  });

  // /readyz needs the controller, and the controller needs the server the app creates.
  // The closure only runs per request, long after `controller` is initialised below.
  const app = createApp({
    logger,
    isShuttingDown: () => controller.isShuttingDown(),
    graphqlHandler: graphql.handler,
  });

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'Server listening');
  });

  const controller = createShutdownController({
    server,
    logger,
    timeoutMs: 10_000,
    // Closed in reverse order after the HTTP server drains. The DB pool joins this list in slice 3.
    resources: [{ name: 'apollo', close: graphql.stop }],
  });
  registerProcessHandlers(controller, logger);
}

main().catch((err: unknown) => {
  // Logger may not exist yet (e.g. invalid config), so fall back to stderr.
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
