import { pool, withTransaction } from "../../db/pool.js";

import { audit } from "../../lib/audit.js";

import { ConflictError, NotFoundError } from "../../lib/errors.js";

import { lockRoleGraph } from "../identity/role-authority.js";

import { reconcileTicketAccess } from "../logistics/tickets.js";

import {
  enqueueDecisionEmailRow,
  enqueueDecisionNotificationRows,
  issueConfirmationToken,
  loadUserComms,
  sendOne,
} from "./decision-delivery.js";

import { requireApplication } from "./forms.js";

import {
  assertCapacityAvailable,
  invalidateConfirmationToken,
  lockResponse,
  pushTicketVoid,
  revokeApplicationGrantedRoles,
} from "./internal.js";

import type { ApplicationRow, ResponseRow } from "./types.js";

// ── decide (H14) ─────────────────────────────────────────────────────────────

export async function decide(
  actorId: number,
  responseId: number,
  decision: "accepted" | "rejected",
): Promise<ResponseRow> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId, actorId);
    // Serialize capacity checks across parallel accepts on the same form.
    const { rows: appRows } = await client.query(
      `SELECT * FROM applications WHERE id = $1 FOR UPDATE`,
      [resp.application_id],
    );
    const app = appRows[0] as ApplicationRow;

    if (resp.status !== "review") {
      throw new ConflictError("Only reviewed responses can be decided", { status: resp.status });
    }

    if (decision === "accepted" && app.capacity != null) {
      await assertCapacityAvailable(client, resp.application_id, app.capacity);
    }

    const internalStatus = decision === "accepted" ? "accepted_internal" : "rejected_internal";
    const updated = await client.query(
      `UPDATE application_responses SET status = $2 WHERE id = $1 RETURNING *`,
      [responseId, internalStatus],
    );
    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: responseId,
      action: `decided_${decision}`,
      before: { status: "review" },
      after: { status: internalStatus, decision_sent_at: null },
      reason: "internal decision (unsent)",
    });
    return updated.rows[0];
  });
}

/** Add, change or clear the reason of an unsent internal rejection (H14). */
export async function setRejectionReason(
  actorId: number,
  responseId: number,
  reason: string | null,
): Promise<ResponseRow> {
  const next = reason?.trim() || null;
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId, actorId);
    if (resp.status !== "rejected_internal") {
      throw new ConflictError("Only an unsent internal rejection can have its reason edited", {
        status: resp.status,
      });
    }
    const updated = await client.query(
      `UPDATE application_responses SET rejection_reason = $2 WHERE id = $1 RETURNING *`,
      [responseId, next],
    );
    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: responseId,
      action: "rejection_reason_updated",
      before: { rejection_reason: resp.rejection_reason },
      after: { rejection_reason: next },
    });
    return updated.rows[0];
  });
}

/**
 * Revert a decision — flip between accepted_internal and
 * rejected_internal, or send it back to review for re-review.
 * Reverting to accepted re-checks capacity. (H14)
 */
export async function revertDecision(
  actorId: number,
  responseId: number,
  newDecision: "accepted" | "rejected" | "review",
): Promise<ResponseRow> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId, actorId);

    if (newDecision === "review") {
      if (
        resp.status !== "accepted_internal" &&
        resp.status !== "rejected_internal" &&
        resp.status !== "accepted" &&
        resp.status !== "rejected"
      ) {
        throw new ConflictError("Only decided responses can be reverted to review", {
          status: resp.status,
        });
      }
      // Invalidate any pending confirmation token
      if (resp.confirmation_token_id) {
        await invalidateConfirmationToken(client, resp.confirmation_token_id);
      }
      const updated = await client.query(
        `UPDATE application_responses
         SET status = 'review', decision_sent_at = NULL, confirmation_token_id = NULL,
             confirmed_at = NULL, declined_at = NULL, rejection_reason = NULL
         WHERE id = $1 RETURNING *`,
        [responseId],
      );
      await audit(client, {
        actorId,
        entityType: "application_response",
        entityId: responseId,
        action: "reverted_to_review",
        before: { status: resp.status },
        after: { status: "review" },
      });
      return updated.rows[0];
    }

    // Flip / un-send to an internal decision. Works from an unsent internal
    // decision AND from an already-SENT one (accepted/rejected) — the latter is
    // un-sent: decision_sent_at and any pending confirmation token are dropped
    // so staff can re-decide before re-sending.
    const revertable = ["accepted_internal", "rejected_internal", "accepted", "rejected"];
    if (!revertable.includes(resp.status)) {
      throw new ConflictError("Only a decided response can be reverted to an internal decision", {
        status: resp.status,
      });
    }

    const newInternalStatus =
      newDecision === "accepted" ? "accepted_internal" : "rejected_internal";
    if (resp.status === newInternalStatus) {
      return resp; // idempotent — already this internal decision
    }

    // Re-check capacity when the result is an accepted slot (ignoring this row).
    if (newDecision === "accepted") {
      const { rows: appRows } = await client.query(
        `SELECT * FROM applications WHERE id = $1 FOR UPDATE`,
        [resp.application_id],
      );
      const app = appRows[0] as ApplicationRow;
      if (app.capacity != null) {
        await assertCapacityAvailable(client, resp.application_id, app.capacity, responseId);
      }
    }

    // If it had already been sent, un-send it: clear the sent marker, any
    // pending confirmation token, and confirm/decline stamps.
    if (resp.confirmation_token_id) {
      await invalidateConfirmationToken(client, resp.confirmation_token_id);
    }
    const updated = await client.query(
      `UPDATE application_responses
         SET status = $2, decision_sent_at = NULL, confirmation_token_id = NULL,
             confirmed_at = NULL, declined_at = NULL, rejection_reason = NULL
       WHERE id = $1 RETURNING *`,
      [responseId, newInternalStatus],
    );
    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: responseId,
      action: `reverted_to_${newDecision}`,
      before: { status: resp.status },
      after: { status: newInternalStatus },
    });
    return updated.rows[0];
  });
}

