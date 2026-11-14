import { verifyPassword } from "better-auth/crypto";

import type pg from "pg";

import type { Queryable } from "../../db/pool.js";

import { audit } from "../../lib/audit.js";

import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";

import {
  buildCertaintyWindows,
  DEFAULT_SUSPICIOUS_GAP_MS,
  type PresenceEvent,
} from "../logistics/estimate.js";

import { userResolvesCapabilityRegardlessOfState } from "./role-authority.js";

import type {
  AccountRemovalAction,
  AccountRemovalEligibility,
  OperationalSignals,
  PendingAccountRemovalStatus,
  RemovalVenueState,
  UserRemovalRow,
} from "./types.js";

/** The only non-form value that is always retained: system-generated time. */
export const VERIFIED_PRESENCE_AUDIT_FIELD = "guaranteed venue-presence time";

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
         OR EXISTS (SELECT 1 FROM badge_id_history WHERE user_id = $1)
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

export async function loadUserForRemoval(
  client: pg.PoolClient,
  userId: number,
): Promise<UserRemovalRow> {
  const { rows } = await client.query<UserRemovalRow>(
    `SELECT id, email, email_verified, name, surname, dni, is_test_account,
            badge_id, badge_event_key,
            account_state, removal_action,
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
export async function verifyUnverifiedSelfServicePassword(
  client: pg.PoolClient,
  user: Pick<UserRemovalRow, "email_verified" | "is_test_account" | "id">,
  password: string | undefined,
  allowPasswordless = false,
): Promise<void> {
  if (user.email_verified || user.is_test_account) return;
  if (allowPasswordless) {
    const { rowCount } = await client.query(
      `SELECT 1 FROM accounts
        WHERE user_id = $1 AND provider_id = 'credential' AND password IS NOT NULL`,
      [user.id],
    );
    if (!rowCount) return;
  }
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
export async function pendingRecoveryExpiry(
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

export async function removalDeadlineExpired(
  client: Queryable,
  expiresAt: Date | null,
): Promise<boolean> {
  if (!expiresAt) return false;
  const { rows } = await client.query<{ expired: boolean }>(
    `SELECT clock_timestamp() >= $1::timestamptz AS expired`,
    [expiresAt],
  );
  return Boolean(rows[0]?.expired);
}

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

export async function userHasWildcardRegardlessOfState(
  client: pg.PoolClient,
  userId: number,
): Promise<boolean> {
  return userResolvesCapabilityRegardlessOfState(client, userId, "*");
}
