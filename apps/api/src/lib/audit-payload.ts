/** H53: retain operational facts, not a second copy of private/free-form content. */
const PRIVATE_VALUE = "[private]";
const PRIVATE_KEY =
  /password|secret|token|credential|email|phone|surname|first.?name|last.?name|\bname\b|notes?|message|description|headline|bio|address|location|diet|intolerance|birthday|birth_date|dni|photo|avatar|cv|url|storage.?key|deviceLibraryIdentifier|badge.?id|serialNumber|googleObjectId|translations|template|criteria|answers|responses|payload|body|title|subject|items/i;
const SAFE_TEXT_KEY =
  /^(status|statuses|state|capability|kind|type|mode|platform|visibility|source|decision|role|purpose|method|format|language|primaryLanguage|tvLanguage|slot|variant|position|target|triggerEvent|fieldKey|field_key|dimension|retention_mode|retentionMode|panel_key|scope|attendance_policy|attendancePolicy|identity_policy|identityPolicy|demo_requirement|demoRequirement|edit_session_id|last_edited_at|wifiSsid|wifi_ssid|timezone)$/;
const FIELD_LIST_KEY =
  /^(fields|changed_fields|changedFields|retainedFields|retainedRoles|fixtureKeys)$/;
const TIME_KEY = /(?:_at|At|_from|From|_until|Until|_date|Date|_time|Time)$/;

function object(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)
  );
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function changedAuditFields(before: unknown, after: unknown): string[] {
  const left = object(before) ? before : {};
  const right = object(after) ? after : {};
  const declared = [right.changed_fields, right.changedFields, right.fields].flatMap((value) =>
    Array.isArray(value) ? value.filter((field): field is string => typeof field === "string") : [],
  );
  const metadata = new Set([
    "changed_fields",
    "changedFields",
    "fields",
    "edit_session_id",
    "last_edited_at",
    "updated_at",
    "updatedAt",
  ]);
  return [...new Set([...declared, ...Object.keys(left), ...Object.keys(right)])]
    .filter(
      (key) =>
        !metadata.has(key) &&
        (declared.includes(key) || canonical(left[key]) !== canonical(right[key])),
    )
    .sort((left, right) => left.localeCompare(right));
}

export function privateAuditSnapshot(value: unknown, key = ""): unknown {
  if (value == null) return value;
  // H54: retention definitions contain field identifiers, never submitted answers.
  if (key === "anonymousRetention" && Array.isArray(value))
    return value
      .filter(object)
      .map((field) =>
        Object.fromEntries(
          ["key", "kind", "dimension"]
            .filter((name) => typeof field[name] === "string")
            .map((name) => [name, field[name]]),
        ),
      );
  // H54: relational subject pointers must remain discoverable by account erasure.
  if (
    typeof value === "number" &&
    /(?:Id|_id)$/.test(key) &&
    !/badge|token|secret|device/i.test(key)
  )
    return value;
  if (FIELD_LIST_KEY.test(key))
    return Array.isArray(value)
      ? value.filter((item) => typeof item === "string")
      : object(value)
        ? Object.keys(value)
        : PRIVATE_VALUE;
  if (
    PRIVATE_KEY.test(key) &&
    !(typeof value === "number" && /(?:Count|_count|Updated|Responses|count|timesEaten)$/.test(key))
  )
    return PRIVATE_VALUE;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => privateAuditSnapshot(item, key));
  if (object(value))
    return Object.fromEntries(
      Object.entries(value).map(([field, item]) => [field, privateAuditSnapshot(item, field)]),
    );
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (
    typeof value === "string" &&
    (SAFE_TEXT_KEY.test(key) ||
      TIME_KEY.test(key) ||
      ["ALLOW", "DENY", "INHERIT", "allow", "deny", "inherit"].includes(value))
  )
    return value;
  return PRIVATE_VALUE;
}

/** H53: apply the same minimization to legacy rows returned by the API. */
export function presentAuditRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    changed_fields:
      Array.isArray(row.changed_fields) && row.changed_fields.length > 0
        ? row.changed_fields
        : changedAuditFields(row.before, row.after),
    before: privateAuditSnapshot(row.before),
    after: privateAuditSnapshot(row.after),
  };
}
