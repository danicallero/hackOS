import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { assertFixtureSubjectScope } from "../logistics/review-fixture-scope.js";

export type RequestType = "export" | "deletion";
export type RequestStatus = "pending" | "processing" | "completed" | "failed";

export interface DataSubjectRequestRow {
  id: number;
  subject_user_id: number | null;
  requested_by: number | null;
  type: RequestType;
  status: RequestStatus;
  reason: string | null;
  storage_key: string | null;
  error: string | null;
  requested_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface CreateRequestInput {
  subjectUserId: number;
  requestedBy: number;
  type: RequestType;
  reason?: string;
}

export interface ListRequestsFilter {
  status?: RequestStatus;
  type?: RequestType;
  subjectUserId?: number;
  limit: number;
  offset: number;
}

export interface RequestVisibility {
  /** Internal workers may process a legacy fixture request; staff views may not expose it. */
  includeSynthetic?: boolean;
}

function syntheticVisibilityCondition(includeSynthetic: boolean, alias = "r"): string {
  if (includeSynthetic) return "";
  return ` AND (${alias}.subject_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM users synthetic_subject
     WHERE synthetic_subject.id = ${alias}.subject_user_id
       AND synthetic_subject.is_test_account = true
  )) AND NOT EXISTS (
    SELECT 1 FROM audit_log fixture_marker
     WHERE fixture_marker.entity_type = 'data_subject_request'
       AND fixture_marker.entity_id = ${alias}.id::text
       AND fixture_marker.action = 'fixture_scope_marked'
       AND fixture_marker.after ->> 'is_test_account' = 'true'
  )`;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/** H54: create an export/deletion request. Enqueueing the worker job is the caller's job, after commit. */
export async function createRequest(input: CreateRequestInput): Promise<DataSubjectRequestRow> {
  if (input.subjectUserId === input.requestedBy) {
    throw new BadRequestError("You can't file a data-subject request against your own account");
  }
  try {
    return await withTransaction(async (client) => {
      // Serialize request creation with account removal and enforce the same
      // fixture boundary as the route pre-handler. A direct service caller
      // must not be able to create a request for a pending or synthetic
      // subject by bypassing HTTP policy.
      const { rows: subjectRows } = await client.query(
        `SELECT id FROM users
          WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
          FOR UPDATE`,
        [input.subjectUserId],
      );
      if (!subjectRows[0]) throw new NotFoundError("User not found");
      await assertFixtureSubjectScope(client, input.requestedBy, input.subjectUserId);
      const { rows } = await client.query(
        `INSERT INTO data_subject_requests (subject_user_id, requested_by, type, reason)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [input.subjectUserId, input.requestedBy, input.type, input.reason ?? null],
      );
      const row = rows[0] as DataSubjectRequestRow;
      await audit(client, {
        actorId: input.requestedBy,
        entityType: "data_subject_request",
        entityId: row.id,
        action: "requested",
        source: "admin",
        after: { subjectUserId: input.subjectUserId, type: input.type, reason: input.reason },
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(`An active ${input.type} request already exists for this user`, {
        subjectUserId: input.subjectUserId,
        type: input.type,
      });
    }
    throw err;
  }
}

export async function listRequests(
  filter: ListRequestsFilter,
  visibility: RequestVisibility = { includeSynthetic: false },
): Promise<{ items: DataSubjectRequestRow[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  function addCondition(sqlFragment: string, value: unknown): void {
    params.push(value);
    conditions.push(sqlFragment.replace("?", `$${params.length}`));
  }

  if (filter.status) addCondition("r.status = ?", filter.status);
  if (filter.type) addCondition("r.type = ?", filter.type);
  if (filter.subjectUserId !== undefined)
    addCondition("r.subject_user_id = ?", filter.subjectUserId);

  const visibilityCondition = syntheticVisibilityCondition(visibility.includeSynthetic !== false);
  const where = `${conditions.length ? `WHERE ${conditions.join(" AND ")}` : "WHERE TRUE"}${visibilityCondition}`;
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  const { rows } = await pool.query(
    `SELECT r.* FROM data_subject_requests r ${where} ORDER BY r.id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, filter.limit, filter.offset],
  );
  const { rows: countRows } = await pool.query(
    `SELECT count(*)::int AS count FROM data_subject_requests r ${where}`,
    params,
  );
  return { items: rows as DataSubjectRequestRow[], total: countRows[0].count as number };
}

export async function getRequest(
  id: number,
  visibility: RequestVisibility = { includeSynthetic: false },
): Promise<DataSubjectRequestRow> {
  const visibilityCondition = syntheticVisibilityCondition(visibility.includeSynthetic !== false);
  const { rows } = await pool.query(
    `SELECT r.* FROM data_subject_requests r
      WHERE r.id = $1${visibilityCondition}`,
    [id],
  );
  if (!rows[0]) throw new NotFoundError("Data subject request not found", { id });
  return rows[0] as DataSubjectRequestRow;
}

/**
 * Atomically flip a pending request to processing. Returns null if it's
 * already been claimed (or finished) — safe against BullMQ redelivery.
 */
export async function claimForProcessing(id: number): Promise<DataSubjectRequestRow | null> {
  const { rows } = await pool.query(
    `UPDATE data_subject_requests
        SET status = 'processing', started_at = clock_timestamp(), completed_at = NULL
      WHERE id = $1
        AND (
          status IN ('pending', 'failed')
          OR (status = 'processing' AND started_at IS NOT NULL
              AND started_at < clock_timestamp() - interval '30 minutes')
        )
      RETURNING *`,
    [id],
  );
  return (rows[0] as DataSubjectRequestRow | undefined) ?? null;
}

/**
 * Preserve a fixture-only visibility marker without retaining its subject id.
 * Account scrubbing deliberately removes identity-bearing DSR columns, so the
 * marker lives in an identity-free audit row keyed only by the opaque request
 * id. It is idempotent and is written before the removal transaction begins.
 */
export async function markSyntheticRequest(id: number, subjectUserId: number): Promise<boolean> {
  return withTransaction(async (client) => {
    const { rows: users } = await client.query<{ is_test_account: boolean }>(
      `SELECT is_test_account FROM users WHERE id = $1`,
      [subjectUserId],
    );
    if (!users[0]?.is_test_account) return false;
    const { rows: existing } = await client.query(
      `SELECT 1 FROM audit_log
        WHERE entity_type = 'data_subject_request' AND entity_id = $1::text
          AND action = 'fixture_scope_marked'
        LIMIT 1`,
      [id],
    );
    if (existing.length === 0) {
      await audit(client, {
        actorId: null,
        entityType: "data_subject_request",
        entityId: id,
        action: "fixture_scope_marked",
        source: "system",
        after: { is_test_account: true },
        ip: null,
        userAgent: null,
      });
    }
    return true;
  });
}

async function finishRequest(
  id: number,
  status: "completed" | "failed",
  extra: { storageKey?: string; error?: string },
): Promise<DataSubjectRequestRow> {
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE data_subject_requests
         SET status = $2, completed_at = now(),
             storage_key = CASE
               WHEN subject_user_id IS NULL THEN NULL
               ELSE COALESCE($3, storage_key)
             END,
             error = $4
       WHERE id = $1 RETURNING *`,
      [id, status, extra.storageKey ?? null, extra.error ?? null],
    );
    const updated = rows[0] as DataSubjectRequestRow | undefined;
    if (!updated) throw new NotFoundError("Data subject request not found", { id });
    await audit(client, {
      actorId: null,
      entityType: "data_subject_request",
      entityId: updated.id,
      action: `${updated.type}_${status}`,
      source: "system",
      after: { status },
      reason: extra.error,
    });
    // Fixture requests are hidden from ordinary export readers. Preserve the
    // same boundary for the refresh stream: a synthetic row may still carry
    // its subject id, or may already be detached with an identity-free marker.
    const { rows: markerRows } = await client.query<{ is_synthetic: boolean }>(
      `SELECT (
         ($2::int IS NOT NULL AND EXISTS (
           SELECT 1 FROM users u
            WHERE u.id = $2 AND u.is_test_account = true
         ))
         OR EXISTS (
           SELECT 1 FROM audit_log fixture_marker
            WHERE fixture_marker.entity_type = 'data_subject_request'
              AND fixture_marker.entity_id = $1::text
              AND fixture_marker.action = 'fixture_scope_marked'
              AND fixture_marker.after ->> 'is_test_account' = 'true'
         )
       ) AS is_synthetic`,
      [updated.id, updated.subject_user_id],
    );
    return { row: updated, isSynthetic: markerRows[0]?.is_synthetic === true };
  });
  if (!result.isSynthetic) {
    await broadcast(
      SSE_TOPICS.EXPORTS,
      EVENTS.EXPORT_REQUEST_CHANGED,
      serializeRequest(result.row),
    );
  }
  return result.row;
}

export function markCompleted(id: number, storageKey?: string): Promise<DataSubjectRequestRow> {
  return finishRequest(id, "completed", { storageKey });
}

export function markFailed(id: number, error: string): Promise<DataSubjectRequestRow> {
  return finishRequest(id, "failed", { error });
}

export function serializeRequest(row: DataSubjectRequestRow) {
  return {
    id: row.id,
    subjectUserId: row.subject_user_id,
    requestedBy: row.requested_by,
    type: row.type,
    status: row.status,
    reason: row.reason,
    error: row.error,
    requestedAt: row.requested_at.toISOString(),
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    downloadAvailable:
      row.type === "export" && row.status === "completed" && row.storage_key != null,
  };
}
