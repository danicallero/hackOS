import type { Job } from "bullmq";
import { withTransaction } from "../../db/pool.js";
import { invalidateCapabilities } from "../../lib/capabilities.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { putObject } from "../../lib/storage.js";
import { anonymizeUser } from "../identity/anonymize.js";
import { buildExportBundle } from "./bundle.js";
import { claimForProcessing, markCompleted, markFailed } from "./requests.service.js";

/**
 * H54 background processor for the data-subject request workflow. Delegates
 * to plain exported functions so tests call processDataSubjectRequest()
 * directly instead of waiting on BullMQ (buildTestApp() never starts real
 * workers — see test/helpers.ts).
 */

const QUEUE_NAME = "data-subject-requests";

interface DataSubjectRequestJob {
  requestId: number;
}

export async function enqueueDataSubjectRequest(requestId: number): Promise<void> {
  await getQueue(QUEUE_NAME).add(
    QUEUE_NAME,
    { requestId },
    { jobId: `dsr-${requestId}`, attempts: 1, removeOnComplete: true, removeOnFail: false },
  );
}

export async function processDataSubjectRequest(requestId: number): Promise<void> {
  const claimed = await claimForProcessing(requestId);
  if (!claimed) return; // already processed/claimed — safe on BullMQ redelivery

  try {
    if (claimed.type === "export") {
      const bundle = await buildExportBundle(claimed.subject_user_id);
      const key = `exports/${requestId}/user-${claimed.subject_user_id}-export.json`;
      await putObject(key, Buffer.from(JSON.stringify(bundle, null, 2)), "application/json");
      await markCompleted(requestId, key);
    } else {
      await withTransaction((client) =>
        anonymizeUser(client, {
          targetId: claimed.subject_user_id,
          actorId: claimed.requested_by,
          source: "admin",
          reason: claimed.reason ?? undefined,
        }),
      );
      await invalidateCapabilities(claimed.subject_user_id);
      await markCompleted(requestId);
    }
  } catch (err) {
    await markFailed(requestId, err instanceof Error ? err.message : String(err));
  }
}

registerWorker(QUEUE_NAME, async (job: Job<DataSubjectRequestJob>) => {
  await processDataSubjectRequest(job.data.requestId);
});
