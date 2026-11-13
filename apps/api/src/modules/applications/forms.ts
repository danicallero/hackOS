import type pg from "pg";

import type { Queryable } from "../../db/pool.js";

import { pool } from "../../db/pool.js";

import { NotFoundError } from "../../lib/errors.js";

import type { FormSection, TemplateField } from "./schemas.js";

import type { ApplicationRow } from "./types.js";

/**
 * Persist an explicit minimising policy for every field.  The field schema is
 * intentionally open to future retention modes, but this service only copies
 * values whose submitted definition says `anonymous_audit`.
 */
export function normalizeTemplateForStorage(template: TemplateField[]): TemplateField[] {
  return template.map((field) => ({
    ...field,
    retention_mode: field.retention_mode ?? "none",
  }));
}

/** Configuration-only summary for audit history; never includes response values. */
export function anonymousRetentionConfiguration(template: TemplateField[]) {
  return normalizeTemplateForStorage(template)
    .filter((field) => field.retention_mode === "anonymous_audit")
    .map((field) => ({
      key: field.key,
      kind: field.kind,
      dimension: field.anonymous_audit_dimension ?? null,
    }));
}

export interface ApplicationFormVersion {
  id: number | string;
  application_id: number;
  version: number;
  template: TemplateField[];
  sections: FormSection[];
}

/** Return the current immutable form version, creating it only for a newly
 * created form whose initial snapshot has not been inserted yet. Responses
 * must always point at their own version; callers never repair an existing
 * response against the mutable form. */
export async function ensureApplicationFormVersion(
  client: pg.PoolClient,
  app: Pick<ApplicationRow, "id" | "template" | "sections" | "current_form_version">,
  createdBy: number | null = null,
): Promise<ApplicationFormVersion> {
  const version = Number(app.current_form_version ?? 1);
  const existing = await client.query<ApplicationFormVersion>(
    `SELECT id, application_id, version, template, sections
       FROM application_form_versions
      WHERE application_id = $1 AND version = $2`,
    [app.id, version],
  );
  if (existing.rows[0]) return existing.rows[0];

  await client.query(
    `INSERT INTO application_form_versions
       (application_id, version, template, sections, created_by)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
     ON CONFLICT (application_id, version) DO NOTHING`,
    [
      app.id,
      version,
      JSON.stringify(normalizeTemplateForStorage(app.template ?? [])),
      JSON.stringify(app.sections ?? []),
      createdBy,
    ],
  );
  const { rows } = await client.query<ApplicationFormVersion>(
    `SELECT id, application_id, version, template, sections
       FROM application_form_versions
      WHERE application_id = $1 AND version = $2`,
    [app.id, version],
  );
  if (!rows[0]) throw new Error("Application form version could not be created");
  return rows[0];
}

// ── loaders ──────────────────────────────────────────────────────────────────

async function getApplication(db: Queryable, id: number): Promise<ApplicationRow | undefined> {
  const { rows } = await db.query(`SELECT * FROM applications WHERE id = $1`, [id]);
  return rows[0];
}

export async function requireApplication(db: Queryable, id: number): Promise<ApplicationRow> {
  const app = await getApplication(db, id);
  if (!app) throw new NotFoundError("Application not found");
  return app;
}

/** Open for a NEW draft (H11) = past open_at, before close_at (close optional). */
export function isWindowOpen(app: ApplicationRow, now = new Date()): boolean {
  if (app.open_at && app.open_at > now) return false;
  if (app.close_at && app.close_at <= now) return false;
  return true;
}

// ── template / response validation (H12) ─────────────────────────────────────

/**
 * Pull the national-ID answer out of a response object regardless of the exact
 * key casing the form template used ("dni", "DNI", "Dni"…). Returns a trimmed
 * string, or null when absent/blank so a COALESCE keeps the prior value.
 */
