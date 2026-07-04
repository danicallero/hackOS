import type { Queryable } from "../../db/pool.js";

/**
 * H53 audit surface: read-only filtered query over audit_log. Every sensitive
 * mutation across the codebase (badge rotation, queue disqualify, application
 * decisions, announcement CRUD, mail settings changes, ...) writes there via
 * `src/lib/audit.ts`; this is just the admin-facing read view (capability
 * AUDIT_READ), filtered + paginated so it stays usable once the table is
 * large.
 */

export interface AuditFilters {
  entityType?: string;
  entityId?: string;
  actorId?: number;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset: number;
}

export interface AuditQueryResult {
  items: unknown[];
  total: number;
}

export async function queryAuditLog(
  db: Queryable,
  filters: AuditFilters,
): Promise<AuditQueryResult> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  function addCondition(sqlFragment: string, value: unknown): void {
    params.push(value);
    conditions.push(sqlFragment.replace("?", `$${params.length}`));
  }

  if (filters.entityType) addCondition("entity_type = ?", filters.entityType);
  if (filters.entityId) addCondition("entity_id = ?", filters.entityId);
  if (filters.actorId !== undefined) addCondition("actor_id = ?", filters.actorId);
  if (filters.action) addCondition("action = ?", filters.action);
  if (filters.dateFrom) addCondition("created_at >= ?", filters.dateFrom);
  if (filters.dateTo) addCondition("created_at <= ?", filters.dateTo);

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const limitParamIdx = params.length + 1;
  const offsetParamIdx = params.length + 2;
  const { rows } = await db.query(
    `SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
    [...params, filters.limit, filters.offset],
  );
  const { rows: countRows } = await db.query(
    `SELECT count(*)::int AS count FROM audit_log ${where}`,
    params,
  );
  return { items: rows, total: countRows[0].count };
}
