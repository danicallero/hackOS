import { ERROR_REASONS } from "@hackos/shared/error-reasons";

import { type AppError, ConflictError, NotFoundError } from "../../lib/errors.js";

/**
 * Stable, translatable code for one row a decision batch could not process
 * (H14). Clients render `apiError_<code>`, never the English message.
 */
export function batchSkipCode(err: AppError): string {
  const reason = (err.details as { code?: unknown } | undefined)?.code;
  if (typeof reason === "string") return reason;
  if (err instanceof NotFoundError) return ERROR_REASONS.RESPONSE_NOT_FOUND;
  if (err instanceof ConflictError) return ERROR_REASONS.RESPONSE_STATUS_CHANGED;
  return err.code;
}
