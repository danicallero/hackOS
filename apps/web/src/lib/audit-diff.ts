// Key-level diff between an audit_log row's `before`/`after` snapshots (H53),
// for the detail route. Shallow only — these are flat domain-object
// snapshots in practice, not deeply nested documents.

type AuditDiffStatus = "added" | "removed" | "changed";

interface AuditDiffRow {
  key: string;
  status: AuditDiffStatus;
  before: unknown;
  after: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isPlainObject(value))
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/** H53: metadata describes private edits without retaining their content. */
export function auditChangedFields(after: unknown): string[] {
  if (!isPlainObject(after) || !Array.isArray(after.changed_fields)) return [];
  return after.changed_fields.filter((field): field is string => typeof field === "string");
}

export function auditLastEditedAt(after: unknown): string | null {
  return isPlainObject(after) && typeof after.last_edited_at === "string"
    ? after.last_edited_at
    : null;
}

/** Null when before/after aren't both plain objects — caller should fall back to raw JSON panels. */
export function diffAuditSnapshot(before: unknown, after: unknown): AuditDiffRow[] | null {
  const beforeIsObj = before === null || before === undefined || isPlainObject(before);
  const afterIsObj = after === null || after === undefined || isPlainObject(after);
  if (!beforeIsObj || !afterIsObj) return null;
  if (before == null && after == null) return [];

  const beforeObj = isPlainObject(before) ? before : {};
  const afterObj = isPlainObject(after) ? after : {};
  const metadata = new Set(["changed_fields", "edit_session_id", "last_edited_at"]);
  const keys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]))
    .filter((key) => !metadata.has(key))
    .sort((left, right) => left.localeCompare(right));

  const rows: AuditDiffRow[] = [];
  for (const key of keys) {
    // H8/H53: compare permission states by capability, not array position.
    if (key === "capabilities" && Array.isArray(beforeObj[key]) && Array.isArray(afterObj[key])) {
      const states = (value: unknown[]) =>
        Object.fromEntries(
          value
            .filter(isPlainObject)
            .filter((item) => typeof item.capability === "string")
            .map((item) => [item.capability, item.state]),
        );
      for (const row of diffAuditSnapshot(
        states(beforeObj[key] as unknown[]),
        states(afterObj[key] as unknown[]),
      ) ?? [])
        rows.push({ ...row, key: `${key}.${row.key}` });
      continue;
    }
    if (isPlainObject(beforeObj[key]) && isPlainObject(afterObj[key])) {
      for (const row of diffAuditSnapshot(beforeObj[key], afterObj[key]) ?? []) {
        rows.push({ ...row, key: `${key}.${row.key}` });
      }
      continue;
    }
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
