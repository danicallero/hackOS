import { randomUUID } from "node:crypto";
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
import { ApplePushUnregisteredError, sendApplePush } from "../logistics/apple-push.js";
import {
  DEFAULT_SUSPICIOUS_GAP_MS,
  guaranteedPresenceMs,
  type PresenceEvent,
} from "../logistics/estimate.js";
import { expireGoogleObject } from "../logistics/google-wallet.js";
import { PASS_TYPE_IDENTIFIER } from "../logistics/wallet.js";
import { assertActiveWildcardHolder, lockPermissionGraph } from "./permission-graph.js";

export type AccountRemovalAction = "delete" | "anonymize";
const REMOVAL_RETRY_QUEUE = "account-removal-retries";

const ANONYMOUS_AUDIT_FIELDS = [
  "age",
  "gender",
  "university",
  "degree",
  "graduation year",
  "origin city",
  "guaranteed venue-presence time",
] as const;

export type AccountRemovalEligibility = {
  action: AccountRemovalAction;
  reasonCode: "fresh_account" | "operational_history";
  accessRevoked: true;
  operationalHistoryRetained: boolean;
  /** True while the configured event is live and the account has event history. */
  activeEventConsequences: boolean;
  /** A live open door session must be closed before irreversible anonymization. */
  requiresVenueExit: boolean;
  retainedFields: string[];
};

interface UserRemovalRow {
  id: number;
  email: string;
  secondary_email: string | null;
  name: string | null;
  surname: string | null;
  dni: string | null;
  badge_id: string | null;
  badge_id_history: string[];
  university_id: number | null;
  account_state: "active" | "removal_pending";
  removal_action: AccountRemovalAction | null;
}

interface RemovalPreparation {
  targetId: number;
  action: AccountRemovalAction;
  uploadPrefixes: string[];
  exportPrefixes: string[];
  storageKeys: string[];
  googleWalletObjectIds: string[];
  appleWalletPushTokens: string[];
}

export interface RunAccountRemovalOptions {
  targetId: number;
  actorId: number | null;
  source: string;
  reason?: string;
  /** Admin routes can force the action only after the locked preflight agrees. */
  requestedAction?: AccountRemovalAction;
  /** Internal queue jobs already have BullMQ retry semantics. */
  scheduleRetry?: boolean;
  /** The self-service idempotency row is renamed before the user row vanishes. */
  preserveIdempotency?: {
    key: string;
    scope: string;
    completionScope: string;
  };
}

export interface AccountRemovalResult {
  deleted?: true;
  anonymized?: true;
}

async function userHasOperationalHistory(client: Queryable, userId: number): Promise<boolean> {
  const { rows } = await client.query<{ has_history: boolean }>(
    `SELECT (
       EXISTS (SELECT 1 FROM check_in_logs WHERE user_id = $1)
       OR EXISTS (SELECT 1 FROM time_logs WHERE user_id = $1)
       OR EXISTS (SELECT 1 FROM activity_logs WHERE user_id = $1)
       OR EXISTS (SELECT 1 FROM users WHERE id = $1 AND badge_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM users WHERE id = $1 AND cardinality(badge_id_history) > 0)
     ) AS has_history`,
    [userId],
  );
  return Boolean(rows[0]?.has_history);
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
  // A missing or unconfigured event window is not evidence that a live event
  // is running. The irreversible action is still guarded by the authoritative
  // operational-history boundary; this flag only controls the extra warning.
  if (!config || (config.event_starts_at == null && config.event_ends_at == null)) return false;
  const now = config.current_time.getTime();
  return (
    (config.event_starts_at == null || now >= config.event_starts_at.getTime()) &&
    (config.event_ends_at == null || now <= config.event_ends_at.getTime())
  );
}

/**
 * The retention boundary is a domain fact, not a foreign-key side effect.
 * Accreditation writes check_in_logs first; old/manual data that has only a
 * badge, door signal, or activity is treated conservatively as operational
 * history too. Applications, tickets, wallet passes, teams, and permissions
 * alone do not cross this boundary.
 */
