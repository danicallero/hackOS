import { withTransaction } from "../../db/pool.js";

import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from "../../lib/errors.js";

import { type DeletedQueueEntryNotification, notifyDeletedQueueEntries } from "../queue/notify.js";

import { deleteStorageArtifacts, invalidateWalletProviders } from "./artifacts.js";

import { removalDeadlineExpired, removalVenueState } from "./eligibility.js";

import { finalizeAccountRemoval } from "./finalization.js";

import { enqueueRemovalRetry, prepareAccountRemoval } from "./preparation.js";

import type { AccountRemovalResult, RunAccountRemovalOptions } from "./types.js";

/**
 * Re-check the live door state after private-object cleanup. A participant
 * can exit while storage work is in progress; finalization must not return a
 * false pending state or delete an identity still needed by the exit scanner.
 */
async function removalLiveState(
  targetId: number,
): Promise<{ gone: boolean; requiresExit: boolean }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{
      removal_requires_exit: boolean;
      removal_expires_at: Date | null;
    }>(`SELECT removal_requires_exit, removal_expires_at FROM users WHERE id = $1 FOR UPDATE`, [
      targetId,
    ]);
    if (!rows[0]) return { gone: true, requiresExit: false };
    const venue = await removalVenueState(client, targetId);
    const recoveryExpired = await removalDeadlineExpired(client, rows[0].removal_expires_at);
    if (venue.requiresExit && !recoveryExpired) {
      if (!rows[0].removal_requires_exit) {
        await client.query(`UPDATE users SET removal_requires_exit = true WHERE id = $1`, [
          targetId,
        ]);
      }
      return { gone: false, requiresExit: true };
    }
    if (rows[0].removal_requires_exit) {
      await client.query(`UPDATE users SET removal_requires_exit = false WHERE id = $1`, [
        targetId,
      ]);
    }
    return { gone: false, requiresExit: false };
  });
}

/**
 * Two-phase H54 removal. Database state changes are serialized first, private
 * objects are deleted with retryable failure semantics, and the final
 * row migration/deletion is one transaction. No identity mapping is persisted.
 */
export async function runAccountRemoval(
  options: RunAccountRemovalOptions,
): Promise<AccountRemovalResult> {
  if (options.actorId === options.targetId && options.source !== "self_service") {
    throw new BadRequestError("You can't anonymize your own account");
  }
  const preparation = await prepareAccountRemoval(options);
  if (!preparation) {
    // Only the bounded retry worker can request this path. A cancellation that
    // won the user-row lock makes the old retry a harmless no-op.
    return { status: "processing", accessRevoked: true };
  }
  try {
    if (!options.skipWalletProviderInvalidation) {
      await invalidateWalletProviders(preparation);
    }
    if (preparation.requiresVenueExit) {
      return { status: "pending_exit", pendingExit: true, accessRevoked: true };
    }
    await deleteStorageArtifacts(preparation);
  } catch (error) {
    if (options.scheduleRetry !== false && error instanceof ServiceUnavailableError) {
      await enqueueRemovalRetry(options, preparation.action, preparation.walletPassIds);
    }
    throw error;
  }
  const liveState = await removalLiveState(preparation.targetId);
  if (liveState.gone) {
    // A concurrent exit completion may have finalized the same removal after
    // this request released its preparation lock. The other transaction has
    // already produced the only valid identity-free result; do not turn that
    // successful race into a spurious 404/5xx for this retry.
    return preparation.action === "anonymize"
      ? { status: "completed", anonymized: true }
      : { status: "completed", deleted: true };
  }
  if (liveState.requiresExit) {
    return { status: "pending_exit", pendingExit: true, accessRevoked: true };
  }
  const deletedQueueEntries: DeletedQueueEntryNotification[] = [];
  try {
    const result = await withTransaction((client) =>
      finalizeAccountRemoval(client, {
        ...options,
        action: preparation.action,
        deletedQueueEntries,
      }),
    );
    await notifyDeletedQueueEntries(deletedQueueEntries);
    return result;
  } catch (error) {
    if (error instanceof NotFoundError) {
      // The same pending removal may have won the finalization race after the
      // live-state check above. The users row is intentionally gone, so the
      // only safe response is the already-completed identity-free outcome.
      return preparation.action === "anonymize"
        ? { status: "completed", anonymized: true }
        : { status: "completed", deleted: true };
    }
    // Storage cleanup succeeded, but a transient DB/worker failure can still
    // roll back the final transaction. Keep the account inaccessible and make
    // completion retriable; a known business conflict is returned to the
    // caller for reconciliation instead of creating an unbounded retry loop.
    if (
      options.scheduleRetry !== false &&
      (!(error instanceof ConflictError) || options.source === "presence_exit_completion")
    ) {
      await enqueueRemovalRetry(options, preparation.action, preparation.walletPassIds);
    }
    throw error;
  }
}