export function extractDni(responses: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(responses)) {
    if (key.toLowerCase() !== "dni") continue;
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/**
 * Dietary answers are validated with the rest of the form, then persisted only
 * on the user row. Drafts may temporarily contain them so applicants can resume
 * before submit, but no submitted/staff-edited response JSON may retain a copy.
 */
export function stripDietaryResponses(responses: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...responses };
  delete sanitized.food_intolerances;
  delete sanitized.food_intolerance_notes;
  return sanitized;
}

/** The event's configured shirt-size options (H12) — same source every picker in the app reads from. */
async function readShirtSizes(): Promise<string[]> {
  const { rows } = await pool.query(`SELECT shirt_sizes FROM event_config WHERE id = 1`);
  return rows[0]?.shirt_sizes ?? ["XS", "S", "M", "L", "XL", "XXL"];
}

function shirtSizeField(sizes: string[]): TemplateField {
  return {
    key: "shirt_size",
    label: { en: "T-shirt size", es: "Talla de camiseta", gl: "Talla de camiseta" },
    kind: "select",
    required: true,
    options: sizes.map((s) => ({ value: s, label: { en: s, es: s, gl: s } })),
  };
}

/** If the application asks for a shirt size, append the field to the template. */
async function augmentTemplate(
  askShirtSize: boolean,
  template: TemplateField[],
): Promise<TemplateField[]> {
  if (!askShirtSize) return template;
  if (template.some((f) => f.key === "shirt_size")) return template;
  return [...template, shirtSizeField(await readShirtSizes())];
}

const FOOD_NOTES_FIELD: TemplateField = {
  key: "food_intolerance_notes",
  label: { en: "Dietary notes", es: "Notas dietéticas", gl: "Notas dietéticas" },
  kind: "textarea",
  required: false,
};

/**
 * Enrich the template with dynamically-loaded fields (food intolerances) when
 * the application asks for them. Async because it queries the DB for the
 * current set of food-intolerance options.
 */
export async function enrichTemplate(
  app: Pick<ApplicationRow, "ask_shirt_size" | "ask_food_intolerances">,
  template: TemplateField[],
): Promise<TemplateField[]> {
  let enriched = await augmentTemplate(app.ask_shirt_size, template);
  if (app.ask_food_intolerances && !enriched.some((f) => f.key === "food_intolerances")) {
    const { rows } = await pool.query(`SELECT id, label FROM food_intolerances ORDER BY id`);
    const intolerances: TemplateField = {
      key: "food_intolerances",
      label: {
        en: "Dietary restrictions",
        es: "Restricciones dietéticas",
        gl: "Restricións dietéticas",
      },
      kind: "multiselect",
      required: false,
      options: rows.map((r: { id: number; label: { en: string } }) => ({
        value: String(r.id),
        label: { en: r.label.en, es: r.label.en, gl: r.label.en },
      })),
    };
    enriched = [...enriched, intolerances, FOOD_NOTES_FIELD];
  }
  return enriched;
}

// ── privacy notice (H12) ─────────────────────────────────────────────────────

const PRIVACY_NOTICE_EN =
  "Your dietary restrictions are stored only to plan meals for participants who confirm their spot.";

const PRIVACY_NOTICE: Record<string, string> = {
  en: PRIVACY_NOTICE_EN,
  es: "Tus restricciones alimenticias se guardan solo para planificar las comidas de quienes confirman su plaza.",
  gl: "As túas restricións alimenticias gárdanse só para planificar as comidas de quen confirma a súa praza.",
};

export function privacyNotice(language: string | null | undefined): string {
  return PRIVACY_NOTICE[language ?? "en"] ?? PRIVACY_NOTICE_EN;
}

// ── invited-participant check (E) ───────────────────────────────────────────

/**
 * Check whether a user was created via a participant invitation
 * (kind=participant account_claim). Invited participants bypass the
 * application window (both to write — H10 — and to read/discover a closed
 * form, H10 gap) and auto-confirm on submit.
 */
export async function isInvitedParticipant(client: Queryable, userId: number): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM email_verification_tokens
     WHERE user_id = $1 AND type = 'account_claim' AND kind = 'participant' AND used_at IS NOT NULL
     LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}
