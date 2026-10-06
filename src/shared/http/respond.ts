import type { Request, Response } from 'express';
import type { ErrorDetail } from '../errors/app-error';
import type { MappedError } from '../errors/error-mapper';

/**
 * One response envelope for every REST endpoint, so clients can always check `success`
 * first and find the request id when they report a problem.
 *
 * (GraphQL keeps its spec-defined { data, errors } shape. It shares the same *error
 * policy* through error-mapper, not this envelope.)
 */
export interface ResponseMeta {
  readonly requestId: string;
  readonly timestamp: string;
}

export interface SuccessBody<T> {
  readonly success: true;
  readonly data: T;
  readonly meta: ResponseMeta;
}

export interface ErrorBody {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: readonly ErrorDetail[];
  };
  readonly meta: ResponseMeta;
}

export function buildMeta(req: Request, now: Date = new Date()): ResponseMeta {
  // genReqId always produces a string; the fallback only guards against misconfiguration.
  const requestId = typeof req.id === 'string' ? req.id : 'unknown';
  return { requestId, timestamp: now.toISOString() };
}

export function sendSuccess(req: Request, res: Response, data: unknown, status = 200): void {
  const body: SuccessBody<unknown> = { success: true, data, meta: buildMeta(req) };
  res.status(status).json(body);
}

export function buildErrorBody(req: Request, mapped: MappedError): ErrorBody {
  return {
    success: false,
    error: {
      code: mapped.code,
      message: mapped.message,
      ...(mapped.details ? { details: mapped.details } : {}),
    },
    meta: buildMeta(req),
  };
}
