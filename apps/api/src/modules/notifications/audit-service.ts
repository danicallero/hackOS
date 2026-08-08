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
  actorQuery?: string;
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

  if (filters.entityType) addCondition("al.entity_type = ?", filters.entityType);
  if (filters.entityId) addCondition("al.entity_id = ?", filters.entityId);
  if (filters.actorId !== undefined) addCondition("al.actor_id = ?", filters.actorId);
  if (filters.actorQuery) {
    const needle = `%${filters.actorQuery}%`;
    params.push(needle, needle);
    conditions.push(
      `(u.name || ' ' || u.surname ILIKE $${params.length - 1} OR u.email ILIKE $${params.length})`,
    );
  }
  if (filters.action) addCondition("al.action = ?", filters.action);
  if (filters.dateFrom) addCondition("al.created_at >= ?", filters.dateFrom);
  if (filters.dateTo) addCondition("al.created_at <= ?", filters.dateTo);

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const from = "FROM audit_log al LEFT JOIN users u ON u.id = al.actor_id";

  const limitParamIdx = params.length + 1;
  const offsetParamIdx = params.length + 2;
  const { rows } = await db.query(
    `SELECT al.*, u.name AS actor_name, u.surname AS actor_surname, u.email AS actor_email
     ${from}
     ${where}
     ORDER BY al.id DESC
     LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
    [...params, filters.limit, filters.offset],
  );
  const { rows: countRows } = await db.query(
    `SELECT count(*)::int AS count ${from} ${where}`,
    params,
  );
  return { items: rows, total: countRows[0].count };
}
