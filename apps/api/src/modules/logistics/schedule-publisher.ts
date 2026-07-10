import { config } from "../../config.js";
import { withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { emitScheduleChanged, revealDueScheduleItems } from "./schedule.js";

/**
 * Scheduled reveal trigger for schedule/activities (H47, H48; issue #80).
 * Audit finding: schedule rows carry publish_at since 0001_initial.sql but
 * nothing ever flipped visibility when it matured, so a scheduled reveal was
 * invisible to open clients (H47 "se reflejen al momento") and untraceable
 * (H53). Mirrors challenges/visibility-publisher.ts: flip inside a
 * transaction, audit each id, broadcast once after commit.
 */

const QUEUE_NAME = "schedule-visibility-publisher";

export async function runScheduleVisibilityPublisherOnce(): Promise<{ published: number[] }> {
  const published = await withTransaction(async (client) => {
    const ids = await revealDueScheduleItems(client);
    for (const id of ids) {
      await audit(client, {
        actorId: null,
        entityType: "schedule",
        entityId: id,
        action: "scheduled_reveal",
        after: { visibility: "shown" },
      });
    }
    return ids;
  });
  if (published.length > 0) {
    await emitScheduleChanged({ action: "scheduled_reveal", ids: published });
  }
  return { published };
}

registerWorker(QUEUE_NAME, async () => {
  await runScheduleVisibilityPublisherOnce();
});

export async function scheduleSchedulePublisher(): Promise<void> {
  if (config.isTest) return;
  await getQueue(QUEUE_NAME).add(
    QUEUE_NAME,
    {},
    { repeat: { every: 15_000 }, jobId: QUEUE_NAME, removeOnComplete: true, removeOnFail: true },
  );
}
