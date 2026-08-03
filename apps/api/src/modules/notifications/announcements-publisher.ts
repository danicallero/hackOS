import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { config } from "../../config.js";
import { withTransaction } from "../../db/pool.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { broadcast } from "../../lib/sse.js";
import type { Announcement } from "./announcements-service.js";
import { fanOutAnnouncement } from "./announcements-service.js";

/**
 * Scheduled-visibility publisher for announcements (H50; plan/07 §5.3 "publicador
 * de visibilidad programada", scoped here to announcements). Timed reveals
 * ("la cena está lista" scheduled ahead of time) can't fan out at create time
 * since publish_at is still in the future; this repeatable job polls for rows
 * that just crossed into their vigencia window and haven't been fanned out
 * yet. `FOR UPDATE SKIP LOCKED` gives the same no-double-send guarantee as
 * the outbox dispatcher if more than one worker process polls concurrently.
 */

const QUEUE_NAME = "announcements-publisher";

export async function runAnnouncementsPublisherOnce(): Promise<{ published: number }> {
  const published = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM announcements
       WHERE notify_users = TRUE
         AND fanned_out_at IS NULL
         AND (publish_at IS NULL OR publish_at <= now())
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY id
       FOR UPDATE SKIP LOCKED`,
    );

    let published = 0;
    // No JS-side window re-check here: the claim query above already gated on
    // the DB clock, and re-comparing DB-written timestamps against the host
    // clock (Date.now()) is flaky under container/host clock skew.
    for (const row of rows as Announcement[]) {
      await fanOutAnnouncement(client, row);
      published += 1;
    }
    return { published };
  });
  if (published.published > 0) {
    await broadcast(SSE_TOPICS.CONTENT, EVENTS.CONTENT_ANNOUNCEMENT, {
      action: "scheduled_publish",
    });
  }
  return published;
}

registerWorker(QUEUE_NAME, async () => {
  await runAnnouncementsPublisherOnce();
});

export async function scheduleAnnouncementsPublisher(): Promise<void> {
  if (config.isTest) return;
  await getQueue(QUEUE_NAME).add(
    QUEUE_NAME,
    {},
    { repeat: { every: 15_000 }, jobId: QUEUE_NAME, removeOnComplete: true, removeOnFail: true },
  );
}
