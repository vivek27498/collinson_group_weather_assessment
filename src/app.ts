import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { type Logger, requestContextMiddleware } from './modules/logger';
import { ServiceUnavailableError } from './modules/errors';
import { errorHandler, notFoundHandler, genReqId, sendSuccess } from './modules/express';

export interface AppDependencies {
  readonly logger: Logger;
  /** Readiness turns 503 while draining so load balancers stop routing new traffic here. */
  readonly isShuttingDown?: () => boolean;
  /** The GraphQL endpoint (Apollo). Optional so infrastructure tests can build the bare app. */
  readonly graphqlHandler?: RequestHandler;
  /** Dependency check for /readyz (e.g. a DB ping). Throwing means "not ready". */
  readonly readinessCheck?: () => Promise<void>;
}

/**
 * Builds the Express app without starting it, so tests can drive it with supertest
 * and the composition root (index.ts) owns process concerns (ports, signals).
 *
 * Middleware order matters:
 *   request id + logging → security headers → body parsing (size-limited) → routes
 *   → 404 → error handler (always last).
 */
export function createApp({
  logger,
  isShuttingDown = () => false,
  graphqlHandler,
  readinessCheck = () => Promise.resolve(),
}: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      genReqId,
      // Health probes run every few seconds; logging each one is noise.
      autoLogging: {
        ignore: (req) => req.url === '/healthz' || req.url === '/readyz',
      },
    }),
  );
  app.use(requestContextMiddleware);
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));

  // Liveness: the process is up. Never depends on downstreams, or an outage would restart-loop us.
  app.get('/healthz', (req, res) => {
    sendSuccess(req, res, { status: 'ok' });
  });

  // Readiness: should this instance receive traffic? Not while draining, and not if the database
  // is unreachable (the load balancer then routes to healthy instances).
  app.get('/readyz', async (req, res) => {
    if (isShuttingDown()) {
      throw new ServiceUnavailableError('Shutting down', { code: 'SHUTTING_DOWN' });
    }
    try {
      await readinessCheck();
    } catch (err) {
      throw new ServiceUnavailableError('A dependency is unavailable', {
        code: 'DEPENDENCY_UNAVAILABLE',
        cause: err,
      });
    }
    sendSuccess(req, res, { status: 'ready' });
  });

  if (graphqlHandler) {
    app.use('/graphql', graphqlHandler);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
