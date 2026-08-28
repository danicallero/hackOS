import { SSE_TOPICS, type SseEnvelope } from "@hackos/shared/events";
import type { Queryable } from "../../db/pool.js";
import { broadcast } from "../../lib/sse.js";

/** Queue resources whose marker determines the operator SSE topic. */
export type QueueBroadcastResource = "challenge" | "entry" | "queueGroup" | "room";

export function queueTopicForFixture(isSynthetic: boolean): string {
  return isSynthetic ? SSE_TOPICS.QUEUE_FIXTURE : SSE_TOPICS.QUEUE;
}

/**
 * Resolve the review-fixture marker from the same graph that produced the
 * queue event. Mixed or missing graphs fail closed: an identity-bearing
 * payload must never fall back to the real operator topic.
 */
export async function queueFixtureMarker(
  db: Queryable,
  resource: QueueBroadcastResource,
  resourceId: number,
): Promise<boolean | null> {
  if (resource === "challenge") {
    const { rows } = await db.query<{ is_test_account: boolean }>(
      `SELECT is_test_account FROM challenges WHERE id = $1`,
      [resourceId],
    );
    return rows[0] ? rows[0].is_test_account === true : null;
  }

  if (resource === "entry") {
    const { rows } = await db.query<{
      challenge_is_test_account: boolean;
      repo_is_test_account: boolean;
    }>(
      `SELECT c.is_test_account AS challenge_is_test_account,
              r.is_test_account AS repo_is_test_account
         FROM queue_entries qe
         JOIN challenges c ON c.id = qe.challenge_id
         JOIN repos r ON r.id = qe.repo_id
        WHERE qe.id = $1`,
      [resourceId],
    );
    const row = rows[0];
    if (!row || row.challenge_is_test_account !== row.repo_is_test_account) return null;
    return row.challenge_is_test_account === true;
  }

  if (resource === "queueGroup") {
    const { rows } = await db.query<{ has_synthetic: boolean; has_real: boolean }>(
      `SELECT COALESCE(bool_or(c.is_test_account IS TRUE), false) AS has_synthetic,
              COALESCE(bool_or(c.is_test_account IS NOT TRUE), false) AS has_real
         FROM queue_group_challenges qgc
         JOIN challenges c ON c.id = qgc.challenge_id
        WHERE qgc.queue_group_id = $1`,
      [resourceId],
    );
    const row = rows[0];
    if (!row || (!row.has_synthetic && !row.has_real) || (row.has_synthetic && row.has_real)) {
      return null;
    }
    return row.has_synthetic;
  }

  const { rows } = await db.query<{
    assigned: boolean;
    has_synthetic: boolean;
    has_real: boolean;
  }>(
    `SELECT EXISTS (
              SELECT 1 FROM room_queue_groups assigned WHERE assigned.room_id = $1
            ) AS assigned,
            COALESCE(bool_or(c.is_test_account IS TRUE), false) AS has_synthetic,
            COALESCE(bool_or(c.is_test_account IS NOT TRUE), false) AS has_real
       FROM room_queue_groups rqg
       JOIN queue_group_challenges qgc ON qgc.queue_group_id = rqg.queue_group_id
       JOIN challenges c ON c.id = qgc.challenge_id
      WHERE rqg.room_id = $1`,
    [resourceId],
  );
  const row = rows[0];
  // An unassigned room is part of the real operator surface, preserving the
  // existing pause/resume behavior for rooms with no queue yet.
  if (!row?.assigned) return false;
  if ((!row.has_synthetic && !row.has_real) || (row.has_synthetic && row.has_real)) return null;
  return row.has_synthetic;
}

/**
 * Publish one queue event on the marker-scoped operator topic. Marker lookup
 * is deliberately best-effort like `broadcast`: a lookup failure suppresses
 * the event rather than risking a fixture payload on the real stream.
 */
export async function broadcastQueueEvent<T>(
  db: Queryable,
  resource: QueueBroadcastResource,
  resourceId: number,
  type: string,
  data: T,
): Promise<SseEnvelope<T> | null> {
  let marker: boolean | null;
  try {
    marker = await queueFixtureMarker(db, resource, resourceId);
  } catch (err) {
    console.error(`[queue] unable to scope ${resource} broadcast`, err);
    return null;
  }
  return broadcastQueueEventWithMarker(marker, type, data);
}

/** Publish when the caller already resolved the marker in its transaction. */
export async function broadcastQueueEventWithMarker<T>(
  marker: boolean | null,
  type: string,
  data: T,
): Promise<SseEnvelope<T> | null> {
  if (marker === null) return null;
  return broadcast(queueTopicForFixture(marker), type, data);
}