export async function sendDecision(
  actorId: number,
  responseId: number,
): Promise<{ response: ResponseRow; confirmationToken: string | null }> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId, actorId);
    if (resp.status !== "accepted_internal" && resp.status !== "rejected_internal") {
      throw new ConflictError("Only internal decisions can be sent", {
        status: resp.status,
      });
    }
    if (resp.decision_sent_at) {
      throw new ConflictError("Decision already sent", { code: "already_sent" });
    }
    const app = await requireApplication(client, resp.application_id);
    const token = await sendOne(client, actorId, resp, app);
    const { rows } = await client.query(`SELECT * FROM application_responses WHERE id = $1`, [
      responseId,
    ]);
    return { response: rows[0], confirmationToken: token };
  });
}

export async function sendDecisionsBatch(
  actorId: number,
  applicationId: number,
  includeRejected: boolean,
): Promise<{ sent: number; tokens: Array<{ responseId: number; token: string | null }> }> {
  // Validate the requested form before discovering candidates. Without this
  // guard a typo/removed application looked like a successful empty batch.
  await requireApplication(pool, applicationId);

  // Do not hold response locks while discovering the batch. Each individual
  // sendDecision() reacquires the target user first, then the response, so an
  // account entering removal_pending is skipped safely instead of receiving a
  // decision or an email during the race.
  const statuses = includeRejected
    ? ["accepted_internal", "rejected_internal"]
    : ["accepted_internal"];
  const { rows } = await pool.query(
    `SELECT r.id FROM application_responses r
       JOIN users u ON u.id = r.user_id
      WHERE r.application_id = $1 AND u.account_state = 'active'
        AND u.anonymized_at IS NULL AND u.is_test_account = false
        AND r.status = ANY($2) AND r.decision_sent_at IS NULL
      ORDER BY r.id`,
    [applicationId, statuses],
  );
  const tokens: Array<{ responseId: number; token: string | null }> = [];
  for (const row of rows as Array<{ id: number }>) {
    try {
      const result = await sendDecision(actorId, Number(row.id));
      tokens.push({ responseId: Number(row.id), token: result.confirmationToken });
    } catch (err) {
      if (err instanceof NotFoundError) {
        // A target can enter removal_pending (or be finalized) after the
        // candidate read. Treat only that expected disappearance as a no-op;
        // provider, transaction and all other business failures must reach the
        // caller instead of silently reporting a partial batch.
        continue;
      }
      throw err;
    }
  }
  return { sent: tokens.length, tokens };
}

/**
 * Resend an already-sent decision (H14/H15). For accepted/expired this
 * regenerates the confirmation token + email (also the expired applicant's
 * second chance); for rejected it just re-enqueues the rejection email. Always
 * an explicit, single-response action — never triggered as a side effect of
 * sending unsent decisions (see `batchSendDecisions`), which is what caused
 * rejection emails to go out twice.
 */
