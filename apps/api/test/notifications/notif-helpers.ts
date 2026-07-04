import { pool } from "../../src/db/pool.js";
import { truncateAll } from "../helpers.js";

/** Suite-local helpers for WS-F tests (H50-H53). */

/**
 * Per-test reset: truncate the DB and flush this suite's OWN Valkey logical db
 * (isolated to index 10 by test/notifications/env.ts, so the flush can't wipe
 * a sibling suite's cache and a sibling's cache can't poison ours).
 */
export async function resetNotificationsState(): Promise<void> {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
}

/** Raw INSERT into notification_outbox — the "siblings insert directly" compatibility path. */
export async function enqueueOutbox(
  userId: number,
  channel: string,
  payload: unknown,
  category = "test",
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO notification_outbox (user_id, category, channel, payload)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, category, channel, JSON.stringify(payload)],
  );
  return rows[0].id;
}

export async function getOutboxRow(id: number): Promise<{
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: Date;
  sent_at: Date | null;
  read_at: Date | null;
}> {
  const { rows } = await pool.query(`SELECT * FROM notification_outbox WHERE id = $1`, [id]);
  return rows[0];
}

export async function setUserLanguage(userId: number, language: string): Promise<void> {
  await pool.query(`UPDATE users SET language = $2 WHERE id = $1`, [userId, language]);
}

/** Marks a queued row as due immediately so a drain picks it up without waiting out the backoff. */
export async function makeDueNow(id: number): Promise<void> {
  await pool.query(`UPDATE notification_outbox SET next_attempt_at = now() WHERE id = $1`, [id]);
}
