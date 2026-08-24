import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `context` available to `getRequestContext()` for its whole async lifetime. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The current request's context, or undefined outside a request (e.g. a background worker). */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
