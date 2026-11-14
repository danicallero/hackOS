import { randomUUID } from "node:crypto";

import { withTransaction } from "../../db/pool.js";
import { withClosedEditionWrites } from "../../lib/edition.js";

import { ConflictError } from "../../lib/errors.js";

import { getQueue } from "../../lib/queues.js";
import {
  collectExportPrefixes,
  collectStorageKeys,
  collectUploadPrefixes,
  collectWalletArtifacts,
} from "./artifacts.js";
import {
  getAccountRemovalEligibility,
  loadUserForRemoval,
  pendingRecoveryExpiry,
  removalDeadlineExpired,
  removalVenueState,
  userHasWildcardRegardlessOfState,
  verifyUnverifiedSelfServicePassword,
} from "./eligibility.js";
import { consumeRemovalPin } from "./removal-pin.js";
import { assertActiveWildcardHolder, lockRoleGraph } from "./role-authority.js";

import type {
  AccountRemovalAction,
  RemovalPreparation,
  RemovalRetryJob,
  RunAccountRemovalOptions,
} from "./types.js";

export const REMOVAL_RETRY_QUEUE = "account-removal-retries";

export async function prepareAccountRemoval(
  options: RunAccountRemovalOptions,
): Promise<RemovalPreparation | null> {
  return withTransaction(async (client) => {
    await withClosedEditionWrites(client, async () => undefined);
    await lockRoleGraph(client);
    const user = await loadUserForRemoval(client, options.targetId);
    if (
      options.retryOnlyPending &&
      (user.account_state !== "removal_pending" ||
        user.removal_idempotency_key !== (options.preserveIdempotency?.key ?? null))
    ) {
      // A user may cancel while a provider-retry job is waiting in Valkey.
      // Never let that stale job start a fresh removal or void a newly issued
      // pass after cancellation. The lifecycle key distinguishes a reissued
      // self-service request that is pending again from the old request.
      return null;
    }
    // Check the graph invariant before committing REMOVAL_PENDING. If this
    // account is the last wildcard holder, failing only in the final
    // transaction would leave a half-revoked pending account that can never
    // complete. The same invariant is checked again after the user row is
    // deleted as a defence in depth.
    if (await userHasWildcardRegardlessOfState(client, user.id)) {
      await assertActiveWildcardHolder(client, user.id);
    }
    let action = user.removal_action;
    let requiresVenueExit = user.removal_requires_exit;
    let removalExpiresAt = user.removal_expires_at;

    if (user.account_state === "active") {
      const eligibility = await getAccountRemovalEligibility(client, options.targetId);
      if (options.requestedAction && options.requestedAction !== eligibility.action) {
        throw new ConflictError(
          eligibility.action === "anonymize"
            ? "This account has operational history and must be anonymized."
            : "This account has no operational history and is eligible for full deletion.",
          { reasonCode: eligibility.reasonCode },
        );
      }
      action = options.requestedAction ?? eligibility.action;
      // A request made while the participant is inside is accepted.  The
      // identity remains only long enough to record a valid exit, after which
      // the normal irreversible finalization runs.
      requiresVenueExit = eligibility.requiresVenueExit;
      removalExpiresAt = requiresVenueExit
        ? await pendingRecoveryExpiry(client, options.targetId, options.sessionToken)
        : null;

      // A verified primary address is an additional proof of intent for
      // self-service deletion/anonymization. Verify it while this transaction
      // owns the same user-row lock that selects the lifecycle boundary, so a
      // concurrent email change or second destructive request cannot race the
      // PIN/password check.
      if (options.actorId === options.targetId) {
        await consumeRemovalPin(client, user, options.securityPin);
        await verifyUnverifiedSelfServicePassword(
          client,
          user,
          options.reauthenticationPassword,
          options.allowPasswordlessReauthentication,
        );
      }

      // Retire wallet credentials while the account is still active. The H54
      // reference guard intentionally rejects UPDATEs that keep an
      // identity-bearing wallet row attached after removal_pending; this
      // write is serialized with issuance by the user-row lock above and is
      // committed atomically with the lifecycle transition below.
      await client.query(
        `UPDATE wallet_passes
            SET status = 'voided', last_updated_at = clock_timestamp(),
                update_tag = ((extract(epoch FROM clock_timestamp()) * 1000)::bigint)::text
          WHERE user_id = $1 AND status <> 'voided'`,
        [options.targetId],
      );
      await client.query(
        `UPDATE users
            SET account_state = 'removal_pending',
                removal_action = $2,
                removal_requires_exit = $3,
                removal_expires_at = $4,
                removal_idempotency_key = COALESCE(removal_idempotency_key, $5),
                removal_started_at = clock_timestamp()
          WHERE id = $1`,
        [
          options.targetId,
          action,
          requiresVenueExit,
          removalExpiresAt,
          options.preserveIdempotency?.key ?? null,
        ],
      );
      // Any pending in-venue removal is intentionally held until staff record
      // the exit or the fixed recovery deadline expires. Keep the
      // authentication/profile/operational rows for both delete and anonymize:
      // account_state blocks ordinary event writers, while the recovery
      // surface and staff exit path still need the temporary identity. Full
      // cleanup remains below for non-pending paths.
      if (!requiresVenueExit) {
        await client.query(`DELETE FROM sessions WHERE user_id = $1`, [options.targetId]);
        await client.query(`DELETE FROM accounts WHERE user_id = $1`, [options.targetId]);
        await client.query(`DELETE FROM push_tokens WHERE user_id = $1`, [options.targetId]);
        await client.query(`DELETE FROM live_activity_devices WHERE user_id = $1`, [
          options.targetId,
        ]);
        await client.query(`DELETE FROM live_activity_kind_opt_outs WHERE user_id = $1`, [
          options.targetId,
        ]);
        await client.query(`DELETE FROM live_activity_kind_orders WHERE user_id = $1`, [
          options.targetId,
        ]);
        await client.query(
          `UPDATE users
              SET food_intolerances = ARRAY[]::integer[],
                  food_intolerance_notes = NULL,
                  dietary_data_state = 'not_provided',
                  dietary_confirmed_at = NULL,
                  meal_plan_confirmed_at = NULL
            WHERE id = $1`,
          [options.targetId],
        );
        // HackUDC 2027 onboarding: scrub edition-scoped personal decisions and profiles.
        await client.query(`DELETE FROM activity_rsvps WHERE user_id = $1`, [options.targetId]);
        await client.query(`DELETE FROM onboarding_step_states WHERE user_id = $1`, [
          options.targetId,
        ]);
        await client.query(`DELETE FROM mentor_profiles WHERE user_id = $1`, [options.targetId]);
      }
      if (options.preserveIdempotency) {
        // Keep the marker in the identity-free completion scope selected by
        // the route pre-handler. A pending 202 is written by Fastify's
        // onSend hook only after the request has returned. If private-object
        // cleanup fails before then, the NULL response remains retryable
        // instead of being mistaken for a completed processing response.
        await client.query(
          `UPDATE idempotency_keys
              SET scope = $3
            WHERE key = $1 AND scope = $2`,
          [
            options.preserveIdempotency.key,
            options.preserveIdempotency.scope,
            options.preserveIdempotency.completionScope,
          ],
        );
      }
    } else {
      action = action ?? (await getAccountRemovalEligibility(client, options.targetId)).action;
      if (options.requestedAction && options.requestedAction !== action) {
        throw new ConflictError("This account-removal request is already in progress.", { action });
      }
      // A pending removal is retried after staff record an exit or its
      // recovery deadline expires. Recheck the live door state before
      // finalization so an identity still needed to record an exit is retained.
      const venue = await removalVenueState(client, options.targetId);
      const deadlineExpired = await removalDeadlineExpired(client, user.removal_expires_at);
      requiresVenueExit = venue.requiresExit && !deadlineExpired;
      if (user.removal_requires_exit !== requiresVenueExit) {
        await client.query(`UPDATE users SET removal_requires_exit = $2 WHERE id = $1`, [
          options.targetId,
          requiresVenueExit,
        ]);
      }
      // A pending request that has now reached a valid exit/deadline may have
      // been accepted by the old implementation without cleanup. Finalization
      // will delete its wallet/auth/push/dietary rows; do not try to mutate
      // them here while the pending-row FK guards are active.
    }

    const walletArtifacts = await collectWalletArtifacts(client, options.targetId);
    return {
      targetId: options.targetId,
      action: action as AccountRemovalAction,
      uploadPrefixes: await collectUploadPrefixes(client, options.targetId),
      exportPrefixes: await collectExportPrefixes(client, options.targetId),
      storageKeys: await collectStorageKeys(client, options.targetId),
      ...walletArtifacts,
      requiresVenueExit,
    };
  });
}

export async function enqueueRemovalRetry(
  options: RunAccountRemovalOptions,
  action: AccountRemovalAction,
  walletPassIds: number[],
): Promise<void> {
  try {
    await getQueue(REMOVAL_RETRY_QUEUE).add(
      `removal-${options.targetId}-${action}-${randomUUID()}`,
      {
        targetId: options.targetId,
        actorId: options.actorId,
        source: options.source,
        reason: options.reason,
        requestedAction: action,
        preserveIdempotency: options.preserveIdempotency,
        retryOnlyPending: true,
        walletPassIds,
      } satisfies RemovalRetryJob,
      {
        attempts: 8,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: true,
        // A failed job retains no useful identity once its short retry window
        // is over; operators can retry from the pending user row. Avoid
        // leaving the queue itself as a long-lived identity bridge.
        removeOnFail: { age: 24 * 60 * 60, count: 1_000 },
      },
    );
  } catch (error) {
    console.error("[removal] unable to enqueue removal retry job", error);
    // The database remains removal_pending even if Valkey is unavailable;
    // an operator can safely retry the admin endpoint after infrastructure
    // recovery. Never turn a completed revocation into an access restore.
  }
}
