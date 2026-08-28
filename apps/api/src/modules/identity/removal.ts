import { randomUUID } from "node:crypto";
import { verifyPassword } from "better-auth/crypto";
import type { Job } from "bullmq";
import type pg from "pg";
import { type Queryable, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from "../../lib/errors.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { deleteObject, deletePrefix, deleteSubjectUploadObjects } from "../../lib/storage.js";
import type { TemplateField } from "../applications/schemas.js";
import { ApplePushUnregisteredError, sendApplePush } from "../logistics/apple-push.js";
import { scannerCredentialDigest } from "../logistics/credential-tombstones.js";
import {
  buildCertaintyWindows,
  DEFAULT_SUSPICIOUS_GAP_MS,
  guaranteedPresenceMs,
  type PresenceEvent,
} from "../logistics/estimate.js";
import { expireGoogleObject } from "../logistics/google-wallet.js";
import { PASS_TYPE_IDENTIFIER } from "../logistics/wallet.js";
import { assertActiveWildcardHolder, lockPermissionGraph } from "./permission-graph.js";
import { consumeRemovalPin } from "./removal-pin.js";
import { purgeReviewFixtureQueuesForUser } from "./review-fixture-queues.js";

export type AccountRemovalAction = "delete" | "anonymize";
const REMOVAL_RETRY_QUEUE = "account-removal-retries";

/** The only non-form value that is always retained: system-generated time. */
export const VERIFIED_PRESENCE_AUDIT_FIELD = "guaranteed venue-presence time";

export type AccountRemovalEligibility = {
  action: AccountRemovalAction;
  reasonCode: "fresh_account" | "operational_history" | "inconsistent_operational_reference";
  accessRevoked: true;
  operationalHistoryRetained: boolean;
  /** True while the configured event is live and the account has event history. */
  activeEventConsequences: boolean;
  /** A live open door session must be closed before irreversible account closure. */
  requiresVenueExit: boolean;
  /** Non-canonical operational rows exist without accreditation; reconcile safely. */
  integrityWarning: boolean;
  /** Verified-primary-email self-service requests require a one-time PIN. */
  securityPinRequired: boolean;
  /** Unverified real accounts must prove possession of their current password. */
  reauthenticationRequired: boolean;
};

interface UserRemovalRow {
  id: number;
  email: string;
  email_verified: boolean;
  secondary_email: string | null;
  name: string | null;
  surname: string | null;
  dni: string | null;
  is_test_account: boolean;
  badge_id: string | null;
  badge_id_history: string[];
  university_id: number | null;
  account_state: "active" | "removal_pending";
  removal_action: AccountRemovalAction | null;
  removal_requires_exit: boolean;
  removal_expires_at: Date | null;
  removal_idempotency_key: string | null;
}

interface RemovalPreparation {
  targetId: number;
  action: AccountRemovalAction;
  uploadPrefixes: string[];
  exportPrefixes: string[];
  storageKeys: string[];
  googleWalletObjectIds: string[];
  appleWalletPushTokens: string[];
  requiresVenueExit: boolean;
}

export interface RunAccountRemovalOptions {
  targetId: number;
  actorId: number | null;
  source: string;
  reason?: string;
  /** One-time email PIN required for verified-primary-email self-service. */
  securityPin?: string;
  /** Current credential for an unverified real self-service account. */
  reauthenticationPassword?: string;
  /** The authenticated session that initiated self-service removal, if known. */
  sessionToken?: string | null;
  /** Admin routes can force the action only after the locked preflight agrees. */
  requestedAction?: AccountRemovalAction;
  /** Internal queue jobs already have BullMQ retry semantics. */
  scheduleRetry?: boolean;
  /** The self-service idempotency row remains in an identity-free scope. */
  preserveIdempotency?: {
    key: string;
    scope: string;
    completionScope: string;
  };
}

export type AccountRemovalResult =
  | { status: "completed"; deleted: true; anonymized?: never }
  | { status: "completed"; anonymized: true; deleted?: never }
  | { status: "pending_exit"; pendingExit: true; accessRevoked: true }
  | { status: "processing"; accessRevoked: true };

type OperationalSignals = {
  accredited: boolean;
  hasIntegritySignals: boolean;
};

/**
 * `check_in_logs` is the canonical accreditation boundary.  Door/activity/
 * badge rows are integrity signals only: they can require reconciliation, but
 * cannot silently turn a non-accredited account into a permanent audit case.
 */
async function readOperationalSignals(
  client: Queryable,
  userId: number,
): Promise<OperationalSignals> {
  const { rows } = await client.query<{
    accredited: boolean;
    has_integrity_signals: boolean;
  }>(
    `SELECT
       EXISTS (SELECT 1 FROM check_in_logs WHERE user_id = $1) AS accredited,
       (
         EXISTS (SELECT 1 FROM time_logs WHERE user_id = $1)
         OR EXISTS (SELECT 1 FROM activity_logs WHERE user_id = $1)
         OR EXISTS (SELECT 1 FROM users WHERE id = $1 AND badge_id IS NOT NULL)
         OR EXISTS (SELECT 1 FROM users WHERE id = $1 AND cardinality(badge_id_history) > 0)
       ) AS has_integrity_signals`,
    [userId],
  );
  return {
    accredited: Boolean(rows[0]?.accredited),
    hasIntegritySignals: Boolean(rows[0]?.has_integrity_signals),
  };
}

async function openVenueSession(
  client: Queryable,
  userId: number,
): Promise<{ open: boolean; since: Date | null }> {
  const { rows } = await client.query<{ kind: "in" | "out"; scanned_at: Date }>(
    `SELECT kind, scanned_at
       FROM time_logs
      WHERE user_id = $1 AND kind IN ('in', 'out') AND scanned_at <= clock_timestamp()
      ORDER BY scanned_at DESC, id DESC
      LIMIT 1`,
    [userId],
  );
  const last = rows[0];
  return { open: last?.kind === "in", since: last?.kind === "in" ? last.scanned_at : null };
}

export type RemovalVenueState = {
  /** Raw door state: the latest door event is an `in`. */
  open: boolean;
  /** Whether identity must remain available for a real or system exit. */
  requiresExit: boolean;
  /** The latest H24 certainty window expired and no longer credits presence. */
  expired: boolean;
};

/**
 * Resolve the removal-specific venue state from both accrued door and activity
 * logs. H24 deliberately keeps a raw `in` session open for staff
 * reconciliation, but an old session whose latest certainty window expired no
 * longer proves current presence and is a valid removal exit condition. This
 * is intentionally separate from `openVenueSession`: ordinary logistics still
 * needs the raw in/out invariant, while account removal may safely complete
 * once the accrued presence calculation has invalidated the last provisional
 * window.
 */
export async function removalVenueState(
  client: Queryable,
  userId: number,
): Promise<RemovalVenueState> {
  const session = await openVenueSession(client, userId);
  if (!session.open || !session.since) {
    return { open: false, requiresExit: false, expired: false };
  }

  const { rows: configRows } = await client.query<{
    now: Date;
    presence_certainty_window_minutes: number | null;
  }>(
    `SELECT clock_timestamp() AS now, presence_certainty_window_minutes
       FROM event_config WHERE id = 1`,
  );
  const now = configRows[0]?.now ?? new Date();
  const gapMs =
    Number(configRows[0]?.presence_certainty_window_minutes ?? DEFAULT_SUSPICIOUS_GAP_MS / 60_000) *
    60_000;
  const { rows: signalRows } = await client.query<{
    t: string;
    kind: PresenceEvent["kind"];
  }>(
    `SELECT extract(epoch FROM scanned_at) * 1000 AS t, kind
       FROM time_logs
      WHERE user_id = $1 AND kind IN ('in', 'out')
     UNION ALL
     SELECT extract(epoch FROM logged_at) * 1000 AS t, 'activity' AS kind
       FROM activity_logs
      WHERE user_id = $1
     ORDER BY t ASC`,
    [userId],
  );
  const events = signalRows.map((row) => ({ t: Number(row.t), kind: row.kind }));
  const windows = buildCertaintyWindows(events, now.getTime(), { suspiciousGapMs: gapMs });
  const latest = windows[windows.length - 1];
  const expired = latest != null && latest.deadline < now.getTime();
  return { open: true, requiresExit: !expired, expired };
}

async function eventIsActive(client: Queryable): Promise<boolean> {
  const { rows } = await client.query<{
    current_time: Date;
    event_starts_at: Date | null;
    event_ends_at: Date | null;
  }>(
    `SELECT clock_timestamp() AS current_time, event_starts_at, event_ends_at
       FROM event_config WHERE id = 1`,
  );
  const config = rows[0];
  // A missing or incomplete event window is not evidence that a live event is
  // running. The irreversible action is still guarded by the authoritative
  // operational-history boundary; this flag only controls the extra warning.
  if (!config || config.event_starts_at == null || config.event_ends_at == null) return false;
  const now = config.current_time.getTime();
  return now >= config.event_starts_at.getTime() && now <= config.event_ends_at.getTime();
}

/**
 * The retention boundary is a domain fact, not a foreign-key side effect.
 * Accreditation writes check_in_logs first. Old/manual data that has only a
 * badge, door signal, or activity is reported as an integrity inconsistency,
 * but does not become a permanent audit case by accident.
 */
export async function getAccountRemovalEligibility(
  client: Queryable,
  userId: number,
): Promise<AccountRemovalEligibility> {
  const { rows: users } = await client.query<{
    id: number;
    email_verified: boolean;
    is_test_account: boolean;
  }>(`SELECT id, email_verified, is_test_account FROM users WHERE id = $1`, [userId]);
  if (!users[0]) throw new NotFoundError("User not found", { userId });

  const signals = await readOperationalSignals(client, userId);
  const hasOperationalRows = signals.accredited || signals.hasIntegritySignals;
  const venue = hasOperationalRows
    ? await removalVenueState(client, userId)
    : { open: false, requiresExit: false, expired: false };
  const eventActive = hasOperationalRows ? await eventIsActive(client) : false;
  if (signals.accredited) {
    return {
      action: "anonymize",
      reasonCode: "operational_history",
      accessRevoked: true,
      operationalHistoryRetained: true,
      activeEventConsequences: eventActive,
      requiresVenueExit: venue.requiresExit,
      integrityWarning: false,
      securityPinRequired: Boolean(users[0].email_verified),
      reauthenticationRequired: !users[0].email_verified && !users[0].is_test_account,
    };
  }
  return {
    action: "delete",
    reasonCode: signals.hasIntegritySignals
      ? "inconsistent_operational_reference"
      : "fresh_account",
    accessRevoked: true,
    operationalHistoryRetained: false,
    activeEventConsequences: eventActive,
    requiresVenueExit: venue.requiresExit,
    integrityWarning: signals.hasIntegritySignals,
    securityPinRequired: Boolean(users[0].email_verified),
    reauthenticationRequired: !users[0].email_verified && !users[0].is_test_account,
  };
}

async function loadUserForRemoval(client: pg.PoolClient, userId: number): Promise<UserRemovalRow> {
  const { rows } = await client.query<UserRemovalRow>(
    `SELECT id, email, email_verified, secondary_email, name, surname, dni, is_test_account,
            badge_id, badge_id_history,
            university_id, account_state, removal_action,
            removal_requires_exit, removal_expires_at, removal_idempotency_key
       FROM users WHERE id = $1 FOR UPDATE`,
    [userId],
  );
  const user = rows[0];
  if (!user) throw new NotFoundError("User not found", { userId });
  return user;
}

/**
 * An unverified real account cannot receive the destructive-action email PIN.
 * Require its current Better Auth credential instead. The hash is read and
 * verified only while the removal transaction owns the user row lock; neither
 * the password nor the hash is copied into an idempotency row, retry job, audit
 * event, or API response.
 */
async function verifyUnverifiedSelfServicePassword(
  client: pg.PoolClient,
  user: Pick<UserRemovalRow, "email_verified" | "is_test_account" | "id">,
  password: string | undefined,
): Promise<void> {
  if (user.email_verified || user.is_test_account) return;
  if (!password) {
    throw new BadRequestError("Re-enter your current password to continue.", {
      code: "removal_reauthentication_required",
    });
  }

  const { rows } = await client.query<{ password: string }>(
    `SELECT password
       FROM accounts
      WHERE user_id = $1 AND provider_id = 'credential' AND password IS NOT NULL
      ORDER BY id ASC
      LIMIT 1`,
    [user.id],
  );
  const hash = rows[0]?.password;
  let valid = false;
  if (hash) {
    try {
      valid = await verifyPassword({ hash, password });
    } catch {
      valid = false;
    }
  }
  if (!valid) {
    throw new BadRequestError("The current password is incorrect.", {
      code: "removal_reauthentication_invalid",
    });
  }
}

/**
 * A pending-exit request is cancellable only until the initiating recovery
 * window ends. Capture the session expiry once; later sign-ins must not
 * extend it. The fallback is only for admin/legacy calls that have no session
 * token to identify and is deliberately bounded.
 */
async function pendingRecoveryExpiry(
  client: pg.PoolClient,
  userId: number,
  sessionToken?: string | null,
): Promise<Date> {
  const { rows } = await client.query<{ expires_at: Date }>(
    `SELECT COALESCE(
       (
         SELECT expires_at
           FROM sessions
          WHERE user_id = $1 AND token = $2 AND expires_at > clock_timestamp()
       ),
       LEAST(
         COALESCE(
           (
             SELECT min(expires_at)
               FROM sessions
              WHERE user_id = $1 AND expires_at > clock_timestamp()
           ),
           clock_timestamp() + interval '1 hour'
         ),
         clock_timestamp() + interval '1 hour'
       )
     ) AS expires_at`,
    [userId, sessionToken ?? null],
  );
  return rows[0]?.expires_at ?? new Date(Date.now() + 60 * 60 * 1000);
}

async function removalDeadlineExpired(client: Queryable, expiresAt: Date | null): Promise<boolean> {
  if (!expiresAt) return false;
  const { rows } = await client.query<{ expired: boolean }>(
    `SELECT clock_timestamp() >= $1::timestamptz AS expired`,
    [expiresAt],
  );
  return Boolean(rows[0]?.expired);
}

export type PendingAccountRemovalStatus =
  | { status: "active" }
  | {
      status: "pending_exit";
      action: "anonymize";
      expiresAt: string;
      canCancel: true;
    }
  | {
      status: "processing";
      action: AccountRemovalAction;
      expiresAt: string | null;
      canCancel: false;
    };

/** Read the minimal recovery state available to a signed-in pending account. */
export async function getPendingAccountRemovalStatus(
  client: Queryable,
  userId: number,
): Promise<PendingAccountRemovalStatus> {
  const { rows } = await client.query<{
    account_state: "active" | "removal_pending";
    removal_action: AccountRemovalAction | null;
    removal_requires_exit: boolean;
    removal_expires_at: Date | null;
  }>(
    `SELECT account_state, removal_action, removal_requires_exit, removal_expires_at
       FROM users
      WHERE id = $1 AND anonymized_at IS NULL`,
    [userId],
  );
  const user = rows[0];
  if (!user) throw new NotFoundError("User not found", { userId });
  if (user.account_state === "active") return { status: "active" };
  if (user.removal_action === "anonymize" && user.removal_requires_exit) {
    const venue = await removalVenueState(client, userId);
    if (
      venue.requiresExit &&
      user.removal_expires_at &&
      !(await removalDeadlineExpired(client, user.removal_expires_at))
    ) {
      return {
        status: "pending_exit",
        action: "anonymize",
        expiresAt: user.removal_expires_at.toISOString(),
        canCancel: true,
      };
    }
  }
  return {
    status: "processing",
    action: user.removal_action ?? "anonymize",
    expiresAt: user.removal_expires_at?.toISOString() ?? null,
    canCancel: false,
  };
}

/**
 * Restore a pending in-venue anonymization request before the exit or its
 * fixed recovery deadline wins. The same user-row lock used by scans and
 * finalization makes cancellation/exit races deterministic.
 */
export async function cancelPendingAccountRemoval(
  client: pg.PoolClient,
  userId: number,
  actorId: number,
): Promise<{ status: "cancelled" }> {
  const user = await loadUserForRemoval(client, userId);
  if (
    user.account_state !== "removal_pending" ||
    user.removal_action !== "anonymize" ||
    !user.removal_requires_exit
  ) {
    throw new ConflictError("This account-removal request can no longer be cancelled.", {
      code: "removal_not_cancellable",
    });
  }
  // Admin-originated pending requests have no self-service idempotency marker.
  // There is intentionally no target-facing admin-cancel endpoint, so do not
  // let the target turn an administrator's irreversible request into a
  // reversible one through this self-service route.
  if (!user.removal_idempotency_key) {
    throw new ConflictError("This account-removal request was initiated by an administrator.", {
      code: "removal_not_cancellable",
    });
  }
  if (!user.removal_expires_at || (await removalDeadlineExpired(client, user.removal_expires_at))) {
    throw new ConflictError("The account-removal recovery window has expired.", {
      code: "removal_expired",
    });
  }
  const venue = await removalVenueState(client, userId);
  if (!venue.requiresExit) {
    throw new ConflictError("The venue exit has already been recorded.", {
      code: "removal_exit_recorded",
    });
  }

  // The early deadline check above makes the common failure cheap, but is not
  // authoritative: the deadline can pass while venue state is being read.
  // Recheck it in the state transition itself so an expiry and cancellation
  // cannot both commit successfully.
  const restored = await client.query(
    `UPDATE users
        SET account_state = 'active',
            removal_action = NULL,
            removal_requires_exit = false,
            removal_expires_at = NULL,
            removal_started_at = NULL,
            removal_idempotency_key = NULL
      WHERE id = $1
        AND account_state = 'removal_pending'
        AND removal_action = 'anonymize'
        AND removal_requires_exit = true
        AND removal_idempotency_key = $2
        AND removal_expires_at IS NOT NULL
        AND clock_timestamp() < removal_expires_at
      RETURNING id`,
    [userId, user.removal_idempotency_key],
  );
  if (restored.rowCount !== 1) {
    if (await removalDeadlineExpired(client, user.removal_expires_at)) {
      throw new ConflictError("The account-removal recovery window has expired.", {
        code: "removal_expired",
      });
    }
    throw new ConflictError("This account-removal request can no longer be cancelled.", {
      code: "removal_not_cancellable",
    });
  }
  if (user.removal_idempotency_key) {
    await client.query(
      `DELETE FROM idempotency_keys
        WHERE key = $1 AND scope = 'POST /api/me/anonymize removal-complete'`,
      [user.removal_idempotency_key],
    );
  }
  await audit(client, {
    actorId,
    entityType: "user",
    entityId: userId,
    action: "account_removal_cancelled",
    source: "self_service",
  });
  return { status: "cancelled" };
}

async function userHasWildcardRegardlessOfState(
  client: pg.PoolClient,
  userId: number,
): Promise<boolean> {
  const { rows } = await client.query(
    `WITH RECURSIVE effective_groups(group_id) AS (
       SELECT group_id FROM permission_group_members WHERE user_id = $1
       UNION
       SELECT pgi.child_group_id
         FROM effective_groups eg
         JOIN permission_group_includes pgi ON pgi.parent_group_id = eg.group_id
     )
     SELECT 1 FROM effective_groups eg
      JOIN group_capabilities gc ON gc.group_id = eg.group_id
     WHERE gc.capability = '*' LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}

async function collectStorageKeys(client: pg.PoolClient, userId: number): Promise<string[]> {
  const { rows } = await client.query<{ storage_key: string }>(
    `SELECT storage_key
       FROM data_subject_requests
      WHERE subject_user_id = $1 AND storage_key IS NOT NULL`,
    [userId],
  );
  return [...new Set(rows.map((row) => row.storage_key).filter(Boolean))];
}

async function collectUploadPrefixes(client: pg.PoolClient, userId: number): Promise<string[]> {
  const { rows } = await client.query<{ application_id: number }>(
    `SELECT DISTINCT application_id FROM application_responses WHERE user_id = $1`,
    [userId],
  );
  return rows.map((row) => `uploads/${row.application_id}/${userId}/`);
}

async function collectExportPrefixes(client: pg.PoolClient, userId: number): Promise<string[]> {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id
       FROM data_subject_requests
      WHERE subject_user_id = $1 AND type = 'export'`,
    [userId],
  );
  // Export workers upload under this request-owned prefix. Keeping the
  // prefix separate from storage_key closes the race where the bytes have
  // been uploaded but markCompleted has not yet persisted the key.
  return rows.map((row) => `exports/${row.id}/`);
}

async function collectWalletArtifacts(
  client: pg.PoolClient,
  userId: number,
): Promise<{ googleWalletObjectIds: string[]; appleWalletPushTokens: string[] }> {
  const { rows } = await client.query<{
    google_object_id: string | null;
    push_token: string | null;
  }>(
    `SELECT wp.google_object_id, wpd.push_token
       FROM wallet_passes wp
       LEFT JOIN wallet_pass_devices wpd ON wpd.pass_id = wp.id
      WHERE wp.user_id = $1`,
    [userId],
  );
  return {
    googleWalletObjectIds: [
      ...new Set(
        rows.map((row) => row.google_object_id).filter((value): value is string => Boolean(value)),
      ),
    ],
    appleWalletPushTokens: [
      ...new Set(
        rows.map((row) => row.push_token).filter((value): value is string => Boolean(value)),
      ),
    ],
  };
}

async function prepareAccountRemoval(
  options: RunAccountRemovalOptions,
): Promise<RemovalPreparation> {
  return withTransaction(async (client) => {
    await lockPermissionGraph(client);
    const user = await loadUserForRemoval(client, options.targetId);
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
        await verifyUnverifiedSelfServicePassword(client, user, options.reauthenticationPassword);
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
      // Pending in-venue anonymization is intentionally reversible. Keep the
      // authentication/profile/operational rows until staff record the exit
      // or the fixed recovery deadline expires; account_state blocks every
      // ordinary event writer and the recovery surface is the only allowed
      // participant action. Full cleanup remains below for non-pending paths.
      if (!(action === "anonymize" && requiresVenueExit)) {
        await client.query(`DELETE FROM sessions WHERE user_id = $1`, [options.targetId]);
        await client.query(`DELETE FROM accounts WHERE user_id = $1`, [options.targetId]);
        await client.query(`DELETE FROM push_tokens WHERE user_id = $1`, [options.targetId]);
        await client.query(
          `UPDATE users
              SET food_intolerances = ARRAY[]::integer[],
                  food_intolerance_notes = NULL,
                  dietary_data_state = 'not_provided'
            WHERE id = $1`,
          [options.targetId],
        );
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
      // Legacy pending rows may predate removal_requires_exit.  Re-check the
      // authoritative door state rather than allowing finalization to delete
      // an identity that is still needed to record its exit.
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

async function deleteExternalArtifacts(preparation: RemovalPreparation): Promise<void> {
  try {
    for (const objectId of preparation.googleWalletObjectIds) {
      await expireGoogleObject(objectId);
    }
    for (const pushToken of preparation.appleWalletPushTokens) {
      try {
        await sendApplePush(pushToken, PASS_TYPE_IDENTIFIER);
      } catch (error) {
        if (error instanceof ApplePushUnregisteredError) continue;
        throw error;
      }
    }
    await deleteSubjectUploadObjects(preparation.targetId);
    for (const prefix of preparation.uploadPrefixes) await deletePrefix(prefix);
    for (const prefix of preparation.exportPrefixes) await deletePrefix(prefix);
    for (const key of preparation.storageKeys) await deleteObject(key);
  } catch {
    throw new ServiceUnavailableError(
      "Account cleanup is waiting for private storage. Your access has already been revoked; retry the operation later.",
      { code: "removal_storage_pending" },
    );
  }
}

type RemovalRetryJob = Omit<
  RunAccountRemovalOptions,
  "scheduleRetry" | "reauthenticationPassword"
> & {
  requestedAction: AccountRemovalAction;
};

async function enqueueRemovalRetry(
  options: RunAccountRemovalOptions,
  action: AccountRemovalAction,
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
  } catch {
    // The database remains removal_pending even if Valkey is unavailable;
    // an operator can safely retry the admin endpoint after infrastructure
    // recovery. Never turn a completed revocation into an access restore.
  }
}

function firstResponseValue(responses: Record<string, unknown>, key: string): unknown {
  if (Object.hasOwn(responses, key)) return responses[key];
  const wanted = key.toLowerCase();
  const found = Object.entries(responses).find(([candidate]) => candidate.toLowerCase() === wanted);
  return found?.[1];
}

function textValue(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Application answers are user-controlled. Even when an administrator has
 * explicitly opted a field into anonymous audit retention, direct identity
 * tokens are rejected from string values. A false positive drops one optional
 * audit value; a false negative would create a new identity copy (H54).
 */
function safeDemographicText(
  value: unknown,
  maxLength: number,
  user: Pick<UserRemovalRow, "email" | "secondary_email" | "name" | "surname" | "dni"> & {
    historicalEmails?: readonly string[];
  },
): string | null {
  const text = textValue(value, maxLength);
  if (!text) return null;
  const folded = text.normalize("NFKC").toLocaleLowerCase();
  const directTokens = [
    user.email,
    user.secondary_email,
    user.dni,
    ...(user.historicalEmails ?? []),
  ]
    .filter((token): token is string => typeof token === "string" && token.trim().length >= 3)
    .map((token) => token.normalize("NFKC").toLocaleLowerCase());
  if (directTokens.some((token) => folded.includes(token))) return null;

  const nameTokens = [user.name, user.surname]
    .filter((token): token is string => typeof token === "string" && token.trim().length >= 3)
    .map((token) => escapeRegExp(token.normalize("NFKC").toLocaleLowerCase().trim()));
  if (
    nameTokens.some((token) =>
      new RegExp(`(?:^|[^\\p{L}\\p{N}])${token}(?=$|[^\\p{L}\\p{N}])`, "u").test(folded),
    )
  ) {
    return null;
  }
  if (
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text) ||
    /\b(?:https?:\/\/|www\.)\S+/i.test(text) ||
    /(?:^|[^\d])\+?\d[\d\s().-]{6,}\d(?:$|[^\d])/.test(text)
  ) {
    return null;
  }
  return text;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d{1,4}$/.test(value.trim())) return Number(value);
  return null;
}

function ageFromDate(value: unknown, asOf: Date): number | null {
  const text = textValue(value, 40);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  let age = asOf.getUTCFullYear() - date.getUTCFullYear();
  const beforeBirthday =
    asOf.getUTCMonth() < date.getUTCMonth() ||
    (asOf.getUTCMonth() === date.getUTCMonth() && asOf.getUTCDate() < date.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age <= 150 ? age : null;
}

async function applicationUniversityValue(
  client: pg.PoolClient,
  value: unknown,
  identity: Pick<UserRemovalRow, "email" | "secondary_email" | "name" | "surname" | "dni"> & {
    historicalEmails?: readonly string[];
  },
  cachedNames: Map<number, string | null>,
): Promise<string | null> {
  const id = numericValue(value);
  if (id != null) {
    if (!cachedNames.has(id)) {
      const { rows } = await client.query<{ name: string }>(
        `SELECT name FROM universities WHERE id = $1`,
        [id],
      );
      cachedNames.set(id, rows[0]?.name ?? null);
    }
    // Do not retain an unresolved directory key as if it were the required
    // university value. It is an internal identifier, not an audit label.
    return safeDemographicText(cachedNames.get(id), 200, identity);
  }
  return safeDemographicText(value, 200, identity);
}

type AnonymousAuditValue = string | number | boolean | Array<string | number | boolean>;

type AnonymousAuditField = {
  applicationId: number;
  applicationFormVersion: number;
  fieldKey: string;
  dimension: string | null;
  fieldKind: string;
  value: AnonymousAuditValue;
};

async function sanitizeAnonymousAuditValue(
  client: pg.PoolClient,
  field: TemplateField,
  value: unknown,
  identity: Pick<UserRemovalRow, "email" | "secondary_email" | "name" | "surname" | "dni"> & {
    historicalEmails?: readonly string[];
  },
  universityNames: Map<number, string | null>,
  asOf: Date,
): Promise<AnonymousAuditValue | null> {
  // Personal files are never copied into the permanent anonymous dataset,
  // even if a future admin accidentally enables retention on a file field.
  if (field.kind === "file") return null;

  const dimension = field.anonymous_audit_dimension ?? null;
  if (field.kind === "university") {
    const university = await applicationUniversityValue(client, value, identity, universityNames);
    return university;
  }

  if (field.kind === "date" && dimension === "age") {
    return ageFromDate(value, asOf);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (dimension === "age" && (!Number.isInteger(value) || value < 0 || value > 150)) {
      return null;
    }
    if (
      dimension === "graduation_year" &&
      (!Number.isInteger(value) || value < 1900 || value > 2200)
    ) {
      return null;
    }
    return value;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (field.kind === "number") {
      const number = numericValue(value);
      if (number == null) return null;
      if (dimension === "age" && (number < 0 || number > 150)) return null;
      if (dimension === "graduation_year" && (number < 1900 || number > 2200)) return null;
      return number;
    }
    return safeDemographicText(value, field.kind === "textarea" ? 4000 : 500, identity);
  }
  if (Array.isArray(value)) {
    const sanitized: Array<string | number | boolean> = [];
    for (const item of value.slice(0, 100)) {
      if (typeof item === "boolean") sanitized.push(item);
      else if (typeof item === "number" && Number.isFinite(item)) sanitized.push(item);
      else if (typeof item === "string") {
        const text = safeDemographicText(item, 200, identity);
        if (text != null) sanitized.push(text);
      }
    }
    return sanitized.length > 0 ? sanitized : null;
  }
  return null;
}

/**
 * Copy only explicitly retained fields from the immutable form snapshot tied
 * to each submitted response. Missing answers are skipped; no current mutable
 * form, label, or hardcoded demographic list participates in this decision.
 */
async function extractAnonymousAuditFields(
  client: pg.PoolClient,
  user: UserRemovalRow,
): Promise<AnonymousAuditField[]> {
  // Email changes are intentionally retained only in this transient table so
  // cleanup can find legacy denormalized copies. They are also identity
  // tokens: an old address must not be copied into a supposedly anonymous
  // demographic answer after the current users.email has changed (H54).
  const { rows: historicalEmailRows } = await client.query<{ email: string }>(
    `SELECT email FROM user_email_history WHERE user_id = $1`,
    [user.id],
  );
  const identity = {
    ...user,
    historicalEmails: historicalEmailRows.map((row) => row.email),
  };
  const universityNames = new Map<number, string | null>();

  const { rows } = await client.query<{
    responses: Record<string, unknown>;
    application_id: number;
    form_version: number;
    template: unknown;
  }>(
    `SELECT ar.responses, ar.application_id, fv.version AS form_version, fv.template
       FROM application_responses ar
       JOIN application_form_versions fv ON fv.id = ar.application_form_version_id
      WHERE ar.user_id = $1
        AND ar.status <> 'draft'
      ORDER BY ar.id`,
    [user.id],
  );
  const asOf = new Date();
  const retained: AnonymousAuditField[] = [];
  for (const row of rows) {
    const fields = Array.isArray(row.template) ? row.template : [];
    for (const candidate of fields) {
      if (!candidate || typeof candidate !== "object") continue;
      const field = candidate as TemplateField;
      const key = typeof field.key === "string" ? field.key : "";
      if (!key) continue;
      if (field.retention_mode !== "anonymous_audit") continue;
      const value = firstResponseValue(row.responses ?? {}, key);
      if (value === undefined || value === null) continue;
      const sanitized = await sanitizeAnonymousAuditValue(
        client,
        field,
        value,
        identity,
        universityNames,
        asOf,
      );
      if (sanitized == null) continue;
      retained.push({
        applicationId: row.application_id,
        applicationFormVersion: row.form_version,
        fieldKey: key,
        dimension:
          typeof field.anonymous_audit_dimension === "string"
            ? field.anonymous_audit_dimension
            : null,
        fieldKind: field.kind,
        value: sanitized,
      });
    }
  }
  return retained;
}

async function guaranteedMinutesAtRemoval(client: pg.PoolClient, userId: number): Promise<number> {
  const { rows: timeRows } = await client.query<{ t: string; kind: PresenceEvent["kind"] }>(
    `SELECT extract(epoch FROM scanned_at) * 1000 AS t, kind
       FROM time_logs WHERE user_id = $1 AND kind IN ('in', 'out')
      UNION ALL
     SELECT extract(epoch FROM logged_at) * 1000 AS t, 'activity' AS kind
       FROM activity_logs WHERE user_id = $1`,
    [userId],
  );
  const { rows: eventRows } = await client.query<{ gap: number }>(
    `SELECT presence_certainty_window_minutes AS gap FROM event_config WHERE id = 1`,
  );
  const { rows: nowRows } = await client.query<{ now: Date }>(`SELECT clock_timestamp() AS now`);
  const events = timeRows.map((row) => ({ t: Number(row.t), kind: row.kind }));
  const cutoff = nowRows[0]?.now.getTime() ?? Date.now();
  const gap = Number(eventRows[0]?.gap ?? DEFAULT_SUSPICIOUS_GAP_MS / 60_000) * 60_000;
  return Math.floor(guaranteedPresenceMs(events, cutoff, { suspiciousGapMs: gap }) / 60_000);
}

async function deleteOrphanedProjects(client: pg.PoolClient, repoIds: number[]): Promise<void> {
  if (repoIds.length === 0) return;
  const { rows } = await client.query<{ id: number }>(
    `SELECT r.id
       FROM repos r
      WHERE r.id = ANY($1::int[])
        AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.repo_id = r.id)`,
    [repoIds],
  );
  const orphanIds = rows.map((row) => row.id);
  if (orphanIds.length === 0) return;
  const { rows: queueRows } = await client.query<{ id: number }>(
    `SELECT id FROM queue_entries WHERE repo_id = ANY($1::int[])`,
    [orphanIds],
  );
  const queueIds = queueRows.map((row) => row.id);
  if (queueIds.length > 0) {
    await client.query(`DELETE FROM attempt_review_versions WHERE attempt_id = ANY($1::int[])`, [
      queueIds,
    ]);
    await client.query(`DELETE FROM attempt_review WHERE attempt_id = ANY($1::int[])`, [queueIds]);
    await client.query(`DELETE FROM judging_session WHERE queue_entry_id = ANY($1::int[])`, [
      queueIds,
    ]);
    await client.query(`DELETE FROM queue_history WHERE queue_entry_id = ANY($1::int[])`, [
      queueIds,
    ]);
    await client.query(`DELETE FROM queue_entries WHERE id = ANY($1::int[])`, [queueIds]);
  }
  await client.query(`DELETE FROM challenge_winners WHERE repo_id = ANY($1::int[])`, [orphanIds]);
  await client.query(`DELETE FROM repo_devpost_prizes WHERE repo_id = ANY($1::int[])`, [orphanIds]);
  await client.query(`DELETE FROM devpost_participants WHERE repo_id = ANY($1::int[])`, [
    orphanIds,
  ]);
  await client.query(`DELETE FROM submissions WHERE repo_id = ANY($1::int[])`, [orphanIds]);
  await client.query(`DELETE FROM repos WHERE id = ANY($1::int[])`, [orphanIds]);
}

/**
 * Retire credentials in a global, unlinked denylist. A disconnected scanner
 * can replay an old badge/ticket after its former user row is gone; allowing
 * that credential to be reassigned would make the stale payload resolve to a
 * new participant. The denylist contains no user/application FK and is not an
 * audit subject. Permanent non-reuse is the smallest server-side guarantee
 * that an arbitrarily late offline retry cannot be attributed to somebody
 * else.
 */
async function addScannerTombstones(
  client: pg.PoolClient,
  badgeIds: string[],
  ticketTokens: string[],
): Promise<void> {
  if (badgeIds.length > 0) {
    await client.query(
      `INSERT INTO scanner_revoked_badges (credential_digest, revoked_at)
       SELECT value, clock_timestamp()
         FROM unnest($1::text[]) AS badge_values(value)
       ON CONFLICT (credential_digest) DO UPDATE
         SET revoked_at = EXCLUDED.revoked_at`,
      [badgeIds.map((badgeId) => scannerCredentialDigest("badge", badgeId))],
    );
  }
  if (ticketTokens.length > 0) {
    await client.query(
      `INSERT INTO scanner_revoked_tickets (credential_digest, revoked_at)
       SELECT value, clock_timestamp()
         FROM unnest($1::text[]) AS ticket_values(value)
       ON CONFLICT (credential_digest) DO UPDATE
         SET revoked_at = EXCLUDED.revoked_at`,
      [ticketTokens.map((token) => scannerCredentialDigest("ticket", token))],
    );
  }
}

/**
 * Remove every identity-bearing relationship before deleting the users row.
 * The permanent anonymous subject is created before this scrub, with only the
 * verified-time aggregate and explicitly retained form values. Raw presence
 * and scan rows are deleted after that aggregate is calculated.
 */
async function scrubRelationships(
  client: pg.PoolClient,
  user: UserRemovalRow,
  preserveIdempotency?: RunAccountRemovalOptions["preserveIdempotency"],
): Promise<void> {
  const userId = user.id;
  const { rows: historicalEmailRows } = await client.query<{ email: string }>(
    `SELECT email FROM user_email_history WHERE user_id = $1`,
    [userId],
  );
  const emails = [
    ...new Set(
      [user.email, user.secondary_email, ...historicalEmailRows.map((row) => row.email)].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  ];
  const badgeIds = [user.badge_id, ...(user.badge_id_history ?? [])].filter(
    (value): value is string => Boolean(value),
  );
  const { rows: ticketRows } = await client.query<{ token: string }>(
    `SELECT token FROM tickets WHERE user_id = $1`,
    [userId],
  );
  await addScannerTombstones(
    client,
    [...new Set(badgeIds)],
    ticketRows.map((row) => row.token),
  );

  const { rows: responseRows } = await client.query<{ id: number }>(
    `SELECT id FROM application_responses WHERE user_id = $1`,
    [userId],
  );
  const responseIds = responseRows.map((row) => row.id);
  if (responseIds.length > 0) {
    await client.query(
      `UPDATE application_responses SET referrer_application_id = NULL
        WHERE referrer_application_id = ANY($1::int[])`,
      [responseIds],
    );
    await client.query(`DELETE FROM applicant_reviews WHERE response_id = ANY($1::int[])`, [
      responseIds,
    ]);
    await client.query(`DELETE FROM application_responses WHERE id = ANY($1::int[])`, [
      responseIds,
    ]);
  }

  // No project membership is an audit requirement. Preserve a team's repo
  // only when another member still has a submission; a solo project and its
  // judging/queue records are personal data and are removed as a unit.
  const { rows: submissionRows } = await client.query<{ repo_id: number }>(
    `SELECT repo_id FROM submissions WHERE user_id = $1`,
    [userId],
  );
  const repoIds = submissionRows.map((row) => row.repo_id);
  const submissionAuditEntityIds = repoIds.map((repoId) => `${repoId}:${userId}`);
  const { rows: scheduleOwnerRows } = await client.query<{
    id: number;
    schedule_id: number;
  }>(`SELECT id, schedule_id FROM schedule_owners WHERE user_id = $1`, [userId]);
  const scheduleOwnerAuditEntityIds = scheduleOwnerRows.map(
    (row) => `${row.schedule_id}:${row.id}`,
  );
  await client.query(`DELETE FROM submissions WHERE user_id = $1`, [userId]);
  await client.query(
    `DELETE FROM devpost_participants
      WHERE user_id = $1
         OR lower(email) = ANY($2::text[])`,
    [userId, emails.map((email) => email.toLowerCase())],
  );
  // Invite redemption rows denormalize the invitee's email/name even when the
  // user FK is configured ON DELETE SET NULL. They are not part of the
  // anonymous audit set, so remove the subject's rows before deleting users;
  // the email fallback covers legacy rows whose FK was already detached.
  const normalizedEmails = emails.map((email) => email.toLowerCase());
  await client.query(
    `DELETE FROM enterprise_invite_link_redemptions
      WHERE user_id = $1 OR lower(email) = ANY($2::text[])`,
    [userId, normalizedEmails],
  );
  await client.query(
    `DELETE FROM user_invite_link_redemptions
      WHERE user_id = $1 OR lower(email) = ANY($2::text[])`,
    [userId, normalizedEmails],
  );
  await deleteOrphanedProjects(client, repoIds);

  // Raw accreditation/door rows contain timestamps, methods, notes, badge
  // identifiers, and operator provenance. The permanent audit subject keeps
  // only explicitly retained application values plus verified venue time.
  await client.query(`DELETE FROM check_in_logs WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM time_logs WHERE user_id = $1`, [userId]);
  // Staff provenance is not part of the retained audit subject. Detach it
  // from records belonging to everybody else before deleting this user; the
  // FK is intentionally nullable after H54 (H24, H54).
  await client.query(`UPDATE check_in_logs SET staff_id = NULL WHERE staff_id = $1`, [userId]);
  await client.query(`UPDATE time_logs SET scanned_by = NULL WHERE scanned_by = $1`, [userId]);
  await client.query(`DELETE FROM activity_logs WHERE user_id = $1`, [userId]);
  await client.query(`UPDATE activity_logs SET logged_by = NULL WHERE logged_by = $1`, [userId]);

  if (badgeIds.length > 0) {
    await client.query(`DELETE FROM meal_scan_batch_items WHERE badge_id = ANY($1::text[])`, [
      badgeIds,
    ]);
  }
  await client.query(
    `DELETE FROM meal_scan_batch_items
      WHERE coalesce(result::text, '') ILIKE $1
         OR coalesce(error::text, '') ILIKE $1
         OR coalesce(result::text, '') ILIKE ANY($2::text[])
         OR coalesce(error::text, '') ILIKE ANY($2::text[])`,
    [`%"userId":${userId}%`, emails.map((email) => `%${email}%`)],
  );
  await client.query(`UPDATE meal_scan_batches SET submitted_by = NULL WHERE submitted_by = $1`, [
    userId,
  ]);

  await client.query(
    `UPDATE permission_group_members SET assigned_by = NULL WHERE assigned_by = $1`,
    [userId],
  );
  await client.query(`UPDATE universities SET proposed_by = NULL WHERE proposed_by = $1`, [userId]);
  await client.query(`UPDATE enterprises SET director_id = NULL WHERE director_id = $1`, [userId]);
  await client.query(`UPDATE enterprise_invite_links SET created_by = NULL WHERE created_by = $1`, [
    userId,
  ]);
  await client.query(`UPDATE user_invite_links SET created_by = NULL WHERE created_by = $1`, [
    userId,
  ]);
  await client.query(`UPDATE room_queue_groups SET assigned_by = NULL WHERE assigned_by = $1`, [
    userId,
  ]);
  await client.query(`UPDATE queue_groups SET created_by = NULL WHERE created_by = $1`, [userId]);
  await client.query(`UPDATE queue_history SET actor_id = NULL WHERE actor_id = $1`, [userId]);
  await client.query(`UPDATE attempt_review_versions SET author_id = NULL WHERE author_id = $1`, [
    userId,
  ]);
  await client.query(`UPDATE judging_session SET judge_id = NULL WHERE judge_id = $1`, [userId]);
  await client.query(`UPDATE devpost_participants SET linked_by = NULL WHERE linked_by = $1`, [
    userId,
  ]);
  await client.query(`UPDATE food_intolerances SET proposed_by = NULL WHERE proposed_by = $1`, [
    userId,
  ]);
  await client.query(
    `UPDATE application_responses SET referrer_user_id = NULL WHERE referrer_user_id = $1`,
    [userId],
  );
  // Review authorship is identity-bearing and the composite key is NOT NULL;
  // discard reviews this person wrote rather than replacing them with a fake
  // reviewer. Reviews of the departing person's own applications were
  // already deleted with their responses above.
  await client.query(`DELETE FROM applicant_reviews WHERE author_id = $1`, [userId]);
  if (user.is_test_account) {
    // A synthetic announcement's fixture marker is derived from author_id.
    // Detaching that FK would turn fixture content into ordinary staff-facing
    // content, so purge it while the synthetic identity is still attached.
    await client.query(`DELETE FROM announcements WHERE author_id = $1`, [userId]);
  } else {
    await client.query(`UPDATE announcements SET author_id = NULL WHERE author_id = $1`, [userId]);
  }
  await client.query(`UPDATE challenge_versions SET editor_id = NULL WHERE editor_id = $1`, [
    userId,
  ]);
  await client.query(`UPDATE challenge_winners SET set_by = NULL WHERE set_by = $1`, [userId]);
  await client.query(`UPDATE room_enterprises SET assigned_by = NULL WHERE assigned_by = $1`, [
    userId,
  ]);
  // schedule_owners has a CHECK requiring either user_id or free_text_name.
  // A departing account cannot be replaced with its real name, so remove
  // ownership rows for that account and only detach authorship from rows that
  // belong to somebody else (H54).
  await client.query(`DELETE FROM schedule_owners WHERE user_id = $1`, [userId]);
  await client.query(`UPDATE schedule_owners SET assigned_by = NULL WHERE assigned_by = $1`, [
    userId,
  ]);
  await client.query(`UPDATE repos SET created_by = NULL WHERE created_by = $1`, [userId]);
  await client.query(`UPDATE submissions SET invited_by = NULL WHERE invited_by = $1`, [userId]);
  await client.query(`UPDATE manual_attendee_roles SET assigned_by = NULL WHERE assigned_by = $1`, [
    userId,
  ]);
  await client.query(`UPDATE enterprise_judges SET added_by = NULL WHERE added_by = $1`, [userId]);

  await client.query(`DELETE FROM enterprise_judges WHERE user_id = $1`, [userId]);
  // A sponsor row can be the required author anchor for a challenge. Keep
  // that organisation-owned row, but sever the person relationship before
  // deleting the account; deleting the row first would violate
  // challenges.author's NO ACTION FK and strand removal_pending accounts.
  await client.query(
    `UPDATE sponsors
        SET user_id = NULL
      WHERE user_id = $1
        AND EXISTS (SELECT 1 FROM challenges WHERE author = sponsors.id)`,
    [userId],
  );
  await client.query(`DELETE FROM sponsors WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM manual_attendee_roles WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM announcement_reads WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM announcement_recipients WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM notification_preferences WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM notification_outbox WHERE user_id = $1`, [userId]);

  await client.query(
    `DELETE FROM wallet_pass_devices
      WHERE pass_id IN (SELECT id FROM wallet_passes WHERE user_id = $1)`,
    [userId],
  );
  await client.query(`DELETE FROM wallet_passes WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM wallet_access_tokens WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM tickets WHERE user_id = $1`, [userId]);
  await client.query(
    `DELETE FROM email_verification_tokens
      WHERE user_id = $1 OR lower(email) = ANY($2::text[])`,
    [userId, emails.map((email) => email.toLowerCase())],
  );
  await client.query(
    `DELETE FROM verifications
      WHERE lower(identifier) = ANY($2::text[]) OR identifier = $1::text`,
    [userId, normalizedEmails],
  );

  if (user.is_test_account) {
    // DSR fixture visibility is intentionally carried by an identity-free
    // audit marker once the subject FK is scrubbed. Mark every synthetic
    // subject row before either of the updates below can erase that FK, so a
    // pending/processing request cannot become visible or lose its fixture
    // scope before the worker handles it.
    const { rows: syntheticRequestRows } = await client.query<{ id: number }>(
      `SELECT dsr.id
         FROM data_subject_requests dsr
        WHERE dsr.subject_user_id = $1
          AND NOT EXISTS (
            SELECT 1
              FROM audit_log fixture_marker
             WHERE fixture_marker.entity_type = 'data_subject_request'
               AND fixture_marker.entity_id = dsr.id::text
               AND fixture_marker.action = 'fixture_scope_marked'
          )
        FOR UPDATE`,
      [userId],
    );
    for (const request of syntheticRequestRows) {
      await audit(client, {
        actorId: null,
        entityType: "data_subject_request",
        entityId: request.id,
        action: "fixture_scope_marked",
        source: "system",
        after: { is_test_account: true },
        ip: null,
        userAgent: null,
      });
    }
  }

  const { rows: completedDeletionRequests } = await client.query<{ id: number }>(
    `UPDATE data_subject_requests
        SET status = 'completed', completed_at = clock_timestamp(), error = NULL,
            subject_user_id = NULL, requested_by = NULL,
            reason = NULL, storage_key = NULL
      WHERE subject_user_id = $1
        AND type = 'deletion'
        AND status = 'processing'
      RETURNING id`,
    [userId],
  );
  // Keep an identity-free completion marker for the DSR admin view. The
  // request row has already lost its subject/requester/reason, and the audit
  // payload contains only its own opaque request id plus the terminal state;
  // it cannot be used as an anonymous-participant mapping.
  for (const request of completedDeletionRequests) {
    await audit(client, {
      actorId: null,
      entityType: "data_subject_request",
      entityId: request.id,
      action: "deletion_completed",
      source: "system",
      after: { status: "completed" },
      ip: null,
      userAgent: null,
    });
  }
  await client.query(
    `UPDATE data_subject_requests
        SET subject_user_id = NULL, requested_by = NULL,
            reason = NULL, storage_key = NULL, error = NULL
      WHERE subject_user_id = $1 OR requested_by = $1`,
    [userId],
  );

  // Remove audit/history rows that could reconnect an anonymous row to the
  // old identity. This intentionally sacrifices actor attribution rather than
  // keeping a hidden identity bridge in an audit table.
  // Match user identifiers only when they occur under a user-reference key.
  // Searching for a bare number would delete unrelated audit entries whose
  // challenge, repo, or queue id happens to equal this user's id.
  const idPattern = `"(userId|user_id|subjectUserId|subject_user_id|actorId|actor_id|targetId|target_id|authorId|author_id|judgeId|judge_id|staffId|staff_id|createdBy|created_by|assignedBy|assigned_by|setBy|set_by|linkedBy|linked_by|loggedBy|logged_by|scannedBy|scanned_by|requestedBy|requested_by|submittedBy|submitted_by|referrerUserId|referrer_user_id|directorId|director_id)"[[:space:]]*:[[:space:]]*("${userId}"|${userId})([,}])`;
  const memberIdsPattern = `"memberUserIds"[[:space:]]*:[^]]*(^|[,[])[[:space:]]*"?${userId}"?[[:space:]]*([,]])`;
  // Some older audit producers used a composite entity id such as
  // "repoId:email" instead of putting the email in JSON. These values are
  // still direct identifiers, so scrub them too. DNI is included for the
  // same reason; names are deliberately not searched globally because a
  // common name could delete an unrelated operator's audit row.
  const identityTokens = [...emails, user.dni]
    .filter((value): value is string => Boolean(value))
    .map((value) => `%${value}%`);
  await client.query(
    `DELETE FROM audit_log
      WHERE actor_id = $1
         OR (
           entity_type = 'application_response'
           AND entity_id = ANY($7::text[])
         )
         OR (
           entity_type = 'submission'
           AND entity_id = ANY($8::text[])
         )
         OR (
           entity_type = 'schedule_owner'
           AND entity_id = ANY($9::text[])
         )
         OR (
           entity_type = ANY($6::text[])
           AND entity_id = $2::text
         )
         OR coalesce(before::text, '') ~ $3
         OR coalesce(after::text, '') ~ $3
         OR coalesce(reason, '') ~ $3
         OR coalesce(before::text, '') ~ $5
         OR coalesce(after::text, '') ~ $5
         OR coalesce(reason, '') ~ $5
         OR coalesce(before::text, '') ILIKE ANY($4::text[])
         OR coalesce(after::text, '') ILIKE ANY($4::text[])
         OR coalesce(reason, '') ILIKE ANY($4::text[])
         OR entity_id ILIKE ANY($4::text[])`,
    [
      userId,
      userId,
      idPattern,
      identityTokens,
      memberIdsPattern,
      ["user", "badge", "accreditation", "presence", "meal", "activity"],
      responseIds.map(String),
      submissionAuditEntityIds,
      scheduleOwnerAuditEntityIds,
    ],
  );
  if (preserveIdempotency) {
    // Keep compatibility with callers that supplied the former user-scoped
    // marker. Current self-service routes insert directly into this
    // identity-free completion scope; either way, the response is only a
    // boolean and has no identity bridge (H54).
    await client.query(
      `UPDATE idempotency_keys SET scope = $3
        WHERE key = $1 AND scope = $2`,
      [preserveIdempotency.key, preserveIdempotency.scope, preserveIdempotency.completionScope],
    );
  }
  await client.query(
    `DELETE FROM idempotency_keys
      WHERE (
        scope ~ ('(^| )u:' || $1::text || '($| )')
        OR scope LIKE ('DELETE /api/users/' || $1::text || ' %')
        OR scope LIKE ('POST /api/users/' || $1::text || '/anonymize %')
        OR coalesce(response_body::text, '') ILIKE ANY($2::text[])
        OR coalesce(response_body::text, '') ~ $3
        OR coalesce(response_body::text, '') ~ $4
      )
      AND NOT (
        $5::text IS NOT NULL
        AND key = $5
        AND scope = $6
      )`,
    [
      userId,
      identityTokens,
      idPattern,
      memberIdsPattern,
      preserveIdempotency?.key ?? null,
      preserveIdempotency?.completionScope ?? null,
    ],
  );

  await client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM accounts WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM push_tokens WHERE user_id = $1`, [userId]);
}

/**
 * Remove one synthetic reviewer account before replacing a fixture generation.
 * This deliberately reuses the same relationship scrub as self-service
 * removal, including credential tombstones and private-object cleanup. It is
 * admin-only at the route boundary and refuses a real account even if a caller
 * supplies its numeric id. No anonymous id is read or written here.
 */
export async function purgeReviewFixtureAccount(
  client: pg.PoolClient,
  userId: number,
): Promise<void> {
  await lockPermissionGraph(client);
  const user = await loadUserForRemoval(client, userId);
  if (!user.is_test_account) {
    throw new ConflictError("Only synthetic review fixture accounts can be regenerated.", {
      code: "review_fixture_required",
    });
  }

  await purgeReviewFixtureQueuesForUser(client, user.id);

  // Run external cleanup before the database scrub commits. If storage is
  // unavailable, the transaction remains intact and the old fixture pointer
  // is still available for a safe retry.
  await deleteExternalArtifacts({
    targetId: user.id,
    action: "delete",
    uploadPrefixes: await collectUploadPrefixes(client, user.id),
    exportPrefixes: await collectExportPrefixes(client, user.id),
    storageKeys: await collectStorageKeys(client, user.id),
    ...(await collectWalletArtifacts(client, user.id)),
    requiresVenueExit: false,
  });

  const wasWildcardHolder = await userHasWildcardRegardlessOfState(client, user.id);
  if (wasWildcardHolder) await assertActiveWildcardHolder(client, user.id);
  await scrubRelationships(client, user);
  await client.query(`DELETE FROM users WHERE id = $1`, [user.id]);
  if (wasWildcardHolder) await assertActiveWildcardHolder(client);
}

export async function finalizeAccountRemoval(
  client: pg.PoolClient,
  options: RunAccountRemovalOptions & { action: AccountRemovalAction },
): Promise<AccountRemovalResult> {
  await lockPermissionGraph(client);
  const user = await loadUserForRemoval(client, options.targetId);
  if (user.account_state !== "removal_pending" || user.removal_action !== options.action) {
    throw new ConflictError("This account-removal request is not in the expected state.", {
      state: user.account_state,
      action: user.removal_action,
    });
  }
  const venue = await removalVenueState(client, user.id);
  const recoveryExpired = await removalDeadlineExpired(client, user.removal_expires_at);
  if (venue.requiresExit && !recoveryExpired) {
    throw new ConflictError(
      "Close the participant's venue session before finalizing account removal.",
      {
        code: "participant_inside",
      },
    );
  }

  // Synthetic queue/project data is a reviewer fixture, never anonymous audit
  // data. Remove it before the identity scrub so no generated challenge or
  // project can outlive the fixture account.
  await purgeReviewFixtureQueuesForUser(client, user.id);

  const wasWildcardHolder = await userHasWildcardRegardlessOfState(client, user.id);
  let anonymousId: string | null = null;
  let retainedApplicationFields: AnonymousAuditField[] = [];
  if (options.action === "anonymize") {
    anonymousId = randomUUID();
    retainedApplicationFields = await extractAnonymousAuditFields(client, user);
    const guaranteedMinutes = await guaranteedMinutesAtRemoval(client, user.id);
    await client.query(
      `INSERT INTO anonymous_participants
         (id, guaranteed_presence_minutes, is_test_account)
       VALUES ($1, $2, $3)`,
      [anonymousId, guaranteedMinutes, user.is_test_account],
    );
    for (const field of retainedApplicationFields) {
      await client.query(
        `INSERT INTO anonymous_participant_fields
           (anonymous_participant_id, application_id, application_form_version,
            field_key, anonymous_audit_dimension, field_kind, value)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          anonymousId,
          field.applicationId,
          field.applicationFormVersion,
          field.fieldKey,
          field.dimension,
          field.fieldKind,
          JSON.stringify(field.value),
        ],
      );
    }
  }

  await scrubRelationships(client, user, options.preserveIdempotency);
  const completion = anonymousId
    ? { status: "completed" as const, anonymized: true as const }
    : { status: "completed" as const, deleted: true as const };
  if (options.preserveIdempotency) {
    // A storage/DB failure can return after preparation has revoked access and
    // the original HTTP response is lost. Complete the preserved self-service
    // marker here so the next unauthenticated retry can replay only this
    // boolean result, never the deleted identity (H54).
    await client.query(
      `UPDATE idempotency_keys
          SET response_status = 200, response_body = $3::jsonb, completed_at = clock_timestamp()
        WHERE key = $1 AND scope = $2 AND response_status IS NULL`,
      [
        options.preserveIdempotency.key,
        options.preserveIdempotency.completionScope,
        JSON.stringify(completion),
      ],
    );
  }
  if (user.removal_idempotency_key) {
    const completionScope =
      options.action === "anonymize"
        ? "POST /api/me/anonymize removal-complete"
        : "DELETE /api/me removal-complete";
    await client.query(
      `UPDATE idempotency_keys
          SET response_status = 200, response_body = $2::jsonb, completed_at = clock_timestamp()
        WHERE key = $1 AND scope = $3
          AND (response_status IS NULL OR response_status = 202)`,
      [user.removal_idempotency_key, JSON.stringify(completion), completionScope],
    );
  }
  if (anonymousId) {
    await audit(client, {
      // Self-service removal cannot leave an audit_log.actor_id FK pointing
      // at the row that is deleted immediately below. A null system actor is
      // intentional here; the anonymous row contains no identity bridge.
      actorId: options.actorId === user.id ? null : options.actorId,
      entityType: "anonymous_participant",
      entityId: anonymousId,
      action: "anonymized",
      source: options.source,
      // A request-supplied reason may contain the participant's name, email,
      // or another identifier. Do not create a new identity bridge while
      // recording the identity-free completion event; omit it entirely.
      // H54: this event must not become a new IP/user-agent bridge to the
      // anonymous participant.  The audit helper treats explicit null as a
      // deliberate suppression of request context.
      ip: null,
      userAgent: null,
      after: {
        retainedFields: [
          ...new Set([
            ...retainedApplicationFields.map((field) => field.dimension ?? field.fieldKey),
            VERIFIED_PRESENCE_AUDIT_FIELD,
          ]),
        ],
      },
    });
  }
  await client.query(`DELETE FROM users WHERE id = $1`, [user.id]);
  if (wasWildcardHolder) await assertActiveWildcardHolder(client);
  return completion;
}

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
  try {
    if (preparation.requiresVenueExit) {
      return { status: "pending_exit", pendingExit: true, accessRevoked: true };
    }
    await deleteExternalArtifacts(preparation);
  } catch (error) {
    if (options.scheduleRetry !== false && error instanceof ServiceUnavailableError) {
      await enqueueRemovalRetry(options, preparation.action);
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
  try {
    return await withTransaction((client) =>
      finalizeAccountRemoval(client, { ...options, action: preparation.action }),
    );
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
      await enqueueRemovalRetry(options, preparation.action);
    }
    throw error;
  }
}

registerWorker(REMOVAL_RETRY_QUEUE, async (job: Job<RemovalRetryJob>) => {
  await runAccountRemoval({ ...job.data, scheduleRetry: false });
});
