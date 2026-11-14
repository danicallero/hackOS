import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";

import type pg from "pg";

import { auditMany } from "../../lib/audit.js";

import { assertVerifiedPrimaryEmail } from "../../lib/email-verification.js";

import { ConflictError, NotFoundError } from "../../lib/errors.js";

import { assertFixtureSubjectScope } from "../../lib/fixture-subject-scope.js";

import { broadcast } from "../../lib/sse.js";

import { applyRoleAssignmentRevokeRules } from "../identity/role-grants.js";

import { enqueueWalletSync } from "../logistics/wallet-sync.js";

import type { ResponseRow } from "./types.js";

export type ConfirmVia = "email_link" | "web" | "admin_override";

export async function lockResponse(
  client: pg.PoolClient,
  responseId: number,
  actorId?: number,
): Promise<ResponseRow> {
  // Resolve the owner without locking the response first. Account removal
  // locks users before their application rows; every staff transition must do
  // the same or it can race the lifecycle gate (and deadlock with the scrub).
  const { rows: targetRows } = await client.query(
    `SELECT user_id FROM application_responses WHERE id = $1`,
    [responseId],
  );
  if (!targetRows[0]) throw new NotFoundError("Response not found");
  const targetUserId = Number(targetRows[0].user_id);
  const { rows: userRows } = await client.query(
    `SELECT id FROM users
      WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
      FOR UPDATE`,
    [targetUserId],
  );
  if (!userRows[0]) throw new NotFoundError("Response not found");
  if (actorId != null) {
    await assertFixtureSubjectScope(client, actorId, targetUserId);
  }
  const { rows } = await client.query(
    `SELECT * FROM application_responses WHERE id = $1 FOR UPDATE`,
    [responseId],
  );
  if (!rows[0]) throw new NotFoundError("Response not found");
  return rows[0];
}

/**
 * H1/H15: resolve the target without locking it, lock the target user's
 * verification state first, then lock the response. This matches submit's
 * user→response order and avoids a deadlock when a submit races a token
 * confirmation or decline.
 */
export async function lockVerifiedResponseByToken(
  client: pg.PoolClient,
  token: string,
  action: "confirmation" | "decline",
): Promise<ResponseRow> {
  const { rows: tokenRows } = await client.query(
    `SELECT used_at, expires_at FROM email_verification_tokens
     WHERE token = $1 AND type = 'spot_confirmation'`,
    [token],
  );
  if (!tokenRows[0]) throw new NotFoundError(`Invalid ${action} token`);
  if (tokenRows[0].used_at) {
    throw new ConflictError("This confirmation link has already been used", {
      code: "confirmation_used",
    });
  }
  if (new Date(tokenRows[0].expires_at).getTime() <= Date.now()) {
    throw new ConflictError("This confirmation link has expired", { code: "confirmation_expired" });
  }
  const { rows: targetRows } = await client.query(
    `SELECT r.id, r.user_id FROM email_verification_tokens t
     JOIN application_responses r ON r.id =
       (SELECT id FROM application_responses WHERE confirmation_token_id = t.id)
     WHERE t.token = $1 AND t.type = 'spot_confirmation' AND t.user_id = r.user_id`,
    [token],
  );
  const target = targetRows[0] as { id: number; user_id: number } | undefined;
  if (!target) throw new NotFoundError(`Invalid ${action} token`);
  await assertVerifiedPrimaryEmail(client, target.user_id, { forUpdate: true });

  const { rows } = await client.query(
    `SELECT r.*, t.used_at AS token_used_at, t.expires_at AS token_expires_at,
            t.email AS token_email, u.email AS current_email
     FROM email_verification_tokens t
     JOIN application_responses r ON r.id =
       (SELECT id FROM application_responses WHERE confirmation_token_id = t.id)
     JOIN users u ON u.id = r.user_id
     WHERE t.token = $1 AND t.type = 'spot_confirmation' AND r.id = $2
       AND t.user_id = r.user_id
     FOR UPDATE OF r, t`,
    [token, target.id],
  );
  if (!rows[0]) throw new NotFoundError(`Invalid ${action} token`);
  if (rows[0].token_email.toLowerCase() !== rows[0].current_email.toLowerCase()) {
    throw new NotFoundError(`Invalid ${action} token`);
  }
  if (rows[0].token_used_at) {
    throw new ConflictError("This confirmation link has already been used", {
      code: "confirmation_used",
    });
  }
  if (new Date(rows[0].token_expires_at).getTime() <= Date.now()) {
    throw new ConflictError("This confirmation link has expired", { code: "confirmation_expired" });
  }
  return rows[0];
}

