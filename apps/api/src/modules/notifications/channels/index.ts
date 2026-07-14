import type { Queryable } from "../../../db/pool.js";
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

/** Routes one outbox row to its channel adapter. Throws on failure (caller applies backoff). */
export async function dispatchChannel(db: Queryable, row: OutboxRow): Promise<void> {
  const payload = row.payload ?? {};
  switch (row.channel) {
    case "in_app":
      return dispatchInApp(row);
    case "email":
      return sendEmail(db, row.user_id, payload);
    case "push":
      return dispatchPush(db, row.user_id, payload, row.category);
    case "discord":
      return dispatchDiscord();
    default:
      throw new Error(`Unknown notification channel: ${row.channel}`);
  }
}
