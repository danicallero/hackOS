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
  /** 409: a judge saves a text field without holding its editing lease. */
  REVIEW_FIELD_LEASE_REQUIRED: "review_field_lease_required",
  TEAM_MEMBER_BUSY: "team_member_busy",
  /** 400: schedule item ends at or before it starts. */
  SCHEDULE_ENDS_BEFORE_STARTS: "schedule_ends_before_starts",
  /** 400: a scan-required schedule item is not visible to participants. */
  SCHEDULE_SCAN_NEEDS_PARTICIPANTS: "schedule_scan_needs_participants",
  /** 409: certificates are not offered, or the participant is below the venue-hours threshold (#1083). */
  CERTIFICATE_NOT_AVAILABLE: "certificate_not_available",
  /** 409: attendance is awaiting staff review (#1083). */
  CERTIFICATE_REVIEW_REQUIRED: "certificate_review_required",
  /** 409: the type requires having presented a project (#1083). */
  CERTIFICATE_DEMO_REQUIRED: "certificate_demo_required",
  /** 409: the participant has no verified venue time yet (#1083). */
  CERTIFICATE_HOURS_NOT_MET: "certificate_hours_not_met",
  /** 409: this type is only issued once the event has ended (#1083). */
  CERTIFICATE_EVENT_NOT_ENDED: "certificate_event_not_ended",
  /** 409: the type requires having presented to a specific jury (mandatory or chosen challenge) (#1083). */
  CERTIFICATE_DEMO_JURY_REQUIRED: "certificate_demo_jury_required",
  /** 409: the activities certificate has nothing to list: no scanned non-meal activity (#1083). */
  CERTIFICATE_NO_ACTIVITIES: "certificate_no_activities",
  /** 500: a stored certificate copy no longer matches its SHA-256 (#1083). */
  CERTIFICATE_COPY_CORRUPT: "certificate_copy_corrupt",
  /** 409: the GitHub repository is already linked to another project. */
  GITHUB_REPO_ALREADY_LINKED: "github_repo_already_linked",
  /** 404: the repository is not among the member's GitHub App installations. */
  GITHUB_REPO_NOT_AVAILABLE: "github_repo_not_available",
  /** 404: the schedule item does not exist. */
  SCHEDULE_ITEM_NOT_FOUND: "schedule_item_not_found",
  /** 409: a submitted project is frozen; the team withdraws the submission to edit. */
  PROJECT_FROZEN: "project_frozen",
  /** 400: the event requires a linked GitHub repository to submit. */
  PROJECT_GITHUB_REQUIRED: "project_github_required",
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
  /** 400: the birth year makes the applicant younger than the minimum age. */
  BIRTH_YEAR_TOO_RECENT: "birth_year_too_recent",
  MUST_BE_BIRTH_YEAR: "must_be_birth_year",
  MUST_BE_PHONE: "must_be_phone",
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

/**
 * Localized copy (`common` namespace) per reason: clients render
 * `apiError_<reason>` instead of the English `message` (#1013). Add the entry
 * in all three locales when adding a reason that a user can trigger.
 */
export function errorReasonCopyKey(reason: string): string {
  return `apiError_${reason}`;
}
