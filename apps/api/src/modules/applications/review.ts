import { withTransaction } from "../../db/pool.js";

import { audit } from "../../lib/audit.js";

import { lockRoleGraph } from "../identity/role-authority.js";

import { reconcileTicketAccess } from "../logistics/tickets.js";

import {
  invalidateConfirmationToken,
  lockResponse,
  pushTicketVoid,
  revokeApplicationGrantedRoles,
} from "./internal.js";

import type { ResponseRow } from "./types.js";

/** H12/H14: give an applicant their response back for revision. A confirmed
 * applicant keeps their application-granted role only when the next submit is
 * configured for auto-accept; otherwise the role and live ticket access are
 * revoked until a later review/confirmation restores them. */
export async function returnToDraft(
  actorId: number,
  responseId: number,
  input: { allow_resubmit_after_close: boolean; auto_accept_on_resubmit: boolean },
): Promise<ResponseRow> {
  let voidedPassIds: number[] = [];
  const result = await withTransaction(async (client) => {
    await lockRoleGraph(client);
    const response = await lockResponse(client, responseId, actorId);
    if (response.status === "draft") return { response, userId: response.user_id };
    const wasConfirmed = response.status === "confirmed";
    if (response.confirmation_token_id) {
      await invalidateConfirmationToken(client, response.confirmation_token_id);
    }
    const { rows } = await client.query(
      `UPDATE application_responses
          SET status = 'draft', decision_sent_at = NULL, confirmation_token_id = NULL,
              confirmed_at = NULL, declined_at = NULL, submitted_at = NULL,
              rejection_reason = NULL, draft_reminders_sent = 0, draft_reminded_at = NULL,
              allow_resubmit_after_close = $2, auto_accept_on_resubmit = $3
        WHERE id = $1 RETURNING *`,
      [responseId, input.allow_resubmit_after_close, input.auto_accept_on_resubmit],
    );
    if (wasConfirmed && !input.auto_accept_on_resubmit) {
      await revokeApplicationGrantedRoles(
        client,
        response.user_id,
        response.application_id,
        actorId,
      );
      voidedPassIds = (await reconcileTicketAccess(client, response.user_id)).voidedPassIds;
    }
    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: responseId,
      action: "returned_to_draft",
      before: { status: response.status },
      after: {
        status: "draft",
        ...input,
        ...(wasConfirmed && !input.auto_accept_on_resubmit ? { applicationRoleRevoked: true } : {}),
      },
    });
    return { response: rows[0] as ResponseRow, userId: response.user_id };
  });
  if (voidedPassIds.length > 0) await pushTicketVoid(result.userId, voidedPassIds);
  return result.response;
}

// ── review (H13) ─────────────────────────────────────────────────────────────

export async function upsertReview(
  authorId: number,
  responseId: number,
  score: number | null | undefined,
  notes: string | null | undefined,
  editSessionId?: string,
): Promise<void> {
  await withTransaction(async (client) => {
    await lockResponse(client, responseId, authorId); // ensures the response exists and is in scope
    const { rows: previous } = await client.query<{ score: number | null; notes: string | null }>(
      `SELECT score, notes FROM applicant_reviews WHERE response_id = $1 AND author_id = $2`,
      [responseId, authorId],
    );
    const before = previous[0] ?? { score: null, notes: null };
    const next = { score: score ?? null, notes: notes ?? null };
    if (before.score === next.score && before.notes === next.notes) return;
    await client.query(
      `INSERT INTO applicant_reviews (response_id, author_id, score, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (response_id, author_id)
       DO UPDATE SET score = EXCLUDED.score, notes = EXCLUDED.notes`,
      [responseId, authorId, score ?? null, notes ?? null],
    );
    // H53: one bounded editing session, without retaining private review text.
    // The response lock serializes saves, including the first audit insertion.
    const changedFields = [
      ...(before.score !== next.score ? ["score"] : []),
      ...(before.notes !== next.notes ? ["notes"] : []),
    ];
    if (editSessionId) {
      const merged = await client.query(
        `UPDATE audit_log
            SET last_edited_at = clock_timestamp(),
              changed_fields = ARRAY(SELECT DISTINCT unnest(changed_fields || ARRAY(SELECT jsonb_array_elements_text($5::jsonb)))),
              after = after || jsonb_build_object(
              'score', $4::int, 'last_edited_at', clock_timestamp(),
              'changed_fields', (SELECT jsonb_agg(DISTINCT field)
                FROM jsonb_array_elements_text((after->'changed_fields') || $5::jsonb) AS fields(field)))
          WHERE id = (SELECT id FROM audit_log
            WHERE actor_id = $1 AND entity_type = 'application_response' AND entity_id = $2
              AND action = 'review_scored' AND after->>'edit_session_id' = $3
              AND created_at > now() - interval '30 minutes'
            ORDER BY id DESC LIMIT 1)
          RETURNING id`,
        [authorId, String(responseId), editSessionId, next.score, JSON.stringify(changedFields)],
      );
      if (merged.rowCount) return;
    }
    await audit(client, {
      actorId: authorId,
      entityType: "application_response",
      entityId: responseId,
      action: "review_scored",
      before: { score: before.score },
      after: {
        score: next.score,
        changed_fields: changedFields,
        ...(editSessionId ? { edit_session_id: editSessionId } : {}),
        last_edited_at: new Date().toISOString(),
      },
    });
  });
}

export async function setStaffNotes(
  actorId: number,
  responseId: number,
  staffNotes: string | null,
): Promise<void> {
  await withTransaction(async (client) => {
    const response = await lockResponse(client, responseId, actorId);
    const { rows: users } = await client.query<{ notes: string | null }>(
      `SELECT notes FROM users WHERE id = $1 FOR UPDATE`,
      [response.user_id],
    );
    if (users[0]?.notes === staffNotes) return;
    await client.query(`UPDATE users SET notes = $2 WHERE id = $1`, [response.user_id, staffNotes]);
    await audit(client, {
      actorId,
      entityType: "user",
      entityId: response.user_id,
      action: "staff_notes_updated",
      after: { changed_fields: ["notes"] },
    });
  });
}
