import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * A caller may send their own request id (header x-request-id). We only accept it if it looks
 * like an id: letters, digits, '.', '_' or '-', up to 64 characters. Anything else (e.g. a
 * newline) could be used to forge fake log lines, so we generate a new id instead.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function resolveRequestId(incoming: string | string[] | undefined): string {
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  if (candidate !== undefined && SAFE_REQUEST_ID.test(candidate)) {
    return candidate;
  }
  return randomUUID();
}

/** Used by pino-http to pick each request's id. The id is also sent back in the response header. */
export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const id = resolveRequestId(req.headers['x-request-id']);
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
