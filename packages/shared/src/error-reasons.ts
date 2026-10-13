/**
 * Machine-readable business reasons carried in an API error's `details.code`
 * (#996). The top-level `error.code` stays the generic class code
 * (`bad_request`, `conflict`…); clients branch on `details.code`, never on the
 * English `message`, which can be reworded at any time.
 */
export const ERROR_REASONS = {
  /** 409: the same Idempotency-Key is still being processed; retry shortly. */
  IDEMPOTENCY_IN_FLIGHT: "idempotency_in_flight",
  /** 409: the Idempotency-Key was reused with a different request. */
  IDEMPOTENCY_PAYLOAD_MISMATCH: "idempotency_payload_mismatch",
  /** 400: an offline scan's `scannedAt` is ahead of the server clock. */
  SCAN_TIMESTAMP_IN_FUTURE: "scan_timestamp_in_future",
  /** 409: the scanned badge was revoked. */
  BADGE_REVOKED: "badge_revoked",
  /** 409: the scanned ticket was revoked. */
  TICKET_REVOKED: "ticket_revoked",
  /** 409: a team member is busy in another judging room. */
  TEAM_MEMBER_BUSY: "team_member_busy",
  /** 400: schedule item ends at or before it starts. */
  SCHEDULE_ENDS_BEFORE_STARTS: "schedule_ends_before_starts",
  /** 400: a scan-required schedule item is not visible to participants. */
  SCHEDULE_SCAN_NEEDS_PARTICIPANTS: "schedule_scan_needs_participants",
  /** 404: the schedule item does not exist. */
  SCHEDULE_ITEM_NOT_FOUND: "schedule_item_not_found",
} as const;

export type ErrorReason = (typeof ERROR_REASONS)[keyof typeof ERROR_REASONS];

/**
 * Per-field reasons of a failed application response validation, returned in
 * `details.fieldReasons` (field key → reason) next to the legacy
 * `details.fields` message map.
 */
export const FIELD_ERROR_REASONS = {
  REQUIRED: "required",
  INVALID_OPTION: "invalid_option",
  MUST_BE_NUMBER: "must_be_number",
  MUST_BE_BIRTH_YEAR: "must_be_birth_year",
  MUST_BE_BOOLEAN: "must_be_boolean",
  MUST_BE_ARRAY: "must_be_array",
  MUST_BE_STRING: "must_be_string",
  MUST_BE_UNIVERSITY_ID: "must_be_university_id",
  MUST_BE_DEGREE_ID: "must_be_degree_id",
  MUST_BE_CITY: "must_be_city",
  TOO_SHORT: "too_short",
  TOO_LONG: "too_long",
  INVALID_FORMAT: "invalid_format",
  TOO_SMALL: "too_small",
  TOO_LARGE: "too_large",
  TOO_FEW_SELECTED: "too_few_selected",
  TOO_MANY_SELECTED: "too_many_selected",
  MUST_CONTAIN_TEXT: "must_contain_text",
  MUST_NOT_CONTAIN_TEXT: "must_not_contain_text",
  INVALID_EMAIL: "invalid_email",
  INVALID_URL: "invalid_url",
} as const;

export type FieldErrorReason = (typeof FIELD_ERROR_REASONS)[keyof typeof FIELD_ERROR_REASONS];

/** The reason in `details.code` of an API error body, or null when absent. */
export function errorDetailsReason(details: unknown): string | null {
  const code = (details as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : null;
}
