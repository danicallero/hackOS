import type { Job } from "bullmq";

import { pool } from "../../db/pool.js";

import { NotFoundError } from "../../lib/errors.js";

import { registerWorker } from "../../lib/queues.js";

import { collectWalletArtifactsByPassIds, invalidateWalletProviders } from "./artifacts.js";

import { runAccountRemoval } from "./orchestrator.js";

import { REMOVAL_RETRY_QUEUE } from "./preparation.js";

import type { RemovalRetryJob } from "./types.js";

export async function processAccountRemovalRetry(job: Job<RemovalRetryJob>): Promise<void> {
  // Provider retries carry pass row ids rather than raw external credentials.
  // That lets a cancelled request still invalidate the original installed
  // copy, while preventing a stale retry from touching a pass reissued after
  // cancellation.
  const walletArtifacts = await collectWalletArtifactsByPassIds(pool, job.data.walletPassIds ?? []);
  await invalidateWalletProviders(walletArtifacts);
  try {
    await runAccountRemoval({
      ...job.data,
      scheduleRetry: false,
      skipWalletProviderInvalidation: true,
    });
  } catch (error) {
    // Another finalizer may have completed the same removal between provider
    // invalidation and this retry. The identity is gone and no further work is
    // required; do not keep a dead-letter job alive for a successful race.
    if (error instanceof NotFoundError) return;
    throw error;
  }
}

registerWorker(REMOVAL_RETRY_QUEUE, processAccountRemovalRetry);
