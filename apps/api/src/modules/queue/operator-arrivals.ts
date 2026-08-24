import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";

export interface OperatorArrivalAck {
  entryId: number;
  acknowledgedAt: string;
  acknowledgedBy: number | null;
}

/** The shared set is deliberately scoped to currently-called entries. */
export async function listOperatorArrivalAcks(): Promise<OperatorArrivalAck[]> {
  const { rows } = await pool.query(
    `SELECT a.queue_entry_id AS entry_id, a.acknowledged_at, a.acknowledged_by
       FROM queue_operator_arrival_ack a
       JOIN queue_entries qe ON qe.id = a.queue_entry_id
      WHERE qe.status = 'called'
      ORDER BY a.acknowledged_at DESC`,
  );
  return rows.map(
    (row: { entry_id: number; acknowledged_at: string; acknowledged_by: number | null }) => ({
      entryId: Number(row.entry_id),
      acknowledgedAt: row.acknowledged_at,
      acknowledgedBy: row.acknowledged_by === null ? null : Number(row.acknowledged_by),
    }),
  );
}

/** Called when a team is called again: the next waiting-area cycle is new. */
export async function clearOperatorArrivalAck(client: Queryable, entryId: number): Promise<void> {
  await client.query(`DELETE FROM queue_operator_arrival_ack WHERE queue_entry_id = $1`, [entryId]);
}

export async function acknowledgeOperatorArrival(
  entryId: number,
  actorId: number,
): Promise<OperatorArrivalAck> {
  const ack = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, status FROM queue_entries WHERE id = $1 FOR UPDATE`,
      [entryId],
    );
    const entry = rows[0] as { id: number; status: string } | undefined;
    if (!entry) throw new NotFoundError("Queue entry not found", { entryId });
    if (entry.status !== "called") {
      throw new ConflictError("Only a team in the waiting room can be acknowledged", {
        entryId,
        status: entry.status,
      });
    }

    const result = await client.query(
      `INSERT INTO queue_operator_arrival_ack (queue_entry_id, acknowledged_by)
       VALUES ($1, $2)
       ON CONFLICT (queue_entry_id) DO UPDATE
         SET acknowledged_at = now(), acknowledged_by = EXCLUDED.acknowledged_by
       RETURNING queue_entry_id AS entry_id, acknowledged_at, acknowledged_by`,
      [entryId, actorId],
    );
    const row = result.rows[0] as {
      entry_id: number;
      acknowledged_at: string;
      acknowledged_by: number | null;
    };
    await audit(client, {
      actorId,
      entityType: "queue_entry",
      entityId: entryId,
      action: "queue.operator.arrival_acknowledged",
      after: {
        status: entry.status,
        acknowledgedAt: row.acknowledged_at,
        acknowledgedBy: actorId,
      },
    });
    return {
      entryId: Number(row.entry_id),
      acknowledgedAt: row.acknowledged_at,
      acknowledgedBy: row.acknowledged_by === null ? null : Number(row.acknowledged_by),
    };
  });

  await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_OPERATOR_ARRIVAL_CHANGED, { entryId });
  return ack;
}
