import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from './observability/logger';
import { ServiceUnavailableError } from './shared/errors/app-error';
import { errorHandler, notFoundHandler } from './shared/http/error-handler';
import { genReqId } from './shared/http/request-id';
import { sendSuccess } from './shared/http/respond';

export interface AppDependencies {
  readonly logger: Logger;
  /** Readiness turns 503 while draining so load balancers stop routing new traffic here. */
  readonly isShuttingDown?: () => boolean;
}

/**
 * Builds the Express app without starting it, so tests can drive it with supertest
 * and the composition root (index.ts) owns process concerns (ports, signals).
 *
 * Middleware order matters:
 *   request id + logging → security headers → body parsing (size-limited) → routes
 *   → 404 → error handler (always last).
 */
export function createApp({ logger, isShuttingDown = () => false }: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      genReqId,
      // Health probes run every few seconds; logging each one is noise.
      autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/readyz' },
    }),
  );
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));

  // Liveness: the process is up. Never depends on downstreams, or an outage would restart-loop us.
  app.get('/healthz', (req, res) => {
    sendSuccess(req, res, { status: 'ok' });
  });

  // Readiness: should this instance receive traffic? (A DB ping is added with persistence in M4.)
  app.get('/readyz', (req, res) => {
    if (isShuttingDown()) {
      throw new ServiceUnavailableError('Shutting down', { code: 'SHUTTING_DOWN' });
    }
    sendSuccess(req, res, { status: 'ready' });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
