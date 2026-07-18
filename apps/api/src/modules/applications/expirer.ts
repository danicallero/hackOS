import { config } from "../../config.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { expireDueConfirmations } from "./service.js";

/**
 * Spot-confirmation expirer (plan/07 §5.2, H15). A repeatable BullMQ job
 * marks accepted responses whose confirmation window elapsed as `expired`,
 * writing one audit row each. The processor delegates to
 * `expireDueConfirmations()`, which tests invoke directly instead of waiting
 * on BullMQ repeat timing.
 */

const QUEUE_NAME = "applications-expirer";

registerWorker(QUEUE_NAME, async () => {
  await expireDueConfirmations();
});

/** Schedules the recurring sweep. Skipped in tests, which drive expireDueConfirmations() directly. */
export async function scheduleExpirer(): Promise<void> {
  if (config.isTest) return;
  await getQueue(QUEUE_NAME).add(
    QUEUE_NAME,
    {},
    { repeat: { every: 60_000 }, jobId: QUEUE_NAME, removeOnComplete: true, removeOnFail: true },
  );
}
