import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";

export type RequestType = "export" | "deletion";
export type RequestStatus = "pending" | "processing" | "completed" | "failed";

export interface DataSubjectRequestRow {
  id: number;
  subject_user_id: number;
  requested_by: number;
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
): Promise<{ items: DataSubjectRequestRow[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  function addCondition(sqlFragment: string, value: unknown): void {
    params.push(value);
    conditions.push(sqlFragment.replace("?", `$${params.length}`));
  }

  if (filter.status) addCondition("status = ?", filter.status);
  if (filter.type) addCondition("type = ?", filter.type);
  if (filter.subjectUserId !== undefined) addCondition("subject_user_id = ?", filter.subjectUserId);

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;

  const { rows } = await pool.query(
    `SELECT * FROM data_subject_requests ${where} ORDER BY id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, filter.limit, filter.offset],
  );
  const { rows: countRows } = await pool.query(
    `SELECT count(*)::int AS count FROM data_subject_requests ${where}`,
    params,
  );
  return { items: rows as DataSubjectRequestRow[], total: countRows[0].count as number };
}

export async function getRequest(id: number): Promise<DataSubjectRequestRow> {
  const { rows } = await pool.query(`SELECT * FROM data_subject_requests WHERE id = $1`, [id]);
  if (!rows[0]) throw new NotFoundError("Data subject request not found", { id });
  return rows[0] as DataSubjectRequestRow;
}

/**
 * Atomically flip a pending request to processing. Returns null if it's
 * already been claimed (or finished) — safe against BullMQ redelivery.
 */
export async function claimForProcessing(id: number): Promise<DataSubjectRequestRow | null> {
  const { rows } = await pool.query(
    `UPDATE data_subject_requests SET status = 'processing', started_at = now()
     WHERE id = $1 AND status = 'pending' RETURNING *`,
    [id],
  );
  return (rows[0] as DataSubjectRequestRow | undefined) ?? null;
}

async function finishRequest(
  id: number,
  status: "completed" | "failed",
  extra: { storageKey?: string; error?: string },
): Promise<DataSubjectRequestRow> {
  const row = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE data_subject_requests
         SET status = $2, completed_at = now(),
             storage_key = COALESCE($3, storage_key), error = $4
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
    return updated;
  });
  await broadcast(SSE_TOPICS.EXPORTS, EVENTS.EXPORT_REQUEST_CHANGED, serializeRequest(row));
  return row;
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
    downloadAvailable: row.type === "export" && row.status === "completed",
  };
}
