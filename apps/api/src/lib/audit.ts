import type { Queryable } from "../db/pool.js";
import { type AuditActorKind, resolveAuditActor } from "./audit-actor.js";
import { changedAuditFields, minimizeAuditSnapshot } from "./audit-payload.js";
import { getRequestContext } from "./request-context.js";

export interface AuditEntry {
  actorId: number | null;
  actorKind?: AuditActorKind;
  initiatedBy?: number | null;
  entityType: string;
  entityId: string | number;
  action: string;
  /** email | web | admin | system */
  source?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  changedFields?: string[];
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
  const actor = resolveAuditActor(entry);
  // H53: draft and availability autosaves are one bounded edit, never a state-transition log.
  if (
    actor.kind === "user" &&
    actor.actorId !== null &&
    (["save_draft", "review.update"].includes(entry.action) ||
      (entry.entityType === "helper_profile" && entry.action === "availability_updated") ||
      (entry.entityType === "helpdesk_schedule" &&
        entry.action === "replaced" &&
        entry.changedFields?.length === 1 &&
        entry.changedFields[0] === "windows"))
  ) {
    const merged = await db.query(
      `UPDATE audit_log SET after = $5::jsonb, last_edited_at = clock_timestamp(),
        changed_fields = ARRAY(SELECT DISTINCT unnest(changed_fields || $6::text[]))
       WHERE id = (SELECT id FROM audit_log
         WHERE entity_type = $1 AND entity_id = $2 AND actor_id IS NOT DISTINCT FROM $3::int
           AND action = $4 AND source = $7
           AND created_at > now() - interval '30 minutes'
           AND COALESCE(last_edited_at, created_at) > now() - interval '2 minutes'
         ORDER BY id DESC LIMIT 1)
         AND (entity_type <> 'helpdesk_schedule' OR changed_fields = ARRAY['windows']::text[])
       RETURNING id`,
      [
        entry.entityType,
        String(entry.entityId),
        actor.actorId,
        entry.action,
        entry.after === undefined
          ? null
          : JSON.stringify(minimizeAuditSnapshot(entry.after, entry.entityType)),
        entry.changedFields ?? changedAuditFields(entry.before, entry.after),
        actor.source,
      ],
    );
    if (merged.rowCount) return;
  }
  await db.query(
    `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, source, before, after, reason, ip, user_agent, changed_fields, request_id, actor_kind, initiated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      actor.actorId,
      entry.entityType,
      String(entry.entityId),
      entry.action,
      actor.source,
      entry.before === undefined
        ? null
        : JSON.stringify(minimizeAuditSnapshot(entry.before, entry.entityType)),
      entry.after === undefined
        ? null
        : JSON.stringify(minimizeAuditSnapshot(entry.after, entry.entityType)),
      entry.reason ?? null,
      entry.ip !== undefined ? entry.ip : (requestContext?.ip ?? null),
      entry.userAgent !== undefined ? entry.userAgent : (requestContext?.userAgent ?? null),
      entry.changedFields ?? changedAuditFields(entry.before, entry.after),
      actor.requestId,
      actor.kind,
      actor.initiatedBy,
    ],
  );
}

/**
 * Batched form of {@link audit}: one INSERT for many entries, in the SAME
 * client/transaction as the domain write. Rows are written in array order.
 */
export async function auditMany(db: Queryable, entries: readonly AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const actors = entries.map(resolveAuditActor);
  const requestContext = getRequestContext();
  await db.query(
    `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, source, before, after, reason, ip, user_agent, changed_fields, request_id, actor_kind, initiated_by)
     SELECT actor_id, entity_type, entity_id, action, source, before, after, reason, ip, user_agent,
       ARRAY(SELECT jsonb_array_elements_text(changed_fields)), request_id, actor_kind, initiated_by FROM unnest(
       $1::int[], $2::text[], $3::text[], $4::text[], $5::text[],
       $6::jsonb[], $7::jsonb[], $8::text[], $9::text[], $10::text[], $11::jsonb[], $12::uuid[], $13::text[], $14::int[]
     ) AS entries(actor_id, entity_type, entity_id, action, source, before, after, reason, ip, user_agent, changed_fields, request_id, actor_kind, initiated_by)`,
    [
      actors.map((actor) => actor.actorId),
      entries.map((e) => e.entityType),
      entries.map((e) => String(e.entityId)),
      entries.map((e) => e.action),
      actors.map((actor) => actor.source),
      entries.map((e) =>
        e.before === undefined
          ? null
          : JSON.stringify(minimizeAuditSnapshot(e.before, e.entityType)),
      ),
      entries.map((e) =>
        e.after === undefined ? null : JSON.stringify(minimizeAuditSnapshot(e.after, e.entityType)),
      ),
      entries.map((e) => e.reason ?? null),
      entries.map((e) => (e.ip !== undefined ? e.ip : (requestContext?.ip ?? null))),
      entries.map((e) =>
        e.userAgent !== undefined ? e.userAgent : (requestContext?.userAgent ?? null),
      ),
      entries.map((e) => JSON.stringify(e.changedFields ?? changedAuditFields(e.before, e.after))),
      actors.map((actor) => actor.requestId),
      actors.map((actor) => actor.kind),
      actors.map((actor) => actor.initiatedBy),
    ],
  );
}
