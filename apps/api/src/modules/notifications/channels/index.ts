import type { Queryable } from "../../../db/pool.js";
import { SupersededDispatchError } from "../errors.js";
import { QUEUE_CATEGORY } from "../service.js";
import type { EmailPayload } from "../templates.js";
import { dispatchDiscord } from "./discord.js";
import { sendEmail } from "./email.js";
import { dispatchInApp } from "./in-app.js";
import { dispatchPush } from "./push.js";

export interface OutboxRow {
  id: number;
  user_id: number;
  category: string;
  channel: string;
  payload: EmailPayload | null;
  attempts: number;
  created_at?: string | Date;
}

interface QueuePushPayload {
  entryId?: unknown;
  roomId?: unknown;
  template?: unknown;
}

/**
 * A `queue`-category push describes a specific transition ("you were called
 * to room X"). Retry backoff (dispatcher.ts) can delay delivery long enough
 * that the entry has since moved on — requeued, called to a different room,
 * or finished — in which case sending it now would read as a stale/duplicate
 * "you were called" for a turn that's already over (H51, H52). Only `push`
 * is checked: `in_app` is the durable inbox history and should keep showing
 * what happened even after the fact.
 */
async function isStaleQueuePush(db: Queryable, payload: QueuePushPayload): Promise<boolean> {
  if (typeof payload.entryId !== "number") return false;
  const { rows } = await db.query(
    `SELECT status, assigned_room_id FROM queue_entries WHERE id = $1`,
    [payload.entryId],
  );
  const entry = rows[0] as { status: string; assigned_room_id: number | null } | undefined;
  if (!entry) return true; // entry no longer exists at all

  if (payload.template === "queue.precall") return entry.status !== "waiting";
  if (payload.template === "queue.called" || payload.template === "queue.enter") {
    return entry.status !== "called" || entry.assigned_room_id !== payload.roomId;
  }
  return false;
}

/** Routes one outbox row to its channel adapter. Throws on failure (caller applies backoff). */
export async function dispatchChannel(db: Queryable, row: OutboxRow): Promise<void> {
  const payload = row.payload ?? {};
  switch (row.channel) {
    case "in_app":
      return dispatchInApp(row);
    case "email":
      return sendEmail(db, row.user_id, payload);
    case "push":
      if (row.category === QUEUE_CATEGORY && (await isStaleQueuePush(db, payload))) {
        throw new SupersededDispatchError("Queue transition no longer current");
      }
      return dispatchPush(db, row.user_id, payload, row.category);
    case "discord":
      return dispatchDiscord();
    default:
      throw new Error(`Unknown notification channel: ${row.channel}`);
  }
}
