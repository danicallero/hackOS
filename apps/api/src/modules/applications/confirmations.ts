import type pg from "pg";

import { withTransaction } from "../../db/pool.js";

import { audit } from "../../lib/audit.js";

import { assertVerifiedPrimaryEmail } from "../../lib/email-verification.js";

import { ConflictError, ForbiddenError } from "../../lib/errors.js";

import { lockRoleGraph } from "../identity/role-authority.js";

import { reconcileTicketAccess } from "../logistics/tickets.js";

import { issueWalletAccessToken } from "../logistics/wallet-access.js";

import {
  type ConfirmVia,
  invalidateConfirmationToken,
  lockResponse,
  lockVerifiedResponseByToken,
  pushTicketVoid,
  revokeApplicationGrantedRoles,
} from "./internal.js";

import type { ResponseRow } from "./types.js";

// ── confirm / decline (H15) ──────────────────────────────────────────────────

async function confirmationTokenExpired(
  client: pg.PoolClient,
  resp: ResponseRow,
): Promise<boolean> {
  if (!resp.confirmation_token_id) return true;
  const { rows } = await client.query(
    `SELECT expires_at FROM email_verification_tokens WHERE id = $1`,
    [resp.confirmation_token_id],
  );
  if (!rows[0]) return true;
  return new Date(rows[0].expires_at) < new Date();
}

export interface ConfirmResult {
  status: string;
  alreadyConfirmed: boolean;
  ticketToken: string;
  /** Whose spot this is — the email link identifies a person, not a session. */
  userId: number;
}

/**
 * What the public email-link confirm returns (issue #369): the confirm result
 * plus a scoped wallet credential and just enough identity for the landing
 * page to say "this ticket belongs to m•••@example.com — sign in as them to
 * use the app". Never a session.
 */
interface EmailConfirmResult extends ConfirmResult {
  holderName: string;
  walletToken: string;
  walletTokenExpiresAt: string;
  maskedEmail: string;
}

/**
 * m•••@example.com — enough for the holder of the link to recognize their own
 * account without printing a full address to whoever the mail was forwarded to.
 */
function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

async function doConfirm(
  client: pg.PoolClient,
  resp: ResponseRow,
  via: ConfirmVia,
  actorId: number | null,
): Promise<ConfirmResult> {
  if (resp.status === "confirmed") {
    // Double-confirm is idempotent-friendly (H15): reconcile current role
    // entitlement before returning the historical ticket token.
    const ticketAccess = await reconcileTicketAccess(client, resp.user_id);
    return {
      status: "confirmed",
      alreadyConfirmed: true,
      ticketToken: ticketAccess.ticketToken ?? "",
      userId: resp.user_id,
    };
  }
  if (resp.status !== "accepted") {
    throw new ConflictError("This spot is not in a confirmable state", { status: resp.status });
  }
  if (await confirmationTokenExpired(client, resp)) {
    throw new ConflictError(
      "Your confirmation window has expired — ask the organization to resend",
      {
        code: "confirmation_expired",
        expired: true,
      },
    );
  }

  // capacity is NOT re-checked here: it binds at ACCEPT time (plan invariant);
  // confirm never exceeds it because accepts already respected capacity.
  await client.query(
    `UPDATE application_responses SET status = 'confirmed', confirmed_at = now() WHERE id = $1`,
    [resp.id],
  );
  if (resp.confirmation_token_id) {
    await invalidateConfirmationToken(client, resp.confirmation_token_id);
  }
  // H8/H11: grant every role the form is configured to grant alongside
  // ticket issuance, in the same transaction as the confirmation write.
  const { rows: grantRows } = await client.query(
    `SELECT role_id FROM application_grants_roles WHERE application_id = $1`,
    [resp.application_id],
  );
  const grantedRoleIds = grantRows.map((r) => r.role_id as number);
  if (grantedRoleIds.length > 0) {
    await client.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by, source, event_key)
       SELECT $1, unnest($2::int[]), $3, 'application_confirmed',
              (SELECT a.event_key FROM applications a WHERE a.id = $4)
       ON CONFLICT (user_id, role_id, event_key) DO NOTHING`,
      [resp.user_id, grantedRoleIds, actorId, resp.application_id],
    );
  }
  const ticketAccess = await reconcileTicketAccess(client, resp.user_id);
  await audit(client, {
    actorId,
    entityType: "application_response",
    entityId: resp.id,
    action: "confirmed",
    source: via,
    before: { status: "accepted" },
    after: { status: "confirmed", grantedRoleIds },
  });
  return {
    status: "confirmed",
    alreadyConfirmed: false,
    ticketToken: ticketAccess.ticketToken ?? "",
    userId: resp.user_id,
  };
}

async function doDecline(
  client: pg.PoolClient,
  resp: ResponseRow,
  via: ConfirmVia,
  actorId: number | null,
): Promise<{ status: string; alreadyDeclined: boolean; voidedPassIds: number[] }> {
  if (resp.status === "declined") {
    return { status: "declined", alreadyDeclined: true, voidedPassIds: [] };
  }
  if (resp.status !== "accepted" && resp.status !== "confirmed") {
    throw new ConflictError("This spot is not in a declinable state", { status: resp.status });
  }
  await client.query(
    `UPDATE application_responses SET status = 'declined', declined_at = now() WHERE id = $1`,
    [resp.id],
  );
  if (resp.confirmation_token_id) {
    await invalidateConfirmationToken(client, resp.confirmation_token_id);
  }
  await audit(client, {
    actorId,
    entityType: "application_response",
    entityId: resp.id,
    action: "declined",
    source: via,
    before: { status: resp.status },
    after: { status: "declined" },
  });

  // Remove roles this confirmed response owned before deriving current ticket
  // entitlement from every role that remains.
  let voidedPassIds: number[] = [];
  if (resp.status === "confirmed") {
    await revokeApplicationGrantedRoles(client, resp.user_id, resp.application_id, actorId);
    voidedPassIds = (await reconcileTicketAccess(client, resp.user_id)).voidedPassIds;
  }
  return { status: "declined", alreadyDeclined: false, voidedPassIds };
}

/**
 * Email-link confirm (H15). The token identifies the applicant for this one
 * action; it never becomes a session. On success the caller also gets a scoped
 * wallet credential (issue #369) so the landing page can offer "add to Apple /
 * Google Wallet" to someone who is not — and need not become — signed in.
 */
export async function confirmByToken(token: string): Promise<EmailConfirmResult> {
  return withTransaction(async (client) => {
    await lockRoleGraph(client);
    const resp = await lockVerifiedResponseByToken(client, token, "confirmation");
    if (resp.status !== "accepted") {
      throw new ConflictError("This confirmation link has already been used", {
        code: "confirmation_used",
      });
    }
    const result = await doConfirm(client, resp, "email_link", resp.user_id);
    const grant = result.ticketToken
      ? await issueWalletAccessToken(client, resp.user_id, "ticket")
      : null;
    const { rows: userRows } = await client.query(
      `SELECT name, surname, email FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
      [resp.user_id],
    );
    return {
      ...result,
      // Preserve the old response type for clients already in production.
      // An empty value means this confirmed response did not produce a role
      // with event access, so there is no scoped Wallet credential to use.
      walletToken: grant?.token ?? "",
      walletTokenExpiresAt: grant?.expiresAt.toISOString() ?? "",
      holderName: [userRows[0]?.name, userRows[0]?.surname].filter(Boolean).join(" "),
      maskedEmail: maskEmail((userRows[0]?.email as string | undefined) ?? ""),
    };
  });
}