export async function getAccountRemovalEligibility(
  client: Queryable,
  userId: number,
): Promise<AccountRemovalEligibility> {
  const { rows: users } = await client.query(`SELECT id FROM users WHERE id = $1`, [userId]);
  if (!users[0]) throw new NotFoundError("User not found", { userId });

  const hasHistory = await userHasOperationalHistory(client, userId);
  const session = hasHistory
    ? await openVenueSession(client, userId)
    : { open: false, since: null };
  return hasHistory
    ? {
        action: "anonymize",
        reasonCode: "operational_history",
        accessRevoked: true,
        operationalHistoryRetained: true,
        activeEventConsequences: await eventIsActive(client),
        requiresVenueExit: session.open,
        retainedFields: [...ANONYMOUS_AUDIT_FIELDS],
      }
    : {
        action: "delete",
        reasonCode: "fresh_account",
        accessRevoked: true,
        operationalHistoryRetained: false,
        activeEventConsequences: false,
        requiresVenueExit: false,
        retainedFields: [],
      };
}

async function loadUserForRemoval(client: pg.PoolClient, userId: number): Promise<UserRemovalRow> {
  const { rows } = await client.query<UserRemovalRow>(
    `SELECT id, email, secondary_email, name, surname, dni, badge_id, badge_id_history,
            university_id, account_state, removal_action
       FROM users WHERE id = $1 FOR UPDATE`,
    [userId],
  );
  const user = rows[0];
  if (!user) throw new NotFoundError("User not found", { userId });
  return user;
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
      if (action === "anonymize" && eligibility.requiresVenueExit) {
        throw new ConflictError(
          "Close the participant's venue session before anonymizing their account.",
          { code: "participant_inside" },
        );
      }

      await client.query(
        `UPDATE users
            SET account_state = 'removal_pending', removal_action = $2, removal_started_at = clock_timestamp()
          WHERE id = $1`,
        [options.targetId, action],
      );
      // Stop authentication and delivery as soon as the pending state is
      // committed. The remaining cleanup is retriable and writers are blocked
      // by account_state, so a storage outage cannot restore access.
      await client.query(`DELETE FROM sessions WHERE user_id = $1`, [options.targetId]);
      await client.query(`DELETE FROM accounts WHERE user_id = $1`, [options.targetId]);
      await client.query(`DELETE FROM push_tokens WHERE user_id = $1`, [options.targetId]);
      // Mark external wallet copies void before notifying their providers.
      // The rows remain only while removal_pending so a retry can repeat the
      // notification; finalizeAccountRemoval deletes them.
      await client.query(
        `UPDATE wallet_passes
            SET status = 'voided', last_updated_at = clock_timestamp(),
                update_tag = ((extract(epoch FROM clock_timestamp()) * 1000)::bigint)::text
          WHERE user_id = $1 AND status <> 'voided'`,
        [options.targetId],
      );
    } else {
      action = action ?? (await getAccountRemovalEligibility(client, options.targetId)).action;
      if (options.requestedAction && options.requestedAction !== action) {
        throw new ConflictError("This account-removal request is already in progress.", { action });
      }
      if (action === "anonymize" && (await openVenueSession(client, options.targetId)).open) {
        throw new ConflictError(
          "Close the participant's venue session before anonymizing their account.",
          { code: "participant_inside" },
        );
      }
    }

    const walletArtifacts = await collectWalletArtifacts(client, options.targetId);
    return {
      targetId: options.targetId,
      action: action as AccountRemovalAction,
      uploadPrefixes: await collectUploadPrefixes(client, options.targetId),
      exportPrefixes: await collectExportPrefixes(client, options.targetId),
      storageKeys: await collectStorageKeys(client, options.targetId),
      ...walletArtifacts,
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

type RemovalRetryJob = Omit<RunAccountRemovalOptions, "scheduleRetry"> & {
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

function fieldDescription(field: Record<string, unknown>): string {
  const labels = field.label;
  const labelText =
    typeof labels === "string"
      ? labels
      : labels && typeof labels === "object"
        ? Object.values(labels as Record<string, unknown>)
            .filter((value): value is string => typeof value === "string")
            .join(" ")
        : "";
  return `${String(field.key ?? "")} ${labelText}`.toLocaleLowerCase();
}

function textValue(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d{1,3}$/.test(value.trim())) return Number(value);
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

async function extractAnonymousDemographics(
  client: pg.PoolClient,
  user: UserRemovalRow,
): Promise<{
  age: number | null;
  gender: string | null;
  university: string | null;
  degree: string | null;
  graduationYear: number | null;
  originCity: string | null;
}> {
  const { rows: current } = await client.query<{ university: string | null }>(
    `SELECT u2.name AS university
       FROM users u
       LEFT JOIN universities u2 ON u2.id = u.university_id
      WHERE u.id = $1`,
    [user.id],
  );
  const values = {
    age: null as number | null,
    gender: null as string | null,
    university: current[0]?.university ?? null,
    degree: null as string | null,
    graduationYear: null as number | null,
    originCity: null as string | null,
  };

  const { rows } = await client.query<{
    responses: Record<string, unknown>;
    template: unknown;
  }>(
    `SELECT ar.responses, a.template
       FROM application_responses ar
       JOIN applications a ON a.id = ar.application_id
      WHERE ar.user_id = $1
      ORDER BY ar.id`,
    [user.id],
  );
  const asOf = new Date();
  for (const row of rows) {
    const fields = Array.isArray(row.template) ? row.template : [];
    for (const candidate of fields) {
      if (!candidate || typeof candidate !== "object") continue;
      const field = candidate as Record<string, unknown>;
      const key = typeof field.key === "string" ? field.key : "";
      if (!key) continue;
      const description = fieldDescription(field);
      const value = firstResponseValue(row.responses ?? {}, key);
      if (value === undefined || value === null) continue;

      if (
        /(^|\s)(age|edad|birth|birthday|dob|date of birth|nacimiento|nacemento)(\s|$)/i.test(
          description,
        ) &&
        values.age == null
      ) {
        values.age = numericValue(value) ?? ageFromDate(value, asOf);
      } else if (/gender|sexo|género/i.test(description) && values.gender == null) {
        values.gender = textValue(value, 100);
      } else if (
        /degree|major|studies|field of study|titulación|estudios|carreira/i.test(description) &&
        values.degree == null
      ) {
        values.degree = textValue(value, 200);
      } else if (/graduat|year|ano|año/i.test(description) && values.graduationYear == null) {
        const year = numericValue(value);
        values.graduationYear = year != null && year >= 1900 && year <= 2200 ? year : null;
      } else if (
        /city|origin|location|joining us from|procedencia|orixe|localidad/i.test(description) &&
        values.originCity == null
      ) {
        values.originCity = textValue(value, 200);
      } else if (
        (field.kind === "university" || /university|universidade|universidad/i.test(description)) &&
        values.university == null
      ) {
        values.university = textValue(value, 200);
      }
    }
  }
  return values;
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
 * Keep only an event-sized revocation set for disconnected scanners. These
 * values are not connected to a user or anonymous participant and expire one
 * day after the configured event end (or one day from now when no end is
 * configured). This prevents old badges/tickets from living in the permanent
 * audit dataset while giving a scanner time to receive a fresh snapshot.
 */
async function addScannerTombstones(
  client: pg.PoolClient,
  badgeIds: string[],
  ticketTokens: string[],
): Promise<void> {
  const expiry = `COALESCE(
    (SELECT GREATEST(event_ends_at + interval '1 day', clock_timestamp() + interval '1 day')
       FROM event_config WHERE id = 1),
    clock_timestamp() + interval '1 day'
  )`;
  if (badgeIds.length > 0) {
    await client.query(
      `WITH expiry AS (SELECT ${expiry} AS expires_at)
       INSERT INTO scanner_revoked_badges (badge_id, revoked_at, expires_at)
       SELECT value, clock_timestamp(), expiry.expires_at
         FROM unnest($1::text[]) AS badge_values(value) CROSS JOIN expiry
       ON CONFLICT (badge_id) DO UPDATE
         SET revoked_at = EXCLUDED.revoked_at,
             expires_at = GREATEST(scanner_revoked_badges.expires_at, EXCLUDED.expires_at)`,
      [badgeIds],
    );
  }
  if (ticketTokens.length > 0) {
    await client.query(
      `WITH expiry AS (SELECT ${expiry} AS expires_at)
       INSERT INTO scanner_revoked_tickets (ticket_token, revoked_at, expires_at)
       SELECT value, clock_timestamp(), expiry.expires_at
         FROM unnest($1::text[]) AS ticket_values(value) CROSS JOIN expiry
       ON CONFLICT (ticket_token) DO UPDATE
         SET revoked_at = EXCLUDED.revoked_at,
             expires_at = GREATEST(scanner_revoked_tickets.expires_at, EXCLUDED.expires_at)`,
      [ticketTokens],
    );
  }
}

/**
 * Remove every identity-bearing relationship before deleting the users row.
 * The only rows moved rather than deleted are check-in and door records, and
 * those are changed to point at the new random anonymous participant.
 */
async function scrubRelationships(
  client: pg.PoolClient,
  user: UserRemovalRow,
  anonymousId: string | null,
  preserveIdempotency?: RunAccountRemovalOptions["preserveIdempotency"],
): Promise<void> {
  const userId = user.id;
  const emails = [user.email, user.secondary_email].filter((value): value is string =>
    Boolean(value),
  );
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

  // Accreditation and door presence are the anonymous audit record. Notes and
  // badge values are operational identifiers, never permanent audit fields.
  if (anonymousId) {
    await client.query(
      `UPDATE check_in_logs
          SET user_id = NULL, anonymous_participant_id = $2,
              badge_id = NULL, notes = NULL, staff_id = NULL
        WHERE user_id = $1`,
      [userId, anonymousId],
    );
    await client.query(
      `UPDATE time_logs
          SET user_id = NULL, anonymous_participant_id = $2,
              notes = NULL, scanned_by = NULL
        WHERE user_id = $1`,
      [userId, anonymousId],
    );
  } else {
    await client.query(`DELETE FROM check_in_logs WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM time_logs WHERE user_id = $1`, [userId]);
  }
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
  await client.query(`UPDATE announcements SET author_id = NULL WHERE author_id = $1`, [userId]);
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
    ],
  );
  if (preserveIdempotency) {
    // Move the current self-service key away from the identity-bearing
    // `u:<id>` scope before the users row is deleted. The response is only a
    // boolean, so the completion record has no identity bridge (H54).
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
  if (options.action === "anonymize" && (await openVenueSession(client, user.id)).open) {
    throw new ConflictError(
      "Close the participant's venue session before anonymizing their account.",
      {
        code: "participant_inside",
      },
    );
  }

  const wasWildcardHolder = await userHasWildcardRegardlessOfState(client, user.id);
  let anonymousId: string | null = null;
  if (options.action === "anonymize") {
    anonymousId = randomUUID();
    const demographics = await extractAnonymousDemographics(client, user);
    const guaranteedMinutes = await guaranteedMinutesAtRemoval(client, user.id);
    await client.query(
      `INSERT INTO anonymous_participants
         (id, age, gender, university, degree, graduation_year, origin_city, guaranteed_presence_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        anonymousId,
        demographics.age,
        demographics.gender,
        demographics.university,
        demographics.degree,
        demographics.graduationYear,
        demographics.originCity,
        guaranteedMinutes,
      ],
    );
  }

  await scrubRelationships(client, user, anonymousId, options.preserveIdempotency);
  const completion = anonymousId ? { anonymized: true as const } : { deleted: true as const };
  if (options.preserveIdempotency) {
    // A storage/DB failure can return after preparation has revoked access and
    // the original HTTP response is lost. Complete the preserved self-service
    // marker here so the next unauthenticated retry can replay only this
    // boolean result, never the deleted identity (H54).
    await client.query(
      `UPDATE idempotency_keys
          SET response_status = 200, response_body = $3, completed_at = clock_timestamp()
        WHERE key = $1 AND scope = $2 AND response_status IS NULL`,
      [options.preserveIdempotency.key, options.preserveIdempotency.completionScope, completion],
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
      reason: options.reason,
      // H54: this event must not become a new IP/user-agent bridge to the
      // anonymous participant.  The audit helper treats explicit null as a
      // deliberate suppression of request context.
      ip: null,
      userAgent: null,
      after: { retainedFields: [...ANONYMOUS_AUDIT_FIELDS] },
    });
  }
  await client.query(`DELETE FROM users WHERE id = $1`, [user.id]);
  if (wasWildcardHolder) await assertActiveWildcardHolder(client);
  return completion;
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
    await deleteExternalArtifacts(preparation);
  } catch (error) {
    if (options.scheduleRetry !== false && error instanceof ServiceUnavailableError) {
      await enqueueRemovalRetry(options, preparation.action);
    }
    throw error;
  }
  try {
    return await withTransaction((client) =>
      finalizeAccountRemoval(client, { ...options, action: preparation.action }),
    );
  } catch (error) {
    // Storage cleanup succeeded, but a transient DB/worker failure can still
    // roll back the final transaction. Keep the account inaccessible and make
    // completion retriable; a known business conflict is returned to the
    // caller for reconciliation instead of creating an unbounded retry loop.
    if (options.scheduleRetry !== false && !(error instanceof ConflictError)) {
      await enqueueRemovalRetry(options, preparation.action);
    }
    throw error;
  }
}

export { ANONYMOUS_AUDIT_FIELDS };

registerWorker(REMOVAL_RETRY_QUEUE, async (job: Job<RemovalRetryJob>) => {
  await runAccountRemoval({ ...job.data, scheduleRetry: false });
});
