import type pg from "pg";

import { withTransaction } from "../../db/pool.js";

import { audit } from "../../lib/audit.js";
import { assertVerifiedPrimaryEmail } from "../../lib/email-verification.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { getEventName } from "../event/service.js";
import { webUrl } from "../identity/unverified-removal.js";
import { notify } from "../notifications/service.js";

import { loadUserComms } from "./decision-delivery.js";

import { requireApplication } from "./forms.js";

import { invalidateConfirmationToken, lockResponse } from "./internal.js";

import type { ApplicationRow, ResponseRow } from "./types.js";

/**
 * H11/H12 waitlist. A form is "in waitlist mode" when staff enabled it and
 * the number of applications received (every non-draft response, so staff
 * moving people around never reopens the form) reached `waitlist_after`, or
 * right away when no threshold is set. A closed window still closes the form
 * completely; the waitlist never reopens it.
 */
const RECEIVED_SQL = (alias: string) => `(SELECT count(*)::int
    FROM application_responses wr
    JOIN users wu ON wu.id = wr.user_id AND wu.is_test_account = false
   WHERE wr.application_id = ${alias}.id AND wr.status <> 'draft')`;

/** Selectable columns for staff/public form reads. `alias` is the applications alias. */
export const waitlistColumnsSql = (alias: string) =>
  `${alias}.waitlist_enabled, ${alias}.waitlist_after,
   ${RECEIVED_SQL(alias)} AS applications_received,
   (${alias}.waitlist_enabled AND (${alias}.waitlist_after IS NULL
     OR ${RECEIVED_SQL(alias)} >= ${alias}.waitlist_after)) AS waitlist_active`;

export async function isWaitlistActive(
  client: pg.PoolClient,
  app: Pick<ApplicationRow, "id" | "waitlist_enabled" | "waitlist_after">,
): Promise<boolean> {
  if (!app.waitlist_enabled) return false;
  if (app.waitlist_after == null) return true;
  const { rows } = await client.query(
    `SELECT ${RECEIVED_SQL("a")} AS n FROM applications a WHERE a.id = $1`,
    [app.id],
  );
  return Number(rows[0]?.n ?? 0) >= app.waitlist_after;
}

/**
 * H13/H14: staff tell a reviewed applicant the places are gone and they are on
 * the waitlist. Takes effect immediately and notifies the applicant; unlike
 * accept/reject there is no unsent stage, because it only informs.
 */
export async function moveToWaitlist(actorId: number, responseId: number): Promise<ResponseRow> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId, actorId);
    if (
      resp.status !== "review" &&
      resp.status !== "accepted_internal" &&
      resp.status !== "rejected_internal"
    ) {
      throw new ConflictError(
        "Only responses that have not been communicated can join the waitlist",
        {
          status: resp.status,
        },
      );
    }
    const app = await requireApplication(client, resp.application_id);
    const user = await loadUserComms(client, resp.user_id);
    const { rows } = await client.query(
      `UPDATE application_responses
          SET status = 'waitlist', decision_sent_at = now(), return_on_send = false,
              rejection_reason = NULL
        WHERE id = $1 RETURNING *`,
      [responseId],
    );
    await notify(client, {
      userId: resp.user_id,
      category: "application",
      channels: ["in_app", "email", "push"],
      payload: {
        template: "application.waitlisted",
        recipient: user.email,
        language: user.language,
        vars: {
          name: user.name ?? "",
          applicationName: app.name,
          eventName: await getEventName(client),
          applicationUrl: webUrl(`/my-applications/${app.id}`),
        },
      },
    });
    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: responseId,
      action: "moved_to_waitlist",
      before: { status: resp.status },
      after: { status: "waitlist" },
    });
    return rows[0] as ResponseRow;
  });
}

/**
 * H12: an applicant on the waitlist (joined directly or moved there by staff)
 * gives up the chance of a place. Same terminal state as declining an accepted
 * spot, so staff can still re-accept them; the audit action tells them apart.
 */
export async function withdrawFromWaitlist(
  userId: number,
  applicationId: number,
): Promise<{ status: string }> {
  return withTransaction(async (client) => {
    await assertVerifiedPrimaryEmail(client, userId, { forUpdate: true });
    const { rows } = await client.query(
      `SELECT r.id FROM application_responses r
         JOIN applications a ON a.id = r.application_id
        WHERE r.user_id = $1 AND r.application_id = $2 AND a.event_key = current_edition()`,
      [userId, applicationId],
    );
    if (!rows[0]) throw new NotFoundError("No response yet for this application");
    const resp = await lockResponse(client, Number(rows[0].id));
    if (resp.user_id !== userId) throw new ForbiddenError("Not your application");
    if (resp.status !== "waitlist") {
      throw new ConflictError("Only a waitlisted application can be withdrawn here", {
        status: resp.status,
      });
    }
    await client.query(
      `UPDATE application_responses SET status = 'declined', declined_at = now() WHERE id = $1`,
      [resp.id],
    );
    if (resp.confirmation_token_id) {
      await invalidateConfirmationToken(client, resp.confirmation_token_id);
    }
    await audit(client, {
      actorId: userId,
      entityType: "application_response",
      entityId: resp.id,
      action: "waitlist_withdrawn",
      source: "web",
      before: { status: "waitlist" },
      after: { status: "declined" },
    });
    return { status: "declined" };
  });
}