export async function resendDecision(
  actorId: number,
  responseId: number,
): Promise<{ response: ResponseRow; confirmationToken: string | null }> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId, actorId);

    if (resp.status === "rejected") {
      const app = await requireApplication(client, resp.application_id);
      const user = await loadUserComms(client, resp.user_id);
      await client.query(
        `UPDATE application_responses SET decision_sent_at = now() WHERE id = $1`,
        [resp.id],
      );
      await enqueueDecisionEmailRow(
        client,
        resp.user_id,
        user,
        app,
        "rejected",
        null,
        resp.rejection_reason,
      );
      await audit(client, {
        actorId,
        entityType: "application_response",
        entityId: resp.id,
        action: "decision_resent",
        before: { status: "rejected" },
        after: { status: "rejected" },
      });
      return { response: resp, confirmationToken: null };
    }

    if (resp.status !== "accepted" && resp.status !== "expired") {
      throw new ConflictError("Only accepted, rejected, or expired responses can be resent", {
        status: resp.status,
      });
    }
    const app = await requireApplication(client, resp.application_id);
    const user = await loadUserComms(client, resp.user_id);
    const token = await issueConfirmationToken(client, resp, app, user.email);
    // An expired response returns to 'accepted' — the org's explicit second chance.
    await client.query(
      `UPDATE application_responses SET status = 'accepted', decision_sent_at = now() WHERE id = $1`,
      [responseId],
    );
    await enqueueDecisionEmailRow(client, resp.user_id, user, app, "accepted", token);
    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: responseId,
      action: "decision_resent",
      before: { status: resp.status },
      after: { status: "accepted" },
    });
    const { rows } = await client.query(`SELECT * FROM application_responses WHERE id = $1`, [
      responseId,
    ]);
    return { response: rows[0], confirmationToken: token };
  });
}

/**
 * Re-accept a declined, rejected, or expired response — moves it back to
 * `accepted` with a fresh confirmation token and applicant notification.
 * Admin operation (APPLICATIONS_DECIDE) that re-checks capacity.
 */
export async function reAccept(
  actorId: number,
  responseId: number,
): Promise<{ response: ResponseRow; confirmationToken: string | null }> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId, actorId);
    if (resp.status !== "declined" && resp.status !== "rejected" && resp.status !== "expired") {
      throw new ConflictError("Only declined, rejected, or expired responses can be re-accepted", {
        status: resp.status,
      });
    }

    const app = await requireApplication(client, resp.application_id);

    if (app.capacity != null) {
      await assertCapacityAvailable(client, resp.application_id, app.capacity);
    }

    const user = await loadUserComms(client, resp.user_id);
    const token = await issueConfirmationToken(client, resp, app, user.email);

    await client.query(
      `UPDATE application_responses
       SET status = 'accepted', decision_sent_at = now(), confirmed_at = NULL, declined_at = NULL,
           rejection_reason = NULL
       WHERE id = $1`,
      [resp.id],
    );

    await enqueueDecisionNotificationRows(client, resp.user_id, user, app, "accepted", token);

    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: resp.id,
      action: "re_accepted",
      before: { status: resp.status },
      after: { status: "accepted" },
    });

    const { rows } = await client.query(`SELECT * FROM application_responses WHERE id = $1`, [
      responseId,
    ]);
    return { response: rows[0], confirmationToken: token };
  });
}

/**
 * Revoke an already-sent acceptance — the "reject / decline spot" action that
 * must work EVEN AFTER the participant has confirmed (M2). Moves accepted or
 * confirmed → rejected: invalidates any pending confirmation token, frees the
 * capacity slot and notifies the applicant. A revoked spot is a normal
 * `rejected` row, so it can later be re-accepted like any other — dietary
 * data is left untouched precisely so a re-accept doesn't lose it.
 * Admin operation (APPLICATIONS_DECIDE).
 */
export async function revokeSpot(actorId: number, responseId: number): Promise<ResponseRow> {
  let voidedPassIds: number[] = [];
  const result = await withTransaction(async (client) => {
    await lockRoleGraph(client);
    const resp = await lockResponse(client, responseId, actorId);
    if (resp.status !== "accepted" && resp.status !== "confirmed") {
      throw new ConflictError("Only accepted or confirmed spots can be revoked", {
        status: resp.status,
      });
    }
    const app = await requireApplication(client, resp.application_id);

    if (resp.confirmation_token_id) {
      await invalidateConfirmationToken(client, resp.confirmation_token_id);
    }
    const updated = await client.query(
      `UPDATE application_responses
       SET status = 'rejected', decision_sent_at = now(),
           confirmation_token_id = NULL, confirmed_at = NULL, declined_at = NULL
       WHERE id = $1 RETURNING *`,
      [responseId],
    );
    const user = await loadUserComms(client, resp.user_id);
    await enqueueDecisionEmailRow(client, resp.user_id, user, app, "rejected", null);

    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: responseId,
      action: "spot_revoked",
      before: { status: resp.status },
      after: { status: "rejected" },
      reason: resp.status === "confirmed" ? "revoked after confirmation" : "revoked before confirm",
    });

    // A confirmed spot grants the roles configured on its form. Revoke those
    // application-owned roles first, then reconcile the user's ticket from
    // the complete remaining role set. This preserves access when another
    // role or confirmed response still grants event access.
    if (resp.status === "confirmed") {
      await revokeApplicationGrantedRoles(client, resp.user_id, resp.application_id, actorId);
      voidedPassIds = (await reconcileTicketAccess(client, resp.user_id)).voidedPassIds;
    }
    return updated.rows[0] as ResponseRow;
  });
  await pushTicketVoid(result.user_id, voidedPassIds);
  return result;
}
