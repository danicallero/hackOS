import type pg from "pg";

import type { TemplateField } from "../applications/schemas.js";

import type { AnonymousAuditField, AnonymousAuditValue, UserRemovalRow } from "./types.js";

function firstResponseValue(responses: Record<string, unknown>, key: string): unknown {
  if (Object.hasOwn(responses, key)) return responses[key];
  const wanted = key.toLowerCase();
  const found = Object.entries(responses).find(([candidate]) => candidate.toLowerCase() === wanted);
  return found?.[1];
}

function textValue(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Application answers are user-controlled. Even when an administrator has
 * explicitly opted a field into anonymous audit retention, direct identity
 * tokens are rejected from string values. A false positive drops one optional
 * audit value; a false negative would create a new identity copy (H54).
 */
function safeDemographicText(
  value: unknown,
  maxLength: number,
  user: Pick<UserRemovalRow, "email" | "name" | "surname" | "dni"> & {
    historicalEmails?: readonly string[];
  },
): string | null {
  const text = textValue(value, maxLength);
  if (!text) return null;
  const folded = text.normalize("NFKC").toLocaleLowerCase();
  const directTokens = [user.email, user.dni, ...(user.historicalEmails ?? [])]
    .filter((token): token is string => typeof token === "string" && token.trim().length >= 3)
    .map((token) => token.normalize("NFKC").toLocaleLowerCase());
  if (directTokens.some((token) => folded.includes(token))) return null;

  const nameTokens = [user.name, user.surname]
    .filter((token): token is string => typeof token === "string" && token.trim().length >= 3)
    .map((token) => escapeRegExp(token.normalize("NFKC").toLocaleLowerCase().trim()));
  if (
    nameTokens.some((token) =>
      new RegExp(`(?:^|[^\\p{L}\\p{N}])${token}(?=$|[^\\p{L}\\p{N}])`, "u").test(folded),
    )
  ) {
    return null;
  }
  if (
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text) ||
    /\b(?:https?:\/\/|www\.)\S+/i.test(text) ||
    /(?:^|[^\d])\+?\d[\d\s().-]{6,}\d(?:$|[^\d])/.test(text)
  ) {
    return null;
  }
  return text;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d{1,4}$/.test(value.trim())) return Number(value);
  return null;
}

