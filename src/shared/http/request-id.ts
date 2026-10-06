import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Only accept a caller's request id if it looks like an id. Anything else (very long
 * values, newlines, control characters) could be used for log injection, so we replace it.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function resolveRequestId(incoming: string | string[] | undefined): string {
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  return candidate !== undefined && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
}

/** Plugged into pino-http as `genReqId`, so every log line and the response share one id. */
export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const id = resolveRequestId(req.headers['x-request-id']);
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
