import { withTransaction } from "../../db/pool.js";

import { audit } from "../../lib/audit.js";

import { isScopedEditionClosed } from "../../lib/edition.js";

import { invalidateConfirmationToken } from "./internal.js";

import type { ResponseRow } from "./types.js";

// ── expirer (plan/07 §5.2) ────────────────────────────────────────────────────

/**
 * Mark accepted responses whose confirmation window has elapsed as expired,
 * one audit row each. Directly invokable so tests don't wait on BullMQ repeat
 * timing.
 */
export async function expireDueConfirmations(): Promise<{ expired: number }> {
  return withTransaction(async (client) => {
    // Workers ignore a closed edition and only touch the current one.
    if (await isScopedEditionClosed(client)) return { expired: 0 };
    // Resolve candidates without locking responses, then acquire each owner
    // first. Removal uses user -> application_response ordering; expiring a
    // response must follow that order too or it can race the scrub.
    const { rows: candidates } = await client.query<{ id: number; user_id: number }>(
      `SELECT r.id, r.user_id FROM application_responses r
       JOIN applications a ON a.id = r.application_id
       JOIN users u ON u.id = r.user_id
       WHERE r.status = 'accepted'
         AND a.event_key = current_edition()
         AND r.decision_sent_at IS NOT NULL
         AND r.decision_sent_at + make_interval(hours => a.confirmation_window_hours) < now()
         AND u.account_state = 'active' AND u.anonymized_at IS NULL
         AND u.is_test_account = false
       ORDER BY u.id, r.id`,
    );
    const rows: ResponseRow[] = [];
    for (const candidate of candidates) {
      const userLock = await client.query(
        `SELECT id FROM users
          WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
          FOR UPDATE SKIP LOCKED`,
        [candidate.user_id],
      );
      if (!userLock.rows[0]) continue;
      const responseLock = await client.query(
        `SELECT r.* FROM application_responses r
          WHERE r.id = $1 AND r.status = 'accepted'
            AND r.decision_sent_at IS NOT NULL
          FOR UPDATE`,
        [candidate.id],
      );
      const resp = responseLock.rows[0] as ResponseRow | undefined;
      if (!resp) continue;
      const expiry = await client.query(
        `SELECT r.decision_sent_at + make_interval(hours => a.confirmation_window_hours) AS expires_at
           FROM application_responses r JOIN applications a ON a.id = r.application_id
          WHERE r.id = $1`,
        [resp.id],
      );
      if (!expiry.rows[0] || new Date(expiry.rows[0].expires_at) >= new Date()) continue;
      await client.query(`UPDATE application_responses SET status = 'expired' WHERE id = $1`, [
        resp.id,
      ]);
      if (resp.confirmation_token_id) {
        await invalidateConfirmationToken(client, resp.confirmation_token_id);
      }
      await audit(client, {
        actorId: null,
        entityType: "application_response",
        entityId: resp.id,
        action: "expired",
        source: "system",
        before: { status: "accepted" },
        after: { status: "expired" },
      });
      rows.push(resp);
    }
    return { expired: rows.length };
  });
}
