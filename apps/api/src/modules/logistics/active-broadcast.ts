import { SSE_TOPICS, type SseEnvelope } from "@hackos/shared/events";
import { withTransaction } from "../../db/pool.js";
import { broadcast } from "../../lib/sse.js";

/** Synthetic logistics events use a separate authenticated topic. The regular
 * logistics stream is therefore safe for real-event operators even when a
 * fixture scan is running in the same deployment. */
export const SYNTHETIC_LOGISTICS_TOPIC = `${SSE_TOPICS.LOGISTICS}:fixture`;

export function logisticsTopicForFixture(isSynthetic: boolean): string {
  return isSynthetic ? SYNTHETIC_LOGISTICS_TOPIC : SSE_TOPICS.LOGISTICS;
}

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
    const { rows } = await client.query<{ id: number; is_test_account: boolean }>(
      `SELECT id, is_test_account
         FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR SHARE`,
      [userId],
    );
    if (!rows[0]) return null;
    const scopedTopic =
      topic === SSE_TOPICS.LOGISTICS ? logisticsTopicForFixture(rows[0].is_test_account) : topic;
    return broadcast(scopedTopic, type, data);
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
    const { rows } = await client.query<{ id: number; is_test_account: boolean }>(
      `SELECT id, is_test_account
         FROM users
        WHERE id = ANY($1::int[]) AND account_state = 'active' AND anonymized_at IS NULL
        ORDER BY id
        FOR SHARE`,
      [ids],
    );
    if (rows.length === 0) return null;
    if (topic !== SSE_TOPICS.LOGISTICS)
      return broadcast(topic, type, data(rows.map((row) => row.id)));

    // A closer can contain both real and synthetic accounts. Split the
    // payload and topic by marker so neither stream receives the other's ids.
    const byFixture = new Map<boolean, number[]>();
    for (const row of rows) {
      const idsForMarker = byFixture.get(row.is_test_account) ?? [];
      idsForMarker.push(row.id);
      byFixture.set(row.is_test_account, idsForMarker);
    }
    let envelope: SseEnvelope<T> | null = null;
    for (const [isSynthetic, scopedIds] of byFixture) {
      const published = await broadcast(
        logisticsTopicForFixture(isSynthetic),
        type,
        data(scopedIds),
      );
      envelope ??= published;
    }
    return envelope;
  });
}
