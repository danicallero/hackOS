import type { Job } from "bullmq";
import { withTransaction } from "../../db/pool.js";
import { invalidateCapabilities } from "../../lib/capabilities.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { putObject } from "../../lib/storage.js";
import { runAccountRemoval } from "../identity/removal.js";
import { buildExportBundle } from "./bundle.js";
import { claimForProcessing, getRequest, markCompleted, markFailed } from "./requests.service.js";

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
    if (claimed.subject_user_id == null) {
      if (claimed.type === "export") {
        await markFailed(requestId, "The account no longer exists");
      } else {
        await markCompleted(requestId);
      }
      return;
    }
    if (claimed.type === "export") {
      const key = `exports/${requestId}/user-${claimed.subject_user_id}-export.json`;
      // H54: hold the active-user share lock for the complete snapshot and
      // upload. Removal takes the same user lock before changing state.
      await withTransaction(async (client) => {
        const bundle = await buildExportBundle(claimed.subject_user_id as number, client);
        await putObject(key, Buffer.from(JSON.stringify(bundle, null, 2)), "application/json");
      });
      await markCompleted(requestId, key);
    } else {
      const result = await runAccountRemoval({
        targetId: claimed.subject_user_id,
        actorId: claimed.requested_by,
        source: "admin",
        // H54: the same server-side boundary applies to DSRs as to the
        // in-app action. A participant with no operational history is fully
        // deleted; only an accredited participant is anonymized.
        reason: claimed.reason ?? undefined,
      });
      await invalidateCapabilities(claimed.subject_user_id);
      if (result.status === "completed") {
        // finalizeAccountRemoval marks the linked deletion request complete in
        // the same transaction that removes/anonymizes the subject. A request
        // that is still inside the venue is intentionally left `processing`
        // until its valid exit finalizes that transaction.
        const current = await getRequest(requestId);
        if (current.status !== "completed") await markCompleted(requestId);
      }
    }
  } catch (err) {
    await markFailed(requestId, err instanceof Error ? err.message : String(err));
  }
}

registerWorker(QUEUE_NAME, async (job: Job<DataSubjectRequestJob>) => {
  await processDataSubjectRequest(job.data.requestId);
});
