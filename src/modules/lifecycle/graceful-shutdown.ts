import type { Server } from 'node:http';
import type { Logger } from '../logger';

export interface ShutdownOptions {
  server: Server;
  logger: Logger;
  /** Closes everything else (Apollo, background work, the database), in the right order. */
  cleanup: () => Promise<void>;
  /** If shutting down takes longer than this, exit anyway so a deploy never hangs. */
  timeoutMs?: number;
  /** Tests pass fakes for these, so the test process doesn't really exit or receive signals. */
  exit?: (code: number) => void;
  events?: NodeJS.EventEmitter;
}

/**
 * Shuts the app down cleanly when Docker/Kubernetes stops it (SIGTERM) or you press Ctrl+C (SIGINT):
 *   1. stop accepting new requests, but let the ones in progress finish;
 *   2. run `cleanup` (stop Apollo, let background saves finish, close the database);
 *   3. exit.
 * If the app crashes (an error nobody caught), it logs the error and does the same, exiting with 1
 * so it gets restarted.
 *
 * Returns `isShuttingDown`, which /readyz uses to tell the load balancer to stop sending traffic.
 */
export function setupGracefulShutdown(options: ShutdownOptions): { isShuttingDown: () => boolean } {
  const { server, logger, cleanup, timeoutMs = 10_000 } = options;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const events = options.events ?? process;
  let shuttingDown = false;

  async function shutDown(reason: string, exitCode: number): Promise<void> {
    if (shuttingDown) {
      return; // already shutting down
    }
    shuttingDown = true;
    logger.info({ reason }, 'Graceful shutdown started');

    // Safety net: if something hangs, exit anyway. (`unref` = this timer alone won't keep Node running.)
    const forceExit = setTimeout(() => {
      logger.error({ timeoutMs }, 'Graceful shutdown timed out, forcing exit');
      exit(1);
    }, timeoutMs);
    forceExit.unref();

    try {
      // Stop taking new connections; resolves once in-progress requests have finished.
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeIdleConnections();
      });
      await cleanup();
      logger.info('Graceful shutdown complete');
      exit(exitCode);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      exit(1);
    } finally {
      clearTimeout(forceExit);
    }
  }

  events.on('SIGTERM', () => void shutDown('SIGTERM', 0));
  events.on('SIGINT', () => void shutDown('SIGINT', 0));
  events.on('unhandledRejection', (reason: unknown) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    void shutDown('unhandledRejection', 1);
  });
  events.on('uncaughtException', (err: Error) => {
    logger.fatal({ err }, 'Uncaught exception');
    void shutDown('uncaughtException', 1);
  });

  return { isShuttingDown: () => shuttingDown };
}
