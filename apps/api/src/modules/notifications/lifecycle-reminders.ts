import { config } from "../../config.js";
import { type Queryable, withTransaction } from "../../db/pool.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { createVerificationReminderLink } from "../identity/auth.js";
import { enqueueAuthEmail } from "../identity/outbox.js";
import { issueUnverifiedRemovalLink, webUrl } from "../identity/unverified-removal.js";

/**
 * Escalating reminders for people who stalled (H1, H12, H52). Two independent
 * series, each at most three emails, five days apart:
 *
 *  - Unverified account: created five days ago and still unverified. Every
 *    email carries a fresh verification link and the "I didn't create this
 *    account" removal link (unverified-removal.ts).
 *  - Draft application: a verified account whose draft was last edited five
 *    days ago and still is not submitted, while it can still be submitted.
 *
 * An unverified account only ever receives the first series: its drafts stay
 * silent until the address is verified. The third email of each series says
 * it is the last. Rows are claimed with FOR UPDATE SKIP LOCKED and their
 * counter advances in the same transaction that queues the email, so
 * overlapping ticks never double-send and a failed tick sends nothing.
 */

const QUEUE_NAME = "lifecycle-reminders";

export const REMINDER_INTERVAL_DAYS = 5;
export const MAX_REMINDERS = 3;
const BATCH_SIZE = 200;
/** A reminder is read days after it is sent, unlike the one-hour sign-up link. */
const VERIFICATION_LINK_TTL_SECONDS = 3 * 24 * 3600;

const LEVELS = ["1", "2", "3"] as const;

function levelOf(alreadySent: number): (typeof LEVELS)[number] {
  return LEVELS[Math.min(alreadySent, MAX_REMINDERS - 1)] as (typeof LEVELS)[number];
}

export async function remindUnverifiedAccounts(db: Queryable): Promise<number> {
  const { rows } = await db.query<{
    id: number;
    email: string;
    name: string | null;
    language: string;
    sent: number;
  }>(
    `SELECT u.id, u.email, u.name, u.language, u.verification_reminders_sent AS sent
       FROM users u
      WHERE NOT u.email_verified
        AND u.account_state = 'active'
        AND u.anonymized_at IS NULL
        AND NOT u.is_test_account
        AND u.verification_reminders_sent < $1
        AND COALESCE(u.verification_reminded_at, u.created_at)
              <= now() - make_interval(days => $2)
      ORDER BY u.id
      LIMIT $3
        FOR UPDATE OF u SKIP LOCKED`,
    [MAX_REMINDERS, REMINDER_INTERVAL_DAYS, BATCH_SIZE],
  );
  for (const user of rows) {
    await enqueueAuthEmail(
      db,
      user.id,
      `auth.verifyReminder${levelOf(user.sent)}`,
      {
        name: user.name,
        verifyUrl: await createVerificationReminderLink(user.email, VERIFICATION_LINK_TTL_SECONDS),
        deleteUrl: await issueUnverifiedRemovalLink(db, user),
      },
      { recipient: user.email, language: user.language },
    );
    await db.query(
      `UPDATE users
          SET verification_reminders_sent = verification_reminders_sent + 1,
              verification_reminded_at = now()
        WHERE id = $1`,
      [user.id],
    );
  }
  return rows.length;
}

export async function remindDraftApplications(db: Queryable): Promise<number> {
  const { rows } = await db.query<{
    id: number;
    user_id: number;
    application_id: number;
    application_name: string;
    name: string | null;
    sent: number;
  }>(
    `SELECT r.id, r.user_id, r.application_id, a.name AS application_name, u.name, r.draft_reminders_sent AS sent
       FROM application_responses r
       JOIN applications a ON a.id = r.application_id
       JOIN users u ON u.id = r.user_id
      WHERE r.status = 'draft'
        AND r.draft_reminders_sent < $1
        AND COALESCE(r.draft_reminded_at, r.updated_at) <= now() - make_interval(days => $2)
        AND u.email_verified
        AND u.account_state = 'active'
        AND u.anonymized_at IS NULL
        AND NOT u.is_test_account
        -- Nothing to nag about once it can no longer be submitted.
        AND ((a.open_at IS NULL OR a.open_at <= now())
             AND (a.close_at IS NULL OR a.close_at > now())
             OR r.allow_resubmit_after_close)
      ORDER BY r.id
      LIMIT $3
        FOR UPDATE OF r SKIP LOCKED`,
    [MAX_REMINDERS, REMINDER_INTERVAL_DAYS, BATCH_SIZE],
  );
  for (const draft of rows) {
    await db.query(
      `INSERT INTO notification_outbox (user_id, category, channel, payload)
       VALUES ($1, 'application', 'email', $2::jsonb)`,
      [
        draft.user_id,
        JSON.stringify({
          template: `application.draftReminder${levelOf(draft.sent)}`,
          vars: {
            name: draft.name,
            applicationName: draft.application_name,
            applicationUrl: webUrl(`/my-applications/${draft.application_id}`),
          },
        }),
      ],
    );
    await db.query(
      `UPDATE application_responses
          SET draft_reminders_sent = draft_reminders_sent + 1, draft_reminded_at = now()
        WHERE id = $1`,
      [draft.id],
    );
  }
  return rows.length;
}

export async function runLifecycleRemindersOnce(): Promise<{
  unverified: number;
  drafts: number;
}> {
  return withTransaction(async (client) => ({
    unverified: await remindUnverifiedAccounts(client),
    drafts: await remindDraftApplications(client),
  }));
}

registerWorker(QUEUE_NAME, async () => {
  await runLifecycleRemindersOnce();
});

/** Schedules the recurring sweep. Skipped in tests, which call runLifecycleRemindersOnce(). */
export async function scheduleLifecycleReminders(): Promise<void> {
  if (config.isTest) return;
  await getQueue(QUEUE_NAME).add(
    QUEUE_NAME,
    {},
    {
      repeat: { every: 10 * 60_000 },
      jobId: QUEUE_NAME,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
