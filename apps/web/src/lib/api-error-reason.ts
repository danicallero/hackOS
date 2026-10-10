import { ApiError } from "@/lib/api";

/**
 * The specific business reason of an API error. AppError subclasses answer
 * with a generic `code` (`forbidden`, `bad_request`, `conflict`…) and put the
 * domain reason (`not_sponsor`, `meal_plan_locked`, `removal_pin_expired`…)
 * in `details.code`; fall back to the top-level code when there is none.
 */
export function apiErrorReason(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const reason = (err.details as { code?: unknown } | null | undefined)?.code;
  return typeof reason === "string" ? reason : err.code;
}
