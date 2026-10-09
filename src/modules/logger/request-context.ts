import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

export interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Remembers the current request's id for all code that runs while handling that request, even
 * after many `await`s, and even in objects created once at startup (the retry client, the
 * forecast cache). Node's AsyncLocalStorage does this for us.
 *
 * The logger reads the id from here, so every log line gets the right request id without us
 * passing it through every function.
 */
export const requestContextMiddleware: RequestHandler = (req, _res, next) => {
  const requestId = typeof req.id === 'string' ? req.id : 'unknown';
  storage.run({ requestId }, next);
};

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Runs `fn` with a given request id. Used by tests (and could be used by a scheduled job). */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}
