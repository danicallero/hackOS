import { config } from "../../config.js";
import { withTransaction } from "../../db/pool.js";
import { isScopedEditionClosed } from "../../lib/edition.js";
import { translateEmail } from "../../lib/i18n.js";
import { getEventName, getEventTimezone } from "../event/service.js";
import { normalizeLanguage } from "../notifications/templates.js";
import { formatConfirmationDeadline } from "./decision-delivery.js";

/**
 * Spot-confirmation reminders (H15). An accepted applicant who has not
 * confirmed gets up to three emails, each when the time left reaches a
 * threshold: half the confirmation window, 48 hours, and 24 hours (the last
 * chance). Thresholds that do not fit a short window are dropped: one at or
 * above half the window, or within 12 hours of the previous one, would arrive
 * right after the decision or the reminder before it.
 *
 * If the sweep falls behind (worker down), only the latest threshold reached
 * is mailed. Rows are claimed FOR UPDATE SKIP LOCKED and the level advances
 * in the transaction that queues the email, so overlapping ticks never
 * double-send.
 */

const TWO_DAYS_HOURS = 48;
const LAST_CHANCE_HOURS = 24;
const MIN_GAP_HOURS = 12;
const BATCH_SIZE = 200;

/** Hours-before-deadline thresholds for a window, in the order they are reached. */
export function reminderThresholds(windowHours: number): number[] {
  const half = windowHours / 2;
  const kept = [half];
  for (const t of [TWO_DAYS_HOURS, LAST_CHANCE_HOURS]) {
    if (t <= (kept.at(-1) as number) - MIN_GAP_HOURS) kept.push(t);
  }
  return kept;
}

interface Candidate {
  id: number;
  user_id: number;
  application_id: number;
  application_name: string;
  window_hours: number;
  decision_sent_at: Date;
  expires_at: Date;
  level: number;
  basis: Date | null;
  token: string | null;
  email: string;
  name: string | null;
  language: string;
}

export async function sendDueConfirmationReminders(): Promise<{ sent: number }> {
  return withTransaction(async (client) => {
    if (await isScopedEditionClosed(client)) return { sent: 0 };
    const { rows } = await client.query<Candidate>(
      `SELECT r.id, r.user_id, r.application_id, a.name AS application_name,
              a.confirmation_window_hours AS window_hours, r.decision_sent_at,
              r.decision_sent_at + make_interval(hours => a.confirmation_window_hours) AS expires_at,
              r.confirmation_reminder_level AS level, r.confirmation_reminder_basis AS basis,
              t.token, u.email, u.name, u.language
         FROM application_responses r
         JOIN applications a ON a.id = r.application_id
         JOIN users u ON u.id = r.user_id
         LEFT JOIN email_verification_tokens t
           ON t.id = r.confirmation_token_id AND t.type = 'spot_confirmation'
          AND t.used_at IS NULL AND t.expires_at > now()
        WHERE r.status = 'accepted'
          AND a.event_key = current_edition()
          AND r.decision_sent_at IS NOT NULL
          AND r.decision_sent_at + make_interval(hours => a.confirmation_window_hours) > now()
          -- Nothing is due before half the window has passed.
          AND r.decision_sent_at + make_interval(hours => a.confirmation_window_hours) / 2 <= now()
          AND u.account_state = 'active' AND u.anonymized_at IS NULL
          AND NOT u.is_test_account
        ORDER BY r.id
        LIMIT $1
          FOR UPDATE OF r SKIP LOCKED`,
      [BATCH_SIZE],
    );
    if (rows.length === 0) return { sent: 0 };
    const eventName = await getEventName(client);
    const timeZone = await getEventTimezone(client);
    let sent = 0;
    for (const row of rows) {
      const thresholds = reminderThresholds(row.window_hours);
      const hoursLeft = (row.expires_at.getTime() - Date.now()) / 3_600_000;
      const reached = thresholds.filter((t) => hoursLeft <= t).length;
      const alreadySent =
        row.basis && row.basis.getTime() === row.decision_sent_at.getTime() ? row.level : 0;
      if (reached <= alreadySent) continue;

      const language = normalizeLanguage(row.language);
      // The last-chance copy promises under 24 hours left.
      const lastChance = (thresholds[reached - 1] as number) <= LAST_CHANCE_HOURS;
      const deadline = formatConfirmationDeadline(row.expires_at, language, timeZone);
      // Without a live token (legacy row, staff override) the web page still confirms.
      const links = row.token
        ? {
            confirmUrl: `${config.WEB_URL}/applications/confirm#token=${row.token}`,
            declineUrl: `${config.WEB_URL}/applications/decline#token=${row.token}`,
          }
        : {
            confirmUrl: `${config.WEB_URL}/my-applications/${row.application_id}`,
            declineUrl: `${config.WEB_URL}/my-applications/${row.application_id}`,
          };
      await client.query(
        `INSERT INTO notification_outbox (user_id, category, channel, payload)
         VALUES ($1, 'application', 'email', $2::jsonb)`,
        [
          row.user_id,
          JSON.stringify({
            template: lastChance
              ? "application.confirmationLastChance"
              : "application.confirmationReminder",
            recipient: row.email,
            language: row.language,
            vars: {
              name: row.name ?? "",
              applicationName: row.application_name,
              eventName,
              confirmationDetails: translateEmail(
                "mail.application.decision.confirmationDetails",
                language,
                {
                  ...links,
                  deadlineNotice: translateEmail(
                    "mail.application.decision.confirmationDeadline",
                    language,
                    { deadline },
                  ),
                },
              ),
            },
          }),
        ],
      );
      await client.query(
        `UPDATE application_responses
            SET confirmation_reminder_level = $2, confirmation_reminder_basis = $3
          WHERE id = $1`,
        [row.id, reached, row.decision_sent_at],
      );
      sent += 1;
    }
    return { sent };
  });
}
