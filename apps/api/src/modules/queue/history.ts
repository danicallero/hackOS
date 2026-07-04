import type { Queryable } from "../../db/pool.js";

/**
 * Every queue action writes exactly ONE queue_history row (plan/07
 * invariant 5), including no-transition actions like notify_enter (where
 * previous_status === new_status). Call this once per action, inside the
 * same transaction as the domain write.
 */
export async function writeQueueHistory(
  client: Queryable,
  params: {
    entryId: number;
    actorId: number | null;
    previousStatus: string;
    newStatus: string;
    action: string;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO queue_history
       (queue_entry_id, actor_id, previous_status, new_status, action, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      params.entryId,
      params.actorId,
      params.previousStatus,
      params.newStatus,
      params.action,
      params.reason ?? null,
      params.metadata ? JSON.stringify(params.metadata) : null,
    ],
  );
}
