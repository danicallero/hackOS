import { errorDetailsReason } from "@hackos/shared/error-reasons";
import { ApiError } from "./api";

/**
 * The specific business reason of an API error: `details.code`, falling back
 * to the generic top-level code. Branch on this, never on `message` (#996).
 */
export function apiErrorReason(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  return errorDetailsReason(err.details) ?? err.code ?? null;
}
