import { pool } from "../../db/pool.js";

import { grantedRoleNameSql } from "./granted-role.js";

// ── read helpers ──────────────────────────────────────────────────────────────

/**
 * H13/H14: staff-only JSON array of the rejections a response went through
 * before it came back as a draft, newest first. `alias` is the
 * application_responses alias of the surrounding query.
 */
export function previousRejectionsSql(alias: string): string {
  return `(SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'reason', rr.reason, 'notified', rr.notified, 'returned', rr.returned,
              'rejected_by_name', ru.name, 'rejected_at', rr.created_at
            ) ORDER BY rr.created_at DESC, rr.id DESC), '[]'::jsonb)
            FROM application_response_rejections rr
            LEFT JOIN users ru ON ru.id = rr.rejected_by AND ru.anonymized_at IS NULL
           WHERE rr.response_id = ${alias}.id)`;
}

/** Applicant-facing status masks internal decisions as "review" until sent (H14). */
export function maskStatus(status: string): string {
  if (status === "accepted_internal" || status === "rejected_internal") return "review";
  return status;
}

/**
 * Applicant-facing copy of a response row: masked status, and the rejection
 * reason only once the rejection has been sent (H14) — including a sent
 * reject-and-return, whose reason stays on the draft until resubmission.
 */
export function maskResponse<T extends { status: string; rejection_reason?: string | null }>(
  row: T,
): T {
  return {
    ...row,
    status: maskStatus(row.status),
    rejection_reason:
      row.status === "rejected" || row.status === "draft" ? (row.rejection_reason ?? null) : null,
  };
}

/**
 * Staff-facing list of one user's application responses (M3.3 — the profile's
 * Application tab). Unlike listMyResponses this keeps the REAL status (staff see
 * accepted_internal/rejected_internal), and includes the sent flag so the UI can
 * link straight into the review view for a modifiable, permission-guarded form.
 */
export async function listUserResponsesForStaff(userId: number): Promise<
  Array<{
    id: number;
    application_id: number;
    application_name: string;
    /** H8: name of the form's highest-position granted role, or
     *  null if it grants none — replaces the retired static `type` field. */
    application_granted_role_name: string | null;
    status: string;
    decision_sent: boolean;
    submitted_at: Date | null;
  }>
> {
  const { rows } = await pool.query(
    `SELECT r.id, r.application_id, a.name AS application_name,
            ${grantedRoleNameSql("a", "application_granted_role_name")},
            r.status, r.decision_sent_at, r.submitted_at
     FROM application_responses r
     JOIN applications a ON a.id = r.application_id
     JOIN users u ON u.id = r.user_id AND u.is_test_account = false
     WHERE r.user_id = $1 AND a.event_key = current_edition() ORDER BY r.id DESC`,
    [userId],
  );
  return rows.map(
    (r: {
      id: number;
      application_id: number;
      application_name: string;
      application_granted_role_name: string | null;
      status: string;
      decision_sent_at: Date | null;
      submitted_at: Date | null;
    }) => ({
      id: r.id,
      application_id: r.application_id,
      application_name: r.application_name,
      application_granted_role_name: r.application_granted_role_name,
      status: r.status,
      decision_sent: r.decision_sent_at !== null,
      submitted_at: r.submitted_at,
    }),
  );
}

export async function listMyResponses(userId: number): Promise<
  Array<{
    id: number;
    application_id: number;
    application_name: string;
    status: string;
    submitted_at: Date | null;
    can_delete_draft: boolean;
  }>
> {
  const { rows } = await pool.query(
    `SELECT r.id, r.application_id, a.name AS application_name, r.status,
            r.decision_sent_at, r.submitted_at,
            (r.status = 'draft' AND r.submitted_at IS NULL AND NOT EXISTS (
              SELECT 1 FROM audit_log l
              WHERE l.entity_type = 'application_response' AND l.entity_id = r.id::text
                AND l.action IN ('submitted', 'returned_to_draft')
            )) AS can_delete_draft
     FROM application_responses r
     JOIN applications a ON a.id = r.application_id
     WHERE r.user_id = $1 AND a.event_key = current_edition() ORDER BY r.id DESC`,
    [userId],
  );
  return rows.map(
    (r: {
      id: number;
      application_id: number;
      application_name: string;
      status: string;
      decision_sent_at: Date | null;
      submitted_at: Date | null;
      can_delete_draft: boolean;
    }) => ({
      id: r.id,
      application_id: r.application_id,
      application_name: r.application_name,
      status: maskStatus(r.status),
      submitted_at: r.submitted_at,
      can_delete_draft: r.can_delete_draft,
    }),
  );
}