function ageFromDate(value: unknown, asOf: Date): number | null {
  const text = textValue(value, 40);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  let age = asOf.getUTCFullYear() - date.getUTCFullYear();
  const beforeBirthday =
    asOf.getUTCMonth() < date.getUTCMonth() ||
    (asOf.getUTCMonth() === date.getUTCMonth() && asOf.getUTCDate() < date.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age <= 150 ? age : null;
}

/** A birth year intentionally has no day/month precision. Age therefore uses
 * the event year, matching the aggregate application-statistics transform. */
function ageFromBirthYear(value: unknown, asOf: Date): number | null {
  const year = numericValue(value);
  if (year == null) return null;
  const age = asOf.getUTCFullYear() - year;
  return age >= 0 && age <= 150 ? age : null;
}

async function applicationUniversityValue(
  client: pg.PoolClient,
  value: unknown,
  identity: Pick<UserRemovalRow, "email" | "name" | "surname" | "dni"> & {
    historicalEmails?: readonly string[];
  },
  cachedNames: Map<number, string | null>,
): Promise<string | null> {
  const id = numericValue(value);
  if (id != null) {
    if (!cachedNames.has(id)) {
      const { rows } = await client.query<{ name: string }>(
        `SELECT name FROM universities WHERE id = $1`,
        [id],
      );
      cachedNames.set(id, rows[0]?.name ?? null);
    }
    // Do not retain an unresolved directory key as if it were the required
    // university value. It is an internal identifier, not an audit label.
    return safeDemographicText(cachedNames.get(id), 200, identity);
  }
  return safeDemographicText(value, 200, identity);
}

async function sanitizeAnonymousAuditValue(
  client: pg.PoolClient,
  field: TemplateField,
  value: unknown,
  identity: Pick<UserRemovalRow, "email" | "name" | "surname" | "dni"> & {
    historicalEmails?: readonly string[];
  },
  universityNames: Map<number, string | null>,
  asOf: Date,
): Promise<AnonymousAuditValue | null> {
  // Personal files are never copied into the permanent anonymous dataset,
  // even if a future admin accidentally enables retention on a file field.
  if (field.kind === "file" || field.kind === "images") return null;

  const dimension = field.anonymous_audit_dimension ?? null;
  if (field.kind === "university") {
    const university = await applicationUniversityValue(client, value, identity, universityNames);
    return university;
  }

  if (field.kind === "date" && dimension === "age") {
    return ageFromDate(value, asOf);
  }

  if (field.kind === "birth_year" && dimension === "age") {
    return ageFromBirthYear(value, asOf);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (dimension === "age" && (!Number.isInteger(value) || value < 0 || value > 150)) {
      return null;
    }
    if (
      dimension === "graduation_year" &&
      (!Number.isInteger(value) || value < 1900 || value > 2200)
    ) {
      return null;
    }
    return value;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (field.kind === "number") {
      const number = numericValue(value);
      if (number == null) return null;
      if (dimension === "age" && (number < 0 || number > 150)) return null;
      if (dimension === "graduation_year" && (number < 1900 || number > 2200)) return null;
      return number;
    }
    return safeDemographicText(value, field.kind === "textarea" ? 4000 : 500, identity);
  }
  if (Array.isArray(value)) {
    const sanitized: Array<string | number | boolean> = [];
    for (const item of value.slice(0, 100)) {
      if (typeof item === "boolean") sanitized.push(item);
      else if (typeof item === "number" && Number.isFinite(item)) sanitized.push(item);
      else if (typeof item === "string") {
        const text = safeDemographicText(item, 200, identity);
        if (text != null) sanitized.push(text);
      }
    }
    return sanitized.length > 0 ? sanitized : null;
  }
  return null;
}

/**
 * Copy only explicitly retained fields from the immutable form snapshot tied
 * to each submitted response. Missing answers are skipped; no current mutable
 * form, label, or hardcoded demographic list participates in this decision.
 */
export async function extractAnonymousAuditFields(
  client: pg.PoolClient,
  user: UserRemovalRow,
): Promise<AnonymousAuditField[]> {
  // Email changes are intentionally retained only in this transient table so
  // cleanup can find legacy denormalized copies. They are also identity
  // tokens: an old address must not be copied into a supposedly anonymous
  // demographic answer after the current users.email has changed (H54).
  const { rows: historicalEmailRows } = await client.query<{ email: string }>(
    `SELECT email FROM user_email_history WHERE user_id = $1`,
    [user.id],
  );
  const identity = {
    ...user,
    historicalEmails: historicalEmailRows.map((row) => row.email),
  };
  const universityNames = new Map<number, string | null>();

  const { rows } = await client.query<{
    responses: Record<string, unknown>;
    application_id: number;
    form_version: number;
    template: unknown;
  }>(
    `SELECT ar.responses, ar.application_id, fv.version AS form_version, fv.template
       FROM application_responses ar
       JOIN application_form_versions fv ON fv.id = ar.application_form_version_id
      WHERE ar.user_id = $1
        AND ar.status <> 'draft'
      ORDER BY ar.id`,
    [user.id],
  );
  const asOf = new Date();
  const retained: AnonymousAuditField[] = [];
  for (const row of rows) {
    const fields = Array.isArray(row.template) ? row.template : [];
    for (const candidate of fields) {
      if (!candidate || typeof candidate !== "object") continue;
      const field = candidate as TemplateField;
      const key = typeof field.key === "string" ? field.key : "";
      if (!key) continue;
      if (field.retention_mode !== "anonymous_audit") continue;
      const value = firstResponseValue(row.responses ?? {}, key);
      if (value === undefined || value === null) continue;
      const sanitized = await sanitizeAnonymousAuditValue(
        client,
        field,
        value,
        identity,
        universityNames,
        asOf,
      );
      if (sanitized == null) continue;
      retained.push({
        applicationId: row.application_id,
        applicationFormVersion: row.form_version,
        fieldKey: key,
        dimension:
          typeof field.anonymous_audit_dimension === "string"
            ? field.anonymous_audit_dimension
            : null,
        fieldKind: field.kind,
        value: sanitized,
      });
    }
  }
  return retained;
}
