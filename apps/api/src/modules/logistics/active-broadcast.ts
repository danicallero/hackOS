import type { SseEnvelope } from "@hackos/shared/events";
import { withTransaction } from "../../db/pool.js";
import { broadcast } from "../../lib/sse.js";

/**
 * Publish an identity-bearing logistics event while holding a share lock on
 * the participant row. Account removal takes the same row lock before moving
 * the account to removal_pending, so either the event is published first or
 * the account is removed first and the event is suppressed. This closes the
 * post-commit/pre-broadcast window without adding an event-outbox subsystem
 * (H54).
 */
export async function broadcastForActiveUser<T>(
  userId: number,
  topic: string,
  type: string,
  data: T,
): Promise<SseEnvelope<T> | null> {
  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `SELECT id
         FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR SHARE`,
      [userId],
    );
    if (!rowCount) return null;
    return broadcast(topic, type, data);
  });
}

/** Same guard for an aggregated event containing several participant IDs. */
export async function broadcastForActiveUsers<T>(
  userIds: readonly number[],
  topic: string,
  type: string,
  data: (activeUserIds: number[]) => T,
): Promise<SseEnvelope<T> | null> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return null;
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number }>(
      `SELECT id
         FROM users
        WHERE id = ANY($1::int[]) AND account_state = 'active' AND anonymized_at IS NULL
        ORDER BY id
        FOR SHARE`,
      [ids],
    );
    if (rows.length === 0) return null;
    return broadcast(topic, type, data(rows.map((row) => row.id)));
  });
}
