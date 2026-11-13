import { randomBytes } from "node:crypto";

import type pg from "pg";

import { config } from "../../config.js";

import { audit } from "../../lib/audit.js";

import { NotFoundError } from "../../lib/errors.js";

import { translateEmail } from "../../lib/i18n.js";

import { getEventName, getEventTimezone } from "../event/service.js";

import { notify } from "../notifications/service.js";

import { type EmailPayload, normalizeLanguage } from "../notifications/templates.js";

import type { ApplicationRow, ResponseRow } from "./types.js";

// ── tokens / tickets / emails ─────────────────────────────────────────────────

/**
 * Issue a fresh spot_confirmation token (email_verification_tokens) whose
 * expiry mirrors decision_sent_at + confirmation_window_hours, supersede any
 * prior one, and point the response at it.
 */
export async function issueConfirmationToken(
  client: pg.PoolClient,
  response: { id: number; user_id: number },
  app: ApplicationRow,
  email: string,
): Promise<string> {
  await client.query(
    `UPDATE email_verification_tokens SET used_at = now()
     WHERE user_id = $1 AND type = 'spot_confirmation' AND used_at IS NULL`,
    [response.user_id],
  );
  const token = randomBytes(32).toString("base64url");
  const { rows } = await client.query(
    `INSERT INTO email_verification_tokens (token, type, email, user_id, expires_at)
     VALUES ($1, 'spot_confirmation', $2, $3, now() + make_interval(hours => $4))
     RETURNING id`,
    [token, email, response.user_id, app.confirmation_window_hours],
  );
  await client.query(`UPDATE application_responses SET confirmation_token_id = $1 WHERE id = $2`, [
    rows[0].id,
    response.id,
  ]);
  return token;
}

interface UserComms {
  email: string;
  name: string | null;
  language: string;
}

export async function loadUserComms(client: pg.PoolClient, userId: number): Promise<UserComms> {
  const { rows } = await client.query(
    `SELECT email, name, language FROM users
      WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
    [userId],
  );
  if (!rows[0]) throw new NotFoundError("User not found");
  return rows[0];
}

/** Send one already-decided, still-unsent response (H14). Returns the confirmation token if accepted. */
export async function sendOne(
  client: pg.PoolClient,
  actorId: number,
  resp: ResponseRow,
  app: ApplicationRow,
): Promise<string | null> {
  const user = await loadUserComms(client, resp.user_id);
  let token: string | null = null;
  const isAccepted = resp.status === "accepted_internal";
  const sentStatus = isAccepted ? "accepted" : "rejected";
  if (isAccepted) {
    token = await issueConfirmationToken(client, resp, app, user.email);
  }
  await client.query(
    `UPDATE application_responses SET status = $2, decision_sent_at = now() WHERE id = $1`,
    [resp.id, sentStatus],
  );
  await enqueueDecisionEmailRow(
    client,
    resp.user_id,
    user,
    app,
    sentStatus as "accepted" | "rejected",
    token,
    resp.rejection_reason,
  );
  await audit(client, {
    actorId,
    entityType: "application_response",
    entityId: resp.id,
    action: "decision_sent",
    after: { decision: sentStatus },
  });
  return token;
}

export async function enqueueDecisionEmailRow(
  client: pg.PoolClient,
  userId: number,
  user: UserComms,
  app: ApplicationRow,
  decision: "accepted" | "rejected",
  confirmToken: string | null,
  rejectionReason: string | null = null,
): Promise<void> {
  const payload = await decisionNotificationPayload(
    client,
    user,
    app,
    decision,
    confirmToken,
    rejectionReason,
  );
  await client.query(
    `INSERT INTO notification_outbox (user_id, category, channel, payload)
     VALUES ($1, 'application', 'email', $2::jsonb)`,
    [userId, JSON.stringify(payload)],
  );
}

/**
 * Re-accept is a new applicant-facing decision, not only an internal state
 * change. Use the generic H51 dispatcher so the applicant gets the channels
 * enabled in their preferences; the email payload still carries the fresh
 * confirmation links (H14, H15).
 */
export async function enqueueDecisionNotificationRows(
  client: pg.PoolClient,
  userId: number,
  user: UserComms,
  app: ApplicationRow,
  decision: "accepted" | "rejected",
  confirmToken: string | null,
): Promise<void> {
  await notify(client, {
    userId,
    category: "application",
    channels: ["in_app", "email", "push"],
    payload: await decisionNotificationPayload(client, user, app, decision, confirmToken),
  });
}

async function decisionNotificationPayload(
  client: pg.PoolClient,
  user: UserComms,
  app: ApplicationRow,
  decision: "accepted" | "rejected",
  confirmToken: string | null,
  rejectionReason: string | null = null,
): Promise<EmailPayload> {
  const language = normalizeLanguage(user.language);
  const eventName = await getEventName(client);
  let decisionDetails = "";
  let confirmationExpiresAt: string | undefined;
  let confirmationTimeZone: string | undefined;
  if (decision === "accepted" && confirmToken) {
    const { rows } = await client.query<{ expires_at: Date }>(
      "SELECT expires_at FROM email_verification_tokens WHERE token = $1 AND type = 'spot_confirmation'",
      [confirmToken],
    );
    if (!rows[0]) throw new NotFoundError("Confirmation token not found");
    confirmationExpiresAt = rows[0].expires_at.toISOString();
    confirmationTimeZone = await getEventTimezone(client);
    const deadline = new Intl.DateTimeFormat(language, {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: confirmationTimeZone,
      timeZoneName: "short",
    }).format(rows[0].expires_at);
    decisionDetails = translateEmail("mail.application.decision.confirmationDetails", language, {
      confirmUrl: `${config.WEB_URL}/applications/confirm#token=${confirmToken}`,
      declineUrl: `${config.WEB_URL}/applications/decline#token=${confirmToken}`,
      deadlineNotice: translateEmail("mail.application.decision.confirmationDeadline", language, {
        deadline,
      }),
    });
  }
  const rejectionDetails =
    decision === "rejected" && rejectionReason
      ? translateEmail("mail.application.decision.rejectionDetails", language, {
          reason: rejectionReason,
        })
      : "";
  return {
    template: "application.decision",
    recipient: user.email,
    language: user.language,
    vars: {
      name: user.name ?? "",
      applicationName: app.name,
      eventName,
      decision,
      decisionDetails,
      rejectionDetails,
      confirmationExpiresAt,
      confirmationTimeZone,
    },
  };
}
