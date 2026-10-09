import type { Server } from 'node:http';
import type { Logger } from '../logger';

/** Anything holding a connection or handle that must be released on exit (DB pool, timers, ...). */
export interface Closable {
  readonly name: string;
  close(): Promise<void>;
}

export interface ShutdownOptions {
  readonly server: Server;
  readonly logger: Logger;
  /** Closed in reverse registration order, after the HTTP server stops accepting work. */
  readonly resources?: readonly Closable[];
  /** Hard deadline: if draining takes longer, exit anyway so a deploy can't hang forever. */
  readonly timeoutMs?: number;
  /** Injected for tests; defaults to process.exit. */
  readonly exit?: (code: number) => void;
}

export interface ShutdownController {
  /** Begin a graceful shutdown. Idempotent: later calls return the same promise. */
  shutdown(reason: string, exitCode?: number): Promise<void>;
  /** Readiness probes read this so a load balancer stops routing traffic while we drain. */
  isShuttingDown(): boolean;
}

/**
 * Graceful shutdown sequence:
 *   1. Flip `isShuttingDown` (readiness turns 503, so the LB stops sending new requests).
 *   2. Stop accepting connections and close idle keep-alive sockets; in-flight requests finish.
 *   3. Close resources (DB pool, ...) in reverse order of acquisition.
 *   4. Exit with the requested code.
 * A timer (unref'd, so it never keeps the process alive by itself) forces exit(1) if any step hangs.
 */
export function createShutdownController(options: ShutdownOptions): ShutdownController {
  const { server, logger, resources = [], timeoutMs = 10_000 } = options;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let inProgress: Promise<void> | undefined;

  const closeServer = (): Promise<void> =>
    new Promise((resolve, reject) => {
      server.close((err) => {
        if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
          reject(err);
          return;
        }
        resolve();
      });
      server.closeIdleConnections();
    });

  const run = async (reason: string, exitCode: number): Promise<void> => {
    logger.info({ reason, exitCode }, 'Graceful shutdown started');
    const forceTimer = setTimeout(() => {
      logger.error({ timeoutMs }, 'Graceful shutdown timed out, forcing exit');
      exit(1);
    }, timeoutMs);
    forceTimer.unref();

    let code = exitCode;
    try {
      await closeServer();
      logger.info('HTTP server closed');
    } catch (err) {
      logger.error({ err }, 'Error while closing HTTP server');
      code = 1;
    }

    for (const resource of [...resources].reverse()) {
      try {
        await resource.close();
        logger.info({ resource: resource.name }, 'Resource closed');
      } catch (err) {
        // Keep going: one stuck resource must not stop the others from being released.
        logger.error({ err, resource: resource.name }, 'Error while closing resource');
        code = 1;
      }
    }

    clearTimeout(forceTimer);
    logger.info({ exitCode: code }, 'Graceful shutdown complete');
    exit(code);
  };

  return {
    shutdown(reason, exitCode = 0) {
      inProgress ??= run(reason, exitCode);
      return inProgress;
    },
    isShuttingDown: () => inProgress !== undefined,
  };
}

/**
 * Wires the controller to process-level events.
 *  - SIGTERM (orchestrators, `docker stop`) / SIGINT (Ctrl+C): drain and exit 0.
 *    A *second* signal while draining means the operator wants out now: exit 1 immediately.
 *  - unhandledRejection / uncaughtException: the process is in an unknown state. Log at fatal with
 *    the full error, then still drain (bounded by the timeout) and exit 1 so the orchestrator restarts us.
 */
export function registerProcessHandlers(
  controller: ShutdownController,
  logger: Logger,
  proc: NodeJS.EventEmitter = process,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  const onSignal = (signal: NodeJS.Signals): void => {
    if (controller.isShuttingDown()) {
      logger.warn({ signal }, 'Second signal received during shutdown, exiting immediately');
      exit(1);
      return;
    }
    void controller.shutdown(signal, 0);
  };

  proc.on('SIGTERM', onSignal);
  proc.on('SIGINT', onSignal);

  proc.on('unhandledRejection', (reason: unknown) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    void controller.shutdown('unhandledRejection', 1);
  });
  proc.on('uncaughtException', (err: Error) => {
    logger.fatal({ err }, 'Uncaught exception');
    void controller.shutdown('uncaughtException', 1);
  });
}
