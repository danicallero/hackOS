import type { Queryable } from "../db/pool.js";
import { getRequestContext } from "./request-context.js";

export interface AuditEntry {
  actorId: number | null;
  entityType: string;
  entityId: string | number;
  action: string;
  /** email | web | admin | system */
  source?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  /** Pass null for an intentionally identity-free audit event. */
  ip?: string | null;
  /** Pass null for an intentionally identity-free audit event. */
  userAgent?: string | null;
}

/**
 * Unified audit trail (H53). Sensitive mutations call this with the SAME
 * client/transaction as the domain write, so audit commits atomically with
 * the change. Domain history tables (queue_history, attempt_review_versions)
 * remain the operational source; audit_log is the admin-facing read view.
 */
export async function audit(db: Queryable, entry: AuditEntry): Promise<void> {
  const requestContext = getRequestContext();
  await db.query(
    `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, source, before, after, reason, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      entry.actorId,
      entry.entityType,
      String(entry.entityId),
      entry.action,
      entry.source ?? "web",
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.reason ?? null,
      entry.ip !== undefined ? entry.ip : (requestContext?.ip ?? null),
      entry.userAgent !== undefined ? entry.userAgent : (requestContext?.userAgent ?? null),
    ],
  );
}

/**
 * Batched form of {@link audit}: one INSERT for many entries, in the SAME
 * client/transaction as the domain write. Rows are written in array order.
 */
export async function auditMany(db: Queryable, entries: readonly AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const requestContext = getRequestContext();
  await db.query(
    `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, source, before, after, reason, ip, user_agent)
     SELECT * FROM unnest(
       $1::int[], $2::text[], $3::text[], $4::text[], $5::text[],
       $6::jsonb[], $7::jsonb[], $8::text[], $9::text[], $10::text[]
     )`,
    [
      entries.map((e) => e.actorId),
      entries.map((e) => e.entityType),
      entries.map((e) => String(e.entityId)),
      entries.map((e) => e.action),
      entries.map((e) => e.source ?? "web"),
      entries.map((e) => (e.before === undefined ? null : JSON.stringify(e.before))),
      entries.map((e) => (e.after === undefined ? null : JSON.stringify(e.after))),
      entries.map((e) => e.reason ?? null),
      entries.map((e) => (e.ip !== undefined ? e.ip : (requestContext?.ip ?? null))),
      entries.map((e) =>
        e.userAgent !== undefined ? e.userAgent : (requestContext?.userAgent ?? null),
      ),
    ],
  );
}