export async function confirmByResponseId(
  responseId: number,
  via: ConfirmVia,
  actorId: number | null,
  requireOwner?: number,
): Promise<ConfirmResult> {
  return withTransaction(async (client) => {
    await lockRoleGraph(client);
    // Lock the caller's verification state before the response, matching
    // submitResponse's user→response order. The ownership check below still
    // prevents acting on somebody else's response.
    if (requireOwner != null) {
      await assertVerifiedPrimaryEmail(client, requireOwner, { forUpdate: true });
    }
    const resp = await lockResponse(client, responseId, actorId ?? undefined);
    if (requireOwner != null && resp.user_id !== requireOwner) {
      throw new ForbiddenError("Not your application");
    }
    return doConfirm(client, resp, via, actorId);
  });
}

export async function declineByToken(token: string): Promise<{
  status: string;
  alreadyDeclined: boolean;
}> {
  const result = await withTransaction(async (client) => {
    await lockRoleGraph(client);
    const resp = await lockVerifiedResponseByToken(client, token, "decline");
    if (resp.status !== "accepted") {
      throw new ConflictError("This confirmation link has already been used", {
        code: "confirmation_used",
      });
    }
    const decline = await doDecline(client, resp, "email_link", resp.user_id);
    return { ...decline, userId: resp.user_id };
  });
  await pushTicketVoid(result.userId, result.voidedPassIds);
  return { status: result.status, alreadyDeclined: result.alreadyDeclined };
}

export async function declineByResponseId(
  responseId: number,
  via: ConfirmVia,
  actorId: number | null,
  requireOwner?: number,
): Promise<{ status: string; alreadyDeclined: boolean }> {
  const result = await withTransaction(async (client) => {
    await lockRoleGraph(client);
    if (requireOwner != null) {
      await assertVerifiedPrimaryEmail(client, requireOwner, { forUpdate: true });
    }
    const resp = await lockResponse(client, responseId, actorId ?? undefined);
    if (requireOwner != null && resp.user_id !== requireOwner) {
      throw new ForbiddenError("Not your application");
    }
    const decline = await doDecline(client, resp, via, actorId);
    return { ...decline, userId: resp.user_id };
  });
  await pushTicketVoid(result.userId, result.voidedPassIds);
  return { status: result.status, alreadyDeclined: result.alreadyDeclined };
}