/** Invalidates a pending confirmation token, if one exists. */
export async function invalidateConfirmationToken(
  client: pg.PoolClient,
  tokenId: number,
): Promise<void> {
  await client.query(
    `UPDATE email_verification_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
    [tokenId],
  );
}

/**
 * Throws ConflictError when `capacity` is already reached. Takes the
 * already-loaded capacity rather than loading it itself, since callers load
 * the application row under different locking strategies (e.g. `decide`'s
 * `FOR UPDATE` serializes concurrent accepts — this helper must not weaken
 * that by re-reading it unlocked).
 */
export async function assertCapacityAvailable(
  client: pg.PoolClient,
  applicationId: number,
  capacity: number,
  excludeResponseId?: number,
): Promise<void> {
  const { rows: countRows } = await client.query(
    excludeResponseId === undefined
      ? `SELECT count(*)::int AS n FROM application_responses
         JOIN users u ON u.id = application_responses.user_id
         WHERE application_responses.application_id = $1 AND u.is_test_account = false
           AND application_responses.status IN ('accepted_internal', 'accepted', 'confirmed')`
      : `SELECT count(*)::int AS n FROM application_responses
         JOIN users u ON u.id = application_responses.user_id
         WHERE application_responses.application_id = $1 AND u.is_test_account = false
           AND application_responses.id <> $2
           AND application_responses.status IN ('accepted_internal', 'accepted', 'confirmed')`,
    excludeResponseId === undefined ? [applicationId] : [applicationId, excludeResponseId],
  );
  if (countRows[0].n >= capacity) {
    throw new ConflictError("Capacity reached for this application", {
      code: "capacity_full",
      capacity,
    });
  }
}

/**
 * Undo the role grant from doConfirm's `application_confirmed` roles when a
 * confirmed spot is lost (H15 decline, M2 admin revoke) — mirrors the manual
 * role-removal path (identity/routes/roles.ts) including its revoke-rule
 * cascade. Only rows this application granted and that are still tagged
 * `source = 'application_confirmed'` are touched, so a role an admin later
 * assigned manually for an unrelated reason is left alone.
 */
export async function revokeApplicationGrantedRoles(
  client: pg.PoolClient,
  userId: number,
  applicationId: number,
  actorId: number | null,
): Promise<void> {
  const { rows: grantRows } = await client.query(
    `SELECT role_id FROM application_grants_roles WHERE application_id = $1`,
    [applicationId],
  );
  const roleIds = grantRows.map((r) => r.role_id as number);
  if (roleIds.length === 0) return;

  const { rows: revoked } = await client.query(
    `DELETE FROM user_roles
     WHERE user_id = $1
       AND role_id = ANY($2::int[])
       AND source = 'application_confirmed'
       AND event_key = (SELECT a.event_key FROM applications a WHERE a.id = $3)
       AND NOT EXISTS (
         SELECT 1
           FROM application_responses other_response
           JOIN applications other_app ON other_app.id = other_response.application_id
           JOIN application_grants_roles other_grant
             ON other_grant.application_id = other_response.application_id
          WHERE other_response.user_id = $1
            AND other_response.status = 'confirmed'
            AND other_response.application_id <> $3
            AND other_app.event_key = user_roles.event_key
            AND other_grant.role_id = user_roles.role_id
       )
     RETURNING role_id`,
    [userId, roleIds, applicationId],
  );
  for (const row of revoked as { role_id: number }[]) {
    await applyRoleAssignmentRevokeRules(client, userId, row.role_id, actorId);
  }
  await auditMany(
    client,
    (revoked as { role_id: number }[]).map((row) => ({
      actorId,
      entityType: "role",
      entityId: row.role_id,
      action: "remove_user",
      source: "system",
      before: { userId },
      reason: "application spot lost after confirmation",
    })),
  );
}

export async function pushTicketVoid(userId: number, voidedPassIds: number[]): Promise<void> {
  if (voidedPassIds.length === 0) return;
  await broadcast(`${SSE_TOPICS.USER_PREFIX}${userId}`, EVENTS.LOGISTICS_WALLET_PASS_UPDATED, {
    purpose: "ticket",
    status: "voided",
  });
  await enqueueWalletSync(voidedPassIds);
}
