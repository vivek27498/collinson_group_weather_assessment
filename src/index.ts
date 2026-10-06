import { createApp } from './app';
import { loadConfig } from './config/env';
import { createLogger } from './observability/logger';
import {
  createShutdownController,
  registerProcessHandlers,
} from './shared/process/graceful-shutdown';

/**
 * Composition root: the only place that reads the environment, creates long-lived
 * resources and touches the process (ports, signals). Everything else is injected.
 */
function main(): void {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, pretty: config.env === 'development' });

  // /readyz needs the controller, and the controller needs the server the app creates.
  // The closure only runs per request, long after `controller` is initialised below.
  const app = createApp({ logger, isShuttingDown: () => controller.isShuttingDown() });

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'Server listening');
  });

  const controller = createShutdownController({
    server,
    logger,
    timeoutMs: 10_000,
    resources: [], // DB pool is registered here once persistence lands (M4).
  });
  registerProcessHandlers(controller, logger);
}

try {
  main();
} catch (err) {
  // Logger may not exist yet (e.g. invalid config), so fall back to stderr.
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
