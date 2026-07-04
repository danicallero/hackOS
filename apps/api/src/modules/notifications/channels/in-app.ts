import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { broadcast } from "../../../lib/sse.js";

/**
 * in_app "channel" (H50, H51). There's no separate inbox table: the outbox
 * row itself IS the inbox item, `read_at` doubling as the read marker. This
 * function just fans the row out over SSE so an open client updates live;
 * the generic dispatcher loop marks the row `sent` right after (in_app never
 * legitimately fails — no external system involved).
 */
export async function dispatchInApp(row: {
  id: number;
  user_id: number;
  category: string;
  payload: unknown;
  created_at?: string | Date;
}): Promise<void> {
  await broadcast(`${SSE_TOPICS.USER_PREFIX}${row.user_id}`, EVENTS.USER_NOTIFICATION, {
    id: row.id,
    category: row.category,
    payload: row.payload,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : (row.created_at ?? new Date().toISOString()),
  });
}
