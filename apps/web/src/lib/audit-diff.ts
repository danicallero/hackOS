// Key-level diff between an audit_log row's `before`/`after` snapshots (H53),
// for the detail route. Shallow only — these are flat domain-object
// snapshots in practice, not deeply nested documents.

export type AuditDiffStatus = "added" | "removed" | "changed";

export interface AuditDiffRow {
  key: string;
  status: AuditDiffStatus;
  before: unknown;
  after: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}

/** Null when before/after aren't both plain objects — caller should fall back to raw JSON panels. */
export function diffAuditSnapshot(before: unknown, after: unknown): AuditDiffRow[] | null {
  const beforeIsObj = before === null || before === undefined || isPlainObject(before);
  const afterIsObj = after === null || after === undefined || isPlainObject(after);
  if (!beforeIsObj || !afterIsObj) return null;
  if (before == null && after == null) return [];

  const beforeObj = isPlainObject(before) ? before : {};
  const afterObj = isPlainObject(after) ? after : {};
  const keys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])).sort();

  const rows: AuditDiffRow[] = [];
  for (const key of keys) {
    const inBefore = key in beforeObj;
    const inAfter = key in afterObj;
    if (inBefore && !inAfter) {
      rows.push({ key, status: "removed", before: beforeObj[key], after: undefined });
    } else if (!inBefore && inAfter) {
      rows.push({ key, status: "added", before: undefined, after: afterObj[key] });
    } else if (stable(beforeObj[key]) !== stable(afterObj[key])) {
      rows.push({ key, status: "changed", before: beforeObj[key], after: afterObj[key] });
    }
  }
  return rows;
}

export function formatDiffValue(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
