import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from './observability/logger';
import { errorHandler, notFoundHandler } from './shared/http/error-handler';
import { genReqId } from './shared/http/request-id';
import { sendSuccess } from './shared/http/respond';

export interface AppDependencies {
  readonly logger: Logger;
}

/**
 * Builds the Express app without starting it, so tests can drive it with supertest
 * and the composition root (index.ts) owns process concerns (ports, signals).
 *
 * Middleware order matters:
 *   request id + logging → security headers → body parsing (size-limited) → routes
 *   → 404 → error handler (always last).
 */
export function createApp({ logger }: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      genReqId,
      // Health probes run every few seconds; logging each one is noise.
      autoLogging: { ignore: (req) => req.url === '/healthz' },
    }),
  );
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));

  app.get('/healthz', (req, res) => {
    sendSuccess(req, res, { status: 'ok' });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
