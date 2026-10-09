import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

export interface RequestContext {
  readonly requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Makes the current request's id available to *any* code running on its behalf, including
 * code several async hops away that was constructed once at startup (the HTTP retry decorator,
 * the forecast cache, background refreshes). The logger reads it via pino's `mixin`, so
 * correlation needs no logger plumbing through every constructor.
 */
export const requestContextMiddleware: RequestHandler = (req, _res, next) => {
  const requestId = typeof req.id === 'string' ? req.id : 'unknown';
  storage.run({ requestId }, next);
};

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** For tests and non-HTTP entry points (e.g. a future scheduled pre-warm job). */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}
