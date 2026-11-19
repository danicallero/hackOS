import { ApiError } from "@/lib/api";

/** True when the request never reached the server (no status), not when it was refused. */
export function isOfflineError(error: unknown): boolean {
  return error instanceof ApiError ? !error.status : error instanceof TypeError;
}

/**
 * True when trying again can help: no connection, rate limiting or a server
 * fault. A refusal (any other 4xx) answers the same on every retry.
 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return !error.status || error.status === 429 || error.status >= 500;
}
