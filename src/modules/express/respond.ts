import type { Request, Response } from 'express';
import type { ErrorDetail, MappedError } from '../errors';

/**
 * Every REST response has the same shape:
 *   { success: true,  data: {...},  meta: { requestId, timestamp } }
 *   { success: false, error: { code, message, details? }, meta: { requestId, timestamp } }
 * so clients can always check `success` first, and quote the requestId when reporting a problem.
 *
 * (GraphQL responses keep GraphQL's standard { data, errors } shape instead.)
 */
export interface ResponseMeta {
  requestId: string;
  timestamp: string;
}

export interface SuccessBody<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

export interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
  };
  meta: ResponseMeta;
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
      details: mapped.details,
    },
    meta: buildMeta(req),
  };
}
