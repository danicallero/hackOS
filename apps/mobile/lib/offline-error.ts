import { ApiError } from "@/lib/api";

/** True when the request never reached the server (no status), not when it was refused. */
export function isOfflineError(error: unknown): boolean {
  return error instanceof ApiError ? !error.status : error instanceof TypeError;
}
