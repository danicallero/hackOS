import { config } from "../../config.js";
import { withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { revealDueEnterprises } from "../sponsors/service.js";
import { revealDueChallenges } from "./service.js";

/**
 * Scheduled reveal trigger (H45). Visibility itself is explicit: public routes
 * read only the visible/hidden flag. This job merely flips hidden rows whose
 * reveal trigger has matured, identically for challenges and enterprises.
 */

const QUEUE_NAME = "scheduled-visibility-publisher";

export async function runScheduledVisibilityPublisherOnce(): Promise<{
  challenges: number[];
  enterprises: number[];
}> {
  return withTransaction(async (client) => {
    const challenges = await revealDueChallenges(client);
    const enterprises = await revealDueEnterprises(client);

    for (const id of challenges) {
      await audit(client, {
        actorId: null,
        entityType: "challenge",
        entityId: id,
        action: "scheduled_reveal",
        after: { visibility: "visible" },
      });
    }
    for (const id of enterprises) {
      await audit(client, {
        actorId: null,
        entityType: "enterprise",
        entityId: id,
        action: "scheduled_reveal",
        after: { visibility: "visible" },
      });
    }

    return { challenges, enterprises };
  });
}

registerWorker(QUEUE_NAME, async () => {
  await runScheduledVisibilityPublisherOnce();
});

export async function scheduleScheduledVisibilityPublisher(): Promise<void> {
  if (config.isTest) return;
  await getQueue(QUEUE_NAME).add(
    QUEUE_NAME,
    {},
    { repeat: { every: 15_000 }, jobId: QUEUE_NAME, removeOnComplete: true, removeOnFail: true },
  );
}
