import type { Queryable } from "../../db/pool.js";

import { pool } from "../../db/pool.js";

import { NotFoundError } from "../../lib/errors.js";

import {
  decide,
  reAccept,
  resendDecision,
  revertDecision,
  revokeSpot,
  sendDecision,
} from "./decisions.js";

// ── decision pool (review dashboard) ─────────────────────────────────────────

interface DecisionPoolRow {
  id: number;
  user_id: number;
  name: string | null;
  email: string;
  status: string;
  decision_sent_at: Date | null;
  declined_at: Date | null;
  submitted_at: Date | null;
  avg_score: number | null;
  review_count: number;
}

interface DecisionPool {
  accepted: { unsent: DecisionPoolRow[]; sent: DecisionPoolRow[] };
  rejected: { unsent: DecisionPoolRow[]; sent: DecisionPoolRow[] };
  declined: { manual: DecisionPoolRow[]; expired: DecisionPoolRow[] };
}

async function loadDecisionPoolRows(
  client: Queryable,
  applicationId: number,
  statuses: string[],
): Promise<DecisionPoolRow[]> {
  const { rows } = await client.query(
    `SELECT r.id, r.user_id, u.name, u.email, r.status, r.decision_sent_at,
            r.declined_at, r.submitted_at,
            COALESCE(avg(ar.score), NULL) AS avg_score,
            count(ar.author_id)::int AS review_count
     FROM application_responses r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN applicant_reviews ar ON ar.response_id = r.id
     WHERE r.application_id = $1 AND r.status = ANY($2)
       AND u.account_state = 'active' AND u.anonymized_at IS NULL
       AND u.is_test_account = false
     GROUP BY r.id, u.name, u.email
     ORDER BY r.id`,
    [applicationId, statuses],
  );
  return rows;
}

export async function getDecisionPool(applicationId: number): Promise<DecisionPool> {
  const { rows } = await pool.query(`SELECT id FROM applications WHERE id = $1`, [applicationId]);
  if (!rows[0]) throw new NotFoundError("Application not found");

  const [acceptedUns, acceptedSent, rejectedUns, rejectedSent, declinedManual, declinedExpired] =
    await Promise.all([
      loadDecisionPoolRows(pool, applicationId, ["accepted_internal"]),
      loadDecisionPoolRows(pool, applicationId, ["accepted"]),
      loadDecisionPoolRows(pool, applicationId, ["rejected_internal"]),
      loadDecisionPoolRows(pool, applicationId, ["rejected"]),
      loadDecisionPoolRows(pool, applicationId, ["declined"]),
      loadDecisionPoolRows(pool, applicationId, ["expired"]),
    ]);

  return {
    accepted: { unsent: acceptedUns, sent: acceptedSent },
    rejected: { unsent: rejectedUns, sent: rejectedSent },
    declined: { manual: declinedManual, expired: declinedExpired },
  };
}

// ── batch operations ─────────────────────────────────────────────────────────

export interface BatchResult {
  processed: number;
  // Per-id failures with their reason. Previously batches silently swallowed
  // these (the "flaky batch" symptom): callers saw a count and couldn't tell
  // which rows were skipped or why. Surfacing them makes batches observable.
  skipped: Array<{ id: number; reason: string }>;
}

/**
 * Run a per-response operation over a batch: deterministic id order, one row's
 * failure never aborts the rest, and every skip is reported with its reason.
 */
async function runBatch(
  responseIds: number[],
  op: (id: number) => Promise<unknown>,
): Promise<BatchResult> {
  const sorted = [...responseIds].sort((a, b) => a - b);
  let processed = 0;
  const skipped: Array<{ id: number; reason: string }> = [];
  for (const id of sorted) {
    try {
      await op(id);
      processed++;
    } catch (err) {
      skipped.push({ id, reason: err instanceof Error ? err.message : "failed" });
    }
  }
  return { processed, skipped };
}

