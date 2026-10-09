// Express: the web server framework that receives HTTP requests and sends responses.
import express, { type Express, type RequestHandler } from 'express';
// helmet: adds standard security headers to every response.
import helmet from 'helmet';
// pino-http: logs every request (method, URL, status, time taken) as JSON.
import { pinoHttp } from 'pino-http';
// Our logger type, and a middleware that remembers the request id for the whole request.
import { type Logger, requestContextMiddleware } from './modules/logger';
// The error we throw when this server shouldn't receive traffic right now (HTTP 503).
import { ServiceUnavailableError } from './modules/errors';
// Our Express helpers: the error handler, the 404 handler, request ids, and the success response.
import { errorHandler, notFoundHandler, genReqId, sendSuccess } from './modules/express';

// Everything createApp needs, passed in from index.ts (so tests can pass fakes instead).
export interface AppDependencies {
  // The logger to write request logs with.
  logger: Logger;
  // Tells us if the app is shutting down; /readyz then says "not ready" so traffic goes elsewhere.
  isShuttingDown?: () => boolean;
  // The GraphQL endpoint (Apollo). Optional so tests can build the app without it.
  graphqlHandler?: RequestHandler;
  // A check for /readyz (a database ping). If it throws, we're "not ready".
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
  // Default: never shutting down (handy for tests).
  isShuttingDown = () => false,
  graphqlHandler,
  // Default: always ready (handy for tests).
  readinessCheck = () => Promise.resolve(),
}: AppDependencies): Express {
  // Create a new, empty Express app.
  const app = express();

  // Don't send the "X-Powered-By: Express" header: no need to tell attackers what we run.
  app.disable('x-powered-by');
  // We sit behind one proxy/load balancer: trust it to tell us the caller's real IP address.
  app.set('trust proxy', 1);

  // 1. Logging: give each request an id and log it when it finishes.
  app.use(
    pinoHttp({
      // Write the request logs with our logger.
      logger,
      // How each request gets its id: reuse the caller's x-request-id if it's safe, else make a new one.
      genReqId,
      // Health checks run every few seconds; logging each one is just noise.
      autoLogging: {
        ignore: (req) => req.url === '/healthz' || req.url === '/readyz',
      },
    }),
  );
  // 2. Remember this request's id, so every log line written while handling it includes the id.
  app.use(requestContextMiddleware);
  // 3. Add security headers to every response (e.g. stop the browser guessing content types).
  app.use(helmet());
  // 4. Read JSON request bodies into req.body. Anything over 10 kb is rejected (a real query is tiny).
  app.use(express.json({ limit: '10kb' }));

  // "Liveness" check: is the process running? It deliberately does NOT check the database:
  // if it did, a database outage would make Docker/Kubernetes restart every server, over and over.
  app.get('/healthz', (req, res) => {
    // Reply 200 with { success: true, data: { status: 'ok' }, meta: {...} }.
    sendSuccess(req, res, { status: 'ok' });
  });

  // "Readiness" check: should this server get traffic right now? Not while shutting down, and not
  // if the database is unreachable. The load balancer then sends requests to other servers.
  app.get('/readyz', async (req, res) => {
    // Shutting down: answer 503 so no new requests are sent here.
    if (isShuttingDown()) {
      throw new ServiceUnavailableError('Shutting down', { code: 'SHUTTING_DOWN' });
    }
    try {
      // Ping the database.
      await readinessCheck();
    } catch (err) {
      // Database unreachable: answer 503. `cause` keeps the real error for our logs only.
      throw new ServiceUnavailableError('A dependency is unavailable', {
        code: 'DEPENDENCY_UNAVAILABLE',
        cause: err,
      });
    }
    // All good: reply 200 { status: 'ready' }.
    sendSuccess(req, res, { status: 'ready' });
  });

  // The main API: every request to /graphql is handed to Apollo GraphQL.
  if (graphqlHandler) {
    app.use('/graphql', graphqlHandler);
  }

  // No route matched: reply with our standard JSON "404 Route not found" (not Express's HTML page).
  app.use(notFoundHandler);
  // Any error thrown above ends up here: it picks the status code, logs it, and sends a JSON error.
  // It must be the very last middleware so it can catch errors from everything before it.
  app.use(errorHandler);

  // Hand the finished app back to index.ts, which starts it with app.listen().
  return app;
}
