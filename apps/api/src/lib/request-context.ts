import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestLane } from "./request-lanes.js";

export interface RequestContext {
  requestId?: string;
  getActorId?: () => number | null;
  ip?: string;
  userAgent?: string;
  /**
   * Viewed edition from `X-Edition` when it is not the current edition
   * (lib/edition.ts). `db/pool.ts` scopes this request's statements to it.
   */
  edition?: string;
  /** Closed-edition writes allowed for this request (superadmin, close/reopen). */
  editionWriteOverride?: boolean;
  /**
   * Priority lane (#544, #1367). `db/pool.ts` orders pooled-connection
   * checkouts by it, so best-effort work never queues ahead of operations.
   */
  lane?: RequestLane;
  /** Pooled connections this request currently holds (db/pool.ts). */
  dbCheckouts?: number;
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