export async function batchDecide(
  actorId: number,
  responseIds: number[],
  decision: "accepted" | "rejected",
): Promise<BatchResult> {
  return runBatch(responseIds, (id) => decide(actorId, id, decision));
}

/** Batch re-accept declined/rejected/expired responses (M2). */
export async function batchReAccept(actorId: number, responseIds: number[]): Promise<BatchResult> {
  return runBatch(responseIds, (id) => reAccept(actorId, id));
}

/** Batch revoke accepted/confirmed spots → rejected (M2). */
export async function batchRevokeSpots(
  actorId: number,
  responseIds: number[],
): Promise<BatchResult> {
  return runBatch(responseIds, (id) => revokeSpot(actorId, id));
}

/**
 * Send every still-unsent internal decision in the batch (outbox → sent).
 * Only ever acts on `accepted_internal`/`rejected_internal` rows — any other
 * status (already sent, already final) is skipped rather than resent, so this
 * can never double-send an email. Explicit re-sends go through
 * `batchResendDecisions` instead (H14).
 */
export async function batchSendDecisions(
  actorId: number,
  responseIds: number[],
): Promise<{
  sent: number;
  tokens: Array<{ responseId: number; token: string | null }>;
  skipped: Array<{ id: number; reason: string }>;
}> {
  const tokens: Array<{ responseId: number; token: string | null }> = [];
  const skipped: Array<{ id: number; reason: string }> = [];
  const sorted = [...responseIds].sort((a, b) => a - b);
  const statusById = new Map<number, string>();
  if (sorted.length > 0) {
    const { rows: statusRows } = await pool.query(
      `SELECT id, status FROM application_responses WHERE id = ANY($1::int[])`,
      [sorted],
    );
    for (const row of statusRows) statusById.set(Number(row.id), row.status as string);
  }
  for (const id of sorted) {
    try {
      const status = statusById.get(id);
      if (status === undefined) {
        skipped.push({ id, reason: "not found" });
        continue;
      }
      if (status === "accepted_internal" || status === "rejected_internal") {
        const result = await sendDecision(actorId, id);
        tokens.push({ responseId: id, token: result.confirmationToken });
      } else {
        skipped.push({ id, reason: `nothing to send from status ${status}` });
      }
    } catch (err) {
      skipped.push({ id, reason: err instanceof Error ? err.message : "failed" });
    }
  }
  return { sent: tokens.length, tokens, skipped };
}

/** Explicitly re-send an already-sent decision (accepted/rejected/expired) for each id in the batch (H14/H15). */
export async function batchResendDecisions(
  actorId: number,
  responseIds: number[],
): Promise<BatchResult> {
  return runBatch(responseIds, (id) => resendDecision(actorId, id));
}

export async function batchRevertDecisions(
  actorId: number,
  responseIds: number[],
  newDecision: "accepted" | "rejected" | "review",
): Promise<BatchResult> {
  return runBatch(responseIds, (id) => revertDecision(actorId, id, newDecision));
}

// ── confirm link retrieval (H15) ────────────────────────────────────────────

export async function getConfirmLink(
  responseId: number,
): Promise<{ token: string; expiresAt: Date } | null> {
  const { rows } = await pool.query(
    `SELECT t.token, t.expires_at
     FROM application_responses r
     JOIN email_verification_tokens t ON t.id = r.confirmation_token_id
     WHERE r.id = $1 AND r.status = 'accepted' AND t.type = 'spot_confirmation'
       AND t.used_at IS NULL AND t.expires_at > now() AND t.user_id = r.user_id
       AND EXISTS (
         SELECT 1 FROM users u
          WHERE u.id = r.user_id AND u.is_test_account = false
            AND lower(u.email) = lower(t.email)
       )
     ORDER BY t.id DESC LIMIT 1`,
    [responseId],
  );
  if (!rows[0]) return null;
  return { token: rows[0].token, expiresAt: rows[0].expires_at };
}
