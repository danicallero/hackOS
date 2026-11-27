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
 * H11/H12 waitlist: staff switch a form into waitlist mode by hand
 * (`waitlist_enabled`). A closed window still closes the form completely; the
 * waitlist never reopens it.
 */
export function isWaitlistActive(app: Pick<ApplicationRow, "waitlist_enabled">): boolean {
  return app.waitlist_enabled;
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
