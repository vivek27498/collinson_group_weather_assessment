import type { ErrorRequestHandler, RequestHandler } from 'express';
import { NotFoundError, mapError } from '../errors';
import { buildErrorBody } from './respond';

/**
 * The last middleware: every error in a REST request ends up here.
 *
 * Express 5 automatically sends errors from `async` route handlers here, so handlers can simply
 * `throw` (no try/catch needed). We ask mapError what to do, log it once, and send the
 * standard error response.
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    // Part of the response was already sent, so we can't send ours; let Express close it.
    next(err);
    return;
  }

  const mapped = mapError(err);
  if (mapped.logLevel === 'error') {
    // Bugs and outages: log the full error (with stack trace) so we can debug it.
    req.log.error(
      { err, code: mapped.code, status: mapped.httpStatus },
      mapped.unexpected ? 'Unhandled error' : mapped.message,
    );
  } else {
    // Expected client errors (404, bad input): a stack trace would just be noise.
    req.log.warn({ code: mapped.code, status: mapped.httpStatus }, mapped.message);
  }

  res.status(mapped.httpStatus).json(buildErrorBody(req, mapped));
};

/** Unknown URLs get our normal JSON error response, instead of Express's default HTML page. */
export const notFoundHandler: RequestHandler = () => {
  throw new NotFoundError('Route not found', { code: 'ROUTE_NOT_FOUND' });
};
