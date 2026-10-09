import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { type Logger, requestContextMiddleware } from './modules/logger';
import { ServiceUnavailableError } from './modules/errors';
import { errorHandler, notFoundHandler, genReqId, sendSuccess } from './modules/express';

export interface AppDependencies {
  logger: Logger;
  /** Readiness turns 503 while draining so load balancers stop routing new traffic here. */
  isShuttingDown?: () => boolean;
  /** The GraphQL endpoint (Apollo). Optional so tests can build the app without it. */
  graphqlHandler?: RequestHandler;
  /** Dependency check for /readyz (e.g. a DB ping). Throwing means "not ready". */
  readinessCheck?: () => Promise<void>;
}

/**
 * Builds the Express app but doesn't start it: index.ts starts the server, and tests call the
 * app directly with supertest.
 *
 * The order of middleware matters. Each request goes through, top to bottom:
 *   request id + logging → security headers → JSON body (max 10 kb) → routes
 *   → "404 not found" → error handler (always last, so it catches errors from everything above).
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

  // "Liveness" check: is the process running? It deliberately does NOT check the database:
  // if it did, a database outage would make Docker/Kubernetes restart every server, over and over.
  app.get('/healthz', (req, res) => {
    sendSuccess(req, res, { status: 'ok' });
  });

  // "Readiness" check: should this server get traffic right now? Not while shutting down, and not
  // if the database is unreachable. The load balancer then sends requests to other servers.
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
