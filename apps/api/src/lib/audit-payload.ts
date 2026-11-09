/** H53: retain operational facts, not a second copy of private/free-form content. */
import { intrinsicAuditExecutor } from "./audit-actor.js";

const PRIVATE_VALUE = "[private]";
const PRIVATE_KEY =
  /password|secret|token|credential|email|phone|surname|first.?name|last.?name|\bname\b|notes?|message|description|headline|bio|address|location|diet|intolerance|birthday|birth_date|dni|photo|avatar|cv|url|storage.?key|deviceLibraryIdentifier|badge.?id|serialNumber|googleObjectId|translations|template|criteria|answers|responses|payload|body|title|subject|items/i;
const SAFE_TEXT_KEY =
  /^(audit_audience|status|statuses|state|capability|kind|type|mode|platform|visibility|source|decision|role|purpose|method|format|language|primaryLanguage|tvLanguage|slot|variant|position|target|triggerEvent|fieldKey|field_key|dimension|retention_mode|retentionMode|panel_key|scope|attendance_policy|attendancePolicy|identity_policy|identityPolicy|demo_requirement|demoRequirement|edit_session_id|last_edited_at|wifiSsid|wifi_ssid|timezone)$/;
const FIELD_LIST_KEY =
  /^(fields|changed_fields|changedFields|retainedFields|retainedRoles|fixtureKeys)$/;
// H53: operational identifiers are evidence, not secret authentication material.
const IDENTIFIER_KEY =
  /^(?:email|primary_?email|old_?email|new_?email|badge_?id|old_?badge_?id|new_?badge_?id|user_?id|actor_?id|subject_?user_?id|target_?id|author_?id|judge_?id|staff_?id|room_?id|repo_?id|project_?id|challenge_?id|enterprise_?id|application_?id|response_?id|role_?id|pass_?id|id)$/i;
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
    "audit_audience",
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
  if ((typeof value === "string" || typeof value === "number") && IDENTIFIER_KEY.test(key))
    return value;
  if (
    typeof value === "boolean" &&
    [
      "hasPhoto",
      "hadHeadline",
      "hadLocationNote",
      "hadBio",
      "sharedCv",
      "emailVerified",
      "email_verified",
    ].includes(key)
  )
    return value;
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
  const executor = intrinsicAuditExecutor(String(row.entity_type ?? ""), String(row.action ?? ""));
  return {
    ...row,
    ...(executor
      ? {
          actor_id: null,
          actor_name: null,
          actor_surname: null,
          actor_email: null,
          actor_kind: executor,
          source: executor,
        }
      : {}),
    changed_fields:
      Array.isArray(row.changed_fields) && row.changed_fields.length > 0
        ? row.changed_fields
        : changedAuditFields(row.before, row.after),
    before: minimizeAuditSnapshot(row.before, String(row.entity_type ?? "")),
    after: minimizeAuditSnapshot(row.after, String(row.entity_type ?? "")),
  };
}

/** H53: public event content is distinct from private subject data. */
const PUBLIC_CONTENT_FIELDS: Record<string, readonly string[]> = {
  wallet_operation: ["translations"],
  announcement: ["title", "body", "translations"],
  schedule: [
    "title",
    "description",
    "location",
    "titleI18n",
    "descriptionI18n",
    "title_i18n",
    "description_i18n",
  ],
  challenge: ["title", "description", "title_i18n", "description_i18n", "criteria"],
  enterprise: ["name", "description"],
  sponsor_faq: ["items"],
  application: ["name", "description"],
  event_config: ["name", "tagline", "venueName", "venue_name"],
  certificate_type: ["name", "title", "body", "name_i18n", "title_i18n", "body_i18n"],
  university: ["name"],
  university_degree: ["name"],
  food_intolerance: ["label"],
  role: ["name"],
};
const PRIVATE_CONTENT_KEY =
  /password|secret|token|credential|email|phone|dni|notes?|answers|responses|serial|badge|device|storage/i;

function publicContent(value: unknown, key: string): unknown {
  if (PRIVATE_CONTENT_KEY.test(key)) return value == null ? value : PRIVATE_VALUE;
  if (Array.isArray(value)) return value.map((item) => publicContent(item, key));
  if (object(value))
    return Object.fromEntries(
      Object.entries(value).map(([field, item]) => [field, publicContent(item, field)]),
    );
  return value;
}

export function minimizeAuditSnapshot(value: unknown, entityType: string): unknown {
  const minimized = privateAuditSnapshot(value);
  if (!object(value) || !object(minimized)) return minimized;
  // H50: only an explicitly untargeted announcement is a public broadcast.
  if (entityType === "announcement") {
    const targeting = [
      value.recipient_user_ids ?? value.recipientUserIds,
      value.role_ids ?? value.roleIds,
      value.intolerance_ids ?? value.intoleranceIds,
    ];
    const broadcast =
      value.audit_audience === "broadcast" ||
      targeting.every((ids) => Array.isArray(ids) && ids.length === 0);
    if (
      value.audit_audience === "restricted" ||
      !broadcast ||
      targeting.some((ids) => Array.isArray(ids) && ids.length > 0)
    )
      return minimized;
    // Keep the empty audience markers so a second minimization retains the same classification.
    for (const key of [
      "role_ids",
      "roleIds",
      "recipient_user_ids",
      "recipientUserIds",
      "intolerance_ids",
      "intoleranceIds",
    ])
      if (Array.isArray(value[key]) && value[key].length === 0) minimized[key] = [];
  }
  if (["application", "event_config"].includes(entityType))
    for (const [field, item] of Object.entries(value))
      if (typeof item === "boolean") minimized[field] = item;
  for (const field of PUBLIC_CONTENT_FIELDS[entityType] ?? []) {
    if (Object.hasOwn(value, field)) minimized[field] = publicContent(value[field], field);
  }
  return minimized;
}
