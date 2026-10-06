import type { ErrorRequestHandler, RequestHandler } from 'express';
import { NotFoundError } from '../errors/app-error';
import { mapError } from '../errors/error-mapper';
import { buildErrorBody } from './respond';

/**
 * Express 5 forwards rejected promises from async handlers to this middleware natively,
 * so handlers can just `throw` (no try/catch, no express-async-errors). Everything ends
 * up here, gets classified by the shared error policy, logged once, and serialised once.
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    // Too late to send our envelope; let Express close the connection.
    next(err);
    return;
  }

  const mapped = mapError(err);
  if (mapped.logLevel === 'error') {
    // Bugs and dependency failures: keep the full error (stack + cause) for debugging.
    req.log.error(
      { err, code: mapped.code, status: mapped.httpStatus },
      mapped.unexpected ? 'Unhandled error' : mapped.message,
    );
  } else {
    // Expected client errors (404, validation): a stack trace adds noise and log cost, not insight.
    req.log.warn({ code: mapped.code, status: mapped.httpStatus }, mapped.message);
  }

  res.status(mapped.httpStatus).json(buildErrorBody(req, mapped));
};

/** Unknown routes use the same envelope as every other error instead of Express's HTML page. */
export const notFoundHandler: RequestHandler = () => {
  throw new NotFoundError('Route not found', { code: 'ROUTE_NOT_FOUND' });
};
