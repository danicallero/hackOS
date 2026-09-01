import { randomBytes } from "node:crypto";
import { sponsorShareKey } from "@hackos/shared/applications";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type pg from "pg";
import { config } from "../../config.js";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { assertVerifiedPrimaryEmail } from "../../lib/email-verification.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { hasEventAccess } from "../identity/role.js";
import { assertFixtureSubjectScope } from "../logistics/review-fixture-scope.js";
import { issueTicket } from "../logistics/tickets.js";
import { issueWalletAccessToken } from "../logistics/wallet-access.js";
import { voidTicketPasses } from "../logistics/wallet-passes.js";
import { enqueueWalletSync } from "../logistics/wallet-sync.js";
import type { FormSection, TemplateField } from "./schemas.js";

/**
 * Applications domain service (H11-H15, H27, H56). Holds the state-machine
 * transitions (plan/07 §3: draft -> submitted -> review -> accepted|rejected;
 * accepted -> confirmed|declined|expired), the sensitive-data privacy
 * semantics (H12) and the confirm/decline/expire mechanics shared by the
 * three confirmation routes (H15) and the expirer worker (plan/07 §5.2).
 */

export interface ApplicationRow {
  id: number;
  name: string;
  /** DEPRECATED (H8): legacy static classification, no longer set by the API
   *  or read as authoritative — see application_grants_roles +
   *  roles.badge_category (formGrantsMentorRole below, granted_badge_category
   *  in admin.routes.ts) for the real, drift-proof classification. */
  type: string | null;
  template: TemplateField[];
  sections: FormSection[];
  current_form_version: number;
  description: string | null;
  active: boolean;
  open_at: Date | null;
  close_at: Date | null;
  capacity: number | null;
  confirmation_window_hours: number;
  ask_shirt_size: boolean;
  ask_food_intolerances: boolean;
  created_at: Date;
}

export interface ResponseRow {
  id: number;
  user_id: number;
  application_id: number;
  application_form_version_id: number | string;
  status: string;
  responses: Record<string, unknown>;
  staff_notes: string | null;
  confirmation_token_id: number | null;
  confirmed_at: Date | null;
  declined_at: Date | null;
  decision_sent_at: Date | null;
  submitted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type ConfirmVia = "email_link" | "web" | "admin_override";

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

export async function getApplication(
  db: Queryable,
  id: number,
): Promise<ApplicationRow | undefined> {
  const { rows } = await db.query(`SELECT * FROM applications WHERE id = $1`, [id]);
  return rows[0];
}

export async function requireApplication(db: Queryable, id: number): Promise<ApplicationRow> {
  const app = await getApplication(db, id);
  if (!app) throw new NotFoundError("Application not found");
  return app;
}

/**
 * H8: whether a form's `grants_role_ids` include a role identified as the
 * real "Mentor" role by its durable `badge_category` (see roles.badge_category,
 * 0800_roles_schema.sql) — never by matching the role's editable display
 * name, which is exactly as driftable as the retired `applications.type ===
 * "mentor"` string check this replaces. Powers the early-ticket-issuance
 * special case below (sendOne/reAccept): accepted mentors attend without a
 * separate spot-confirmation step, so their decision itself is the
 * ticket-issuing transition, unlike every other applicant who waits for
 * confirm.
 */
async function formGrantsMentorRole(
  client: pg.PoolClient,
  applicationId: number,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1
       FROM application_grants_roles agr
       JOIN roles r ON r.id = agr.role_id AND r.deleted_at IS NULL
      WHERE agr.application_id = $1 AND r.badge_category = 'mentor'
      LIMIT 1`,
    [applicationId],
  );
  return rows.length > 0;
}

/** Open for a NEW draft = active, past open_at, before close_at (close optional). */
export function isWindowOpen(app: ApplicationRow, now = new Date()): boolean {
  if (!app.active) return false;
  if (app.open_at && app.open_at > now) return false;
  if (app.close_at && app.close_at <= now) return false;
  return true;
}

// ── template / response validation (H12) ─────────────────────────────────────

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

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
 * Builder-defined validation rules (H11) on top of the kind-shape check —
 * length/pattern for text, min/max for number, selection count for
 * multiselect. `field.validation`'s sub-fields not relevant to `field.kind`
 * are ignored rather than erroring, so switching kind mid-edit is harmless.
 * Only called once the value has already passed its kind-shape check, so the
 * type narrowing below (string/number/array) is safe.
 */
const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// A scheme (http:// or https://) is optional — applicants shouldn't have to
// type it themselves for this to count as a URL, just a domain-shaped value.
const SIMPLE_URL_RE = /^(https?:\/\/)?[^\s/$.?#][^\s]*\.[^\s]{2,}$/i;

function checkFieldValidation(field: TemplateField, value: unknown): string | null {
  const v = field.validation;
  if (!v) return null;
  if ((field.kind === "text" || field.kind === "textarea") && typeof value === "string") {
    if (v.min_length !== undefined && value.length < v.min_length) return "too short";
    if (v.max_length !== undefined && value.length > v.max_length) return "too long";
    if (v.pattern !== undefined && !new RegExp(v.pattern).test(value)) return "invalid format";
    if (v.text_condition === "contains" && v.text_value && !value.includes(v.text_value)) {
      return "must contain text";
    }
    if (v.text_condition === "not_contains" && v.text_value && value.includes(v.text_value)) {
      return "must not contain text";
    }
    if (v.text_condition === "email" && !SIMPLE_EMAIL_RE.test(value)) return "invalid email";
    if (v.text_condition === "url" && !SIMPLE_URL_RE.test(value)) return "invalid url";
  }
  if (field.kind === "number" && typeof value === "number") {
    if (v.min !== undefined && value < v.min) return "too small";
    if (v.max !== undefined && value > v.max) return "too large";
  }
  if (field.kind === "multiselect" && Array.isArray(value)) {
    if (v.min_selected !== undefined && value.length < v.min_selected) return "too few selected";
    if (v.max_selected !== undefined && value.length > v.max_selected) return "too many selected";
  }
  return null;
}

/**
 * Validate a response object against the form template. Required fields are
 * only enforced here (called at submit, never while drafting — H12). Also
 * type-checks each provided value against its field kind.
 */
export function validateResponses(
  template: TemplateField[],
  responses: Record<string, unknown>,
): void {
  const errors: Record<string, string> = {};
  for (const field of template) {
    const value = responses[field.key];
    if (isEmpty(value)) {
      if (field.required) errors[field.key] = "required";
      continue;
    }
    switch (field.kind) {
      case "number":
        if (typeof value !== "number") errors[field.key] = "must be a number";
        break;
      case "checkbox":
        if (typeof value !== "boolean") errors[field.key] = "must be a boolean";
        else if (field.required && value !== true) errors[field.key] = "required";
        break;
      case "multiselect": {
        if (!Array.isArray(value)) {
          errors[field.key] = "must be an array";
          break;
        }
        const allowed = new Set((field.options ?? []).map((o) => o.value));
        if (value.some((v) => !allowed.has(String(v)))) errors[field.key] = "invalid option";
        break;
      }
      case "select": {
        const allowed = new Set((field.options ?? []).map((o) => o.value));
        if (!allowed.has(String(value))) errors[field.key] = "invalid option";
        break;
      }
      case "file":
        if (typeof value !== "string") errors[field.key] = "must be a string";
        break;
      case "university":
        // The value is a shared-library university id. The picker sends a
        // number, but accept a numeric string too (legacy rows / staff edits)
        // so a valid id is never rejected on a type technicality.
        if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) {
          errors[field.key] = "must be a university id";
        }
        break;
      default:
        if (typeof value !== "string") errors[field.key] = "must be a string";
    }
    // H11: builder-defined response validation, on top of the kind-shape
    // check above (skipped once that already failed for this field).
    if (!errors[field.key] && field.validation) {
      const validationError = checkFieldValidation(field, value);
      if (validationError) errors[field.key] = validationError;
    }
    // H56: an applicant's consent to share a file with sponsors is optional,
    // never required, and only meaningful on a field the organizer marked so.
    if (field.kind === "file" && field.shareable_with_sponsors) {
      const shared = responses[sponsorShareKey(field.key)];
      if (shared !== undefined && typeof shared !== "boolean") {
        errors[sponsorShareKey(field.key)] = "must be a boolean";
      }
    }
  }
  if (Object.keys(errors).length > 0) {
    throw new BadRequestError("Response fails template validation", { fields: errors });
  }
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
export async function augmentTemplate(
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

// ── countdown formatting ──────────────────────────────────────────────────────

function formatRemainingTime(expiresAt: Date): string {
  const remainingMs = expiresAt.getTime() - Date.now();
  if (remainingMs <= 0) return "";
  const totalMinutes = Math.floor(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  return parts.length > 0 ? `You have ${parts.join(", ")} to confirm.` : "";
}

// ── tokens / tickets / emails ─────────────────────────────────────────────────

/**
 * Issue a fresh spot_confirmation token (email_verification_tokens) whose
 * expiry mirrors decision_sent_at + confirmation_window_hours, supersede any
 * prior one, and point the response at it.
 */
async function issueConfirmationToken(
  client: pg.PoolClient,
  response: { id: number; user_id: number },
  app: ApplicationRow,
  email: string,
): Promise<string> {
  await client.query(
    `UPDATE email_verification_tokens SET used_at = now()
     WHERE user_id = $1 AND type = 'spot_confirmation' AND used_at IS NULL`,
    [response.user_id],
  );
  const token = randomBytes(32).toString("base64url");
  const { rows } = await client.query(
    `INSERT INTO email_verification_tokens (token, type, email, user_id, expires_at)
     VALUES ($1, 'spot_confirmation', $2, $3, now() + make_interval(hours => $4))
     RETURNING id`,
    [token, email, response.user_id, app.confirmation_window_hours],
  );
  await client.query(`UPDATE application_responses SET confirmation_token_id = $1 WHERE id = $2`, [
    rows[0].id,
    response.id,
  ]);
  return token;
}

interface UserComms {
  email: string;
  name: string | null;
  language: string;
}

async function loadUserComms(client: pg.PoolClient, userId: number): Promise<UserComms> {
  const { rows } = await client.query(
    `SELECT email, name, language FROM users
      WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
    [userId],
  );
  if (!rows[0]) throw new NotFoundError("User not found");
  return rows[0];
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

// ── create / update draft (H12) ──────────────────────────────────────────────

export async function saveDraft(
  userId: number,
  applicationId: number,
  responses: Record<string, unknown>,
): Promise<ResponseRow> {
  return withTransaction(async (client) => {
    // Removal owns the user row before it scrubs application responses. Keep
    // the same user-first lock order here so a draft cannot be inserted or
    // updated after the account enters removal_pending.
    const { rows: userRows } = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!userRows[0]) throw new NotFoundError("User not found");
    const app = await requireApplication(client, applicationId);
    const currentForm = await ensureApplicationFormVersion(client, app);
    const invited = await isInvitedParticipant(client, userId);

    const { rows } = await client.query(
      `SELECT * FROM application_responses WHERE user_id = $1 AND application_id = $2 FOR UPDATE`,
      [userId, applicationId],
    );
    const existing = rows[0] as ResponseRow | undefined;

    if (!existing) {
      // 409 if the window is closed for a brand-new draft (H12), unless the
      // user is an invited participant (E: they can always create drafts).
      if (!isWindowOpen(app) && !invited) {
        throw new ConflictError("Applications are closed for this form", { applicationId });
      }
      const inserted = await client.query(
        `INSERT INTO application_responses
           (user_id, application_id, application_form_version_id, responses, status)
         VALUES ($1, $2, $3, $4::jsonb, 'draft') RETURNING *`,
        [userId, applicationId, currentForm.id, JSON.stringify(responses)],
      );
      return inserted.rows[0];
    }

    // Existing draft stays editable until submit; anything past draft is locked.
    if (existing.status !== "draft") {
      throw new ConflictError("This application has already been submitted", {
        status: existing.status,
      });
    }
    if (existing.application_form_version_id == null) {
      throw new ConflictError("This draft has no immutable form version and must be restarted", {
        code: "form_version_required",
      });
    }
    const updated = await client.query(
      `UPDATE application_responses
          SET responses = $3::jsonb
        WHERE id = $1 AND user_id = $2 RETURNING *`,
      [existing.id, userId, JSON.stringify(responses)],
    );
    return updated.rows[0];
  });
}

// ── submit (H12) ─────────────────────────────────────────────────────────────

export interface SubmitInput {
  responses?: Record<string, unknown>;
  food_intolerances: number[];
  food_intolerance_notes?: string | null;
  shirt_size?: string | null;
}

export async function submitResponse(
  userId: number,
  applicationId: number,
  input: SubmitInput,
): Promise<{ response: ResponseRow; privacyNotice: string }> {
  return withTransaction(async (client) => {
    const app = await requireApplication(client, applicationId);

    const { rows: userRows } = await client.query(
      `SELECT email_verified, language FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!userRows[0]) throw new NotFoundError("User not found");
    // plan/07 invariant 8: no advancing past submitted without a verified email.
    if (!userRows[0].email_verified) {
      throw new ForbiddenError("Verify your email before submitting", {
        code: "email_not_verified",
      });
    }

    const { rows } = await client.query(
      `SELECT * FROM application_responses WHERE user_id = $1 AND application_id = $2 FOR UPDATE`,
      [userId, applicationId],
    );
    const existing = rows[0] as ResponseRow | undefined;
    if (!existing) throw new NotFoundError("Draft not found — save a draft first");
    if (existing.status !== "draft") {
      throw new ConflictError("This application has already been submitted", {
        status: existing.status,
      });
    }

    const versionRows = await client.query<ApplicationFormVersion>(
      `SELECT id, application_id, version, template, sections
         FROM application_form_versions
        WHERE id = $1 AND application_id = $2`,
      [existing.application_form_version_id, applicationId],
    );
    const formVersion = versionRows.rows[0];
    if (!formVersion) {
      throw new ConflictError("This response is missing its immutable form version", {
        code: "form_version_required",
      });
    }

    const merged = { ...existing.responses, ...(input.responses ?? {}) };
    const shirtSize = input.shirt_size ?? (merged.shirt_size as string | undefined);
    if (input.shirt_size) merged.shirt_size = input.shirt_size;

    const invited = await isInvitedParticipant(client, userId);

    // Invited participants already gave shirt & food at invite accept; skip
    // the required check and preserve existing values when not re-submitted.
    if (!invited && app.ask_shirt_size && !shirtSize) {
      throw new BadRequestError("Shirt size is required for this application type", {
        code: "shirt_size_required",
      });
    }

    // Extract food data from responses if not provided as top-level fields.
    // For invited participants fall back to their existing user row data.
    let foodIntolerances: number[];
    let foodNotes: string | null;
    if (invited && input.food_intolerances.length === 0 && !merged.food_intolerances) {
      const { rows: userFood } = await client.query(
        `SELECT food_intolerances, food_intolerance_notes FROM users
          WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
        [userId],
      );
      foodIntolerances = userFood[0]?.food_intolerances ?? [];
      foodNotes = userFood[0]?.food_intolerance_notes ?? null;
    } else {
      foodIntolerances = (
        input.food_intolerances.length > 0
          ? input.food_intolerances
          : ((merged.food_intolerances as number[] | undefined) ?? [])
      ).map(Number);
      foodNotes =
        input.food_intolerance_notes ??
        (merged.food_intolerance_notes as string | undefined) ??
        null;
    }

    // If the form carries a national-ID question (key "dni", any case), mirror
    // its answer onto users.dni — a first-class identity field, like shirt size
    // and food intolerances above (M1: the "DNI" sync; "DNA" in the brief was a
    // typo for DNI). Only non-empty string answers overwrite an existing value.
    const dni = extractDni(merged);

    const enrichedTemplate = await enrichTemplate(app, formVersion.template);
    validateResponses(enrichedTemplate, merged);
    const storedResponses = stripDietaryResponses(merged);

    // Sensitive/logistics data lives on the user row, not the response (H12).
    await client.query(
      `UPDATE users
       SET food_intolerances = $2,
           food_intolerance_notes = $3,
           dietary_data_state = CASE
             WHEN cardinality($2::integer[]) > 0 OR NULLIF(BTRIM($3::text), '') IS NOT NULL
             THEN 'present'
             ELSE 'not_provided'
           END,
           shirt_size = COALESCE($4, shirt_size),
           dni = COALESCE($5, dni)
       WHERE id = $1`,
      [userId, foodIntolerances, foodNotes, shirtSize ?? null, dni],
    );

    const updated = await client.query(
      `UPDATE application_responses
       SET responses = $3::jsonb,
           status = $4,
           submitted_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [existing.id, userId, JSON.stringify(storedResponses), invited ? "confirmed" : "review"],
    );

    if (invited) {
      // Auto-confirm: issue ticket, stamp confirmed_at, audit confirmed.
      await client.query(`UPDATE application_responses SET confirmed_at = now() WHERE id = $1`, [
        existing.id,
      ]);
      await issueTicket(client, userId);
      await audit(client, {
        actorId: userId,
        entityType: "application_response",
        entityId: existing.id,
        action: "confirmed",
        source: "web",
        before: { status: "draft" },
        after: { status: "confirmed" },
      });
    }

    await audit(client, {
      actorId: userId,
      entityType: "application_response",
      entityId: existing.id,
      action: "submitted",
      source: "web",
      after: { status: invited ? "confirmed" : "review" },
    });

    return {
      response: { ...updated.rows[0], status: invited ? "confirmed" : "review" },
      privacyNotice: privacyNotice(userRows[0].language),
    };
  });
}

// ── review (H13) ─────────────────────────────────────────────────────────────

export async function upsertReview(
  authorId: number,
  responseId: number,
  score: number | null | undefined,
  notes: string | null | undefined,
): Promise<void> {
  await withTransaction(async (client) => {
    await lockResponse(client, responseId, authorId); // ensures the response exists and is in scope
    await client.query(
      `INSERT INTO applicant_reviews (response_id, author_id, score, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (response_id, author_id)
       DO UPDATE SET score = EXCLUDED.score, notes = EXCLUDED.notes`,
      [responseId, authorId, score ?? null, notes ?? null],
    );
    await audit(client, {
      actorId: authorId,
      entityType: "application_response",
      entityId: responseId,
      action: "review_scored",
      after: { score: score ?? null },
    });
  });
}

export async function setStaffNotes(
  actorId: number,
  responseId: number,
  staffNotes: string | null,
): Promise<void> {
  await withTransaction(async (client) => {
    await lockResponse(client, responseId, actorId);
    await client.query(`UPDATE application_responses SET staff_notes = $2 WHERE id = $1`, [
      responseId,
      staffNotes,
    ]);
    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: responseId,
      action: "staff_notes_updated",
    });
  });
}

async function lockResponse(
  client: pg.PoolClient,
  responseId: number,
  actorId?: number,
): Promise<ResponseRow> {
  // Resolve the owner without locking the response first. Account removal
  // locks users before their application rows; every staff transition must do
  // the same or it can race the lifecycle gate (and deadlock with the scrub).
  const { rows: targetRows } = await client.query(
    `SELECT user_id FROM application_responses WHERE id = $1`,
    [responseId],
  );
  if (actorId != null) {
    const targetUserId = Number(targetRows[0]?.user_id);
    if (!targetRows[0]) throw new NotFoundError("Response not found");
    const { rows: userRows } = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [targetUserId],
    );
    if (!userRows[0]) throw new NotFoundError("Response not found");
    await assertFixtureSubjectScope(client, actorId, targetUserId);
  }
  const { rows } = await client.query(
    `SELECT * FROM application_responses WHERE id = $1 FOR UPDATE`,
    [responseId],
  );
  if (!rows[0]) throw new NotFoundError("Response not found");
  return rows[0];
}

/**
 * H1/H15: resolve the target without locking it, lock the target user's
 * verification state first, then lock the response. This matches submit's
 * user→response order and avoids a deadlock when a submit races a token
 * confirmation or decline.
 */
async function lockVerifiedResponseByToken(
  client: pg.PoolClient,
  token: string,
  action: "confirmation" | "decline",
): Promise<ResponseRow> {
  const { rows: targetRows } = await client.query(
    `SELECT r.id, r.user_id FROM email_verification_tokens t
     JOIN application_responses r ON r.id =
       (SELECT id FROM application_responses WHERE confirmation_token_id = t.id)
     WHERE t.token = $1 AND t.type = 'spot_confirmation'`,
    [token],
  );
  const target = targetRows[0] as { id: number; user_id: number } | undefined;
  if (!target) throw new NotFoundError(`Invalid ${action} token`);
  await assertVerifiedPrimaryEmail(client, target.user_id, { forUpdate: true });

  const { rows } = await client.query(
    `SELECT r.* FROM email_verification_tokens t
     JOIN application_responses r ON r.id =
       (SELECT id FROM application_responses WHERE confirmation_token_id = t.id)
     WHERE t.token = $1 AND t.type = 'spot_confirmation' AND r.id = $2
     FOR UPDATE OF r`,
    [token, target.id],
  );
  if (!rows[0]) throw new NotFoundError(`Invalid ${action} token`);
  return rows[0];
}

/** Invalidates a pending confirmation token, if one exists. */
async function invalidateConfirmationToken(client: pg.PoolClient, tokenId: number): Promise<void> {
  await client.query(
    `UPDATE email_verification_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
    [tokenId],
  );
}

/**
 * Throws ConflictError when `capacity` is already reached. Takes the
 * already-loaded capacity rather than loading it itself, since callers load
 * the application row under different locking strategies (e.g. `decide`'s
 * `FOR UPDATE` serializes concurrent accepts — this helper must not weaken
 * that by re-reading it unlocked).
 */
async function assertCapacityAvailable(
  client: pg.PoolClient,
  applicationId: number,
  capacity: number,
  excludeResponseId?: number,
): Promise<void> {
  const { rows: countRows } = await client.query(
    excludeResponseId === undefined
      ? `SELECT count(*)::int AS n FROM application_responses
         JOIN users u ON u.id = application_responses.user_id
         WHERE application_responses.application_id = $1 AND u.is_test_account = false
           AND application_responses.status IN ('accepted_internal', 'accepted', 'confirmed')`
      : `SELECT count(*)::int AS n FROM application_responses
         JOIN users u ON u.id = application_responses.user_id
         WHERE application_responses.application_id = $1 AND u.is_test_account = false
           AND application_responses.id <> $2
           AND application_responses.status IN ('accepted_internal', 'accepted', 'confirmed')`,
    excludeResponseId === undefined ? [applicationId] : [applicationId, excludeResponseId],
  );
  if (countRows[0].n >= capacity) {
    throw new ConflictError("Capacity reached for this application", {
      code: "capacity_full",
      capacity,
    });
  }
}

// ── decide (H14) ─────────────────────────────────────────────────────────────

export async function decide(
  actorId: number,
  responseId: number,
  decision: "accepted" | "rejected",
): Promise<ResponseRow> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId, actorId);
    // Serialize capacity checks across parallel accepts on the same form.
    const { rows: appRows } = await client.query(
      `SELECT * FROM applications WHERE id = $1 FOR UPDATE`,
      [resp.application_id],
    );
    const app = appRows[0] as ApplicationRow;

    // "submitted" is a deprecated pre-review state — submitResponse now always
    // lands directly on "review" (or "confirmed" if invited), but rows created
    // before that change can still be stuck at "submitted" with no other path
    // forward (there's no separate start-review step anymore). Treat it as an
    // alias of "review" here so those don't get permanently stranded.
    if (resp.status !== "review" && resp.status !== "submitted") {
      throw new ConflictError("Only reviewed responses can be decided", { status: resp.status });
    }

    if (decision === "accepted" && app.capacity != null) {
      await assertCapacityAvailable(client, resp.application_id, app.capacity);
    }

    const internalStatus = decision === "accepted" ? "accepted_internal" : "rejected_internal";
    const updated = await client.query(
      `UPDATE application_responses SET status = $2 WHERE id = $1 RETURNING *`,
      [responseId, internalStatus],
    );
    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: responseId,
      action: `decided_${decision}`,
      before: { status: "review" },
      after: { status: internalStatus, decision_sent_at: null },
      reason: "internal decision (unsent)",
    });
    return updated.rows[0];
  });
}

/**
 * Revert a decision — flip between accepted_internal and
 * rejected_internal, or send it back to review for re-review.
 * Reverting to accepted re-checks capacity. (H14)
 */
export async function revertDecision(
  actorId: number,
  responseId: number,
  newDecision: "accepted" | "rejected" | "review",
): Promise<ResponseRow> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId, actorId);

    if (newDecision === "review") {
      if (
        resp.status !== "accepted_internal" &&
        resp.status !== "rejected_internal" &&
        resp.status !== "accepted" &&
        resp.status !== "rejected"
      ) {
        throw new ConflictError("Only decided responses can be reverted to review", {
          status: resp.status,
        });
      }
      // Invalidate any pending confirmation token
      if (resp.confirmation_token_id) {
        await invalidateConfirmationToken(client, resp.confirmation_token_id);
      }
      const updated = await client.query(
        `UPDATE application_responses
         SET status = 'review', decision_sent_at = NULL, confirmation_token_id = NULL,
             confirmed_at = NULL, declined_at = NULL
         WHERE id = $1 RETURNING *`,
        [responseId],
      );
      await audit(client, {
        actorId,
        entityType: "application_response",
        entityId: responseId,
        action: "reverted_to_review",
        before: { status: resp.status },
        after: { status: "review" },
      });
      return updated.rows[0];
    }

    // Flip / un-send to an internal decision. Works from an unsent internal
    // decision AND from an already-SENT one (accepted/rejected) — the latter is
    // un-sent: decision_sent_at and any pending confirmation token are dropped
    // so staff can re-decide before re-sending.
    const revertable = ["accepted_internal", "rejected_internal", "accepted", "rejected"];
    if (!revertable.includes(resp.status)) {
      throw new ConflictError("Only a decided response can be reverted to an internal decision", {
        status: resp.status,
      });
    }

    const newInternalStatus =
      newDecision === "accepted" ? "accepted_internal" : "rejected_internal";
    if (resp.status === newInternalStatus) {
      return resp; // idempotent — already this internal decision
    }

    // Re-check capacity when the result is an accepted slot (ignoring this row).
    if (newDecision === "accepted") {
      const { rows: appRows } = await client.query(
        `SELECT * FROM applications WHERE id = $1 FOR UPDATE`,
        [resp.application_id],
      );
      const app = appRows[0] as ApplicationRow;
      if (app.capacity != null) {
        await assertCapacityAvailable(client, resp.application_id, app.capacity, responseId);
      }
    }

    // If it had already been sent, un-send it: clear the sent marker, any
    // pending confirmation token, and confirm/decline stamps.
    if (resp.confirmation_token_id) {
      await invalidateConfirmationToken(client, resp.confirmation_token_id);
    }
    const updated = await client.query(
      `UPDATE application_responses
         SET status = $2, decision_sent_at = NULL, confirmation_token_id = NULL,
             confirmed_at = NULL, declined_at = NULL
       WHERE id = $1 RETURNING *`,
      [responseId, newInternalStatus],
    );
    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: responseId,
      action: `reverted_to_${newDecision}`,
      before: { status: resp.status },
      after: { status: newInternalStatus },
    });
    return updated.rows[0];
  });
}

/** Send one already-decided, still-unsent response (H14). Returns the confirmation token if accepted. */
async function sendOne(
  client: pg.PoolClient,
  actorId: number,
  resp: ResponseRow,
  app: ApplicationRow,
): Promise<string | null> {
  const user = await loadUserComms(client, resp.user_id);
  let token: string | null = null;
  const isAccepted = resp.status === "accepted_internal";
  const sentStatus = isAccepted ? "accepted" : "rejected";
  if (isAccepted) {
    token = await issueConfirmationToken(client, resp, app, user.email);
    // Accepted mentors attend without a separate spot-confirmation step, so
    // their decision is the ticket-issuing transition (H8: keyed off the
    // form's actual grants_role_ids, not a static applications.type).
    if (await formGrantsMentorRole(client, app.id)) await issueTicket(client, resp.user_id);
  }
  await client.query(
    `UPDATE application_responses SET status = $2, decision_sent_at = now() WHERE id = $1`,
    [resp.id, sentStatus],
  );
  await enqueueDecisionEmailRow(
    client,
    resp.user_id,
    user,
    app,
    sentStatus as "accepted" | "rejected",
    token,
  );
  await audit(client, {
    actorId,
    entityType: "application_response",
    entityId: resp.id,
    action: "decision_sent",
    after: { decision: sentStatus },
  });
  return token;
}

export async function sendDecision(
  actorId: number,
  responseId: number,
): Promise<{ response: ResponseRow; confirmationToken: string | null }> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId, actorId);
    if (resp.status !== "accepted_internal" && resp.status !== "rejected_internal") {
      throw new ConflictError("Only internal decisions can be sent", {
        status: resp.status,
      });
    }
    if (resp.decision_sent_at) {
      throw new ConflictError("Decision already sent", { code: "already_sent" });
    }
    const app = await requireApplication(client, resp.application_id);
    const token = await sendOne(client, actorId, resp, app);
    const { rows } = await client.query(`SELECT * FROM application_responses WHERE id = $1`, [
      responseId,
    ]);
    return { response: rows[0], confirmationToken: token };
  });
}

export async function sendDecisionsBatch(
  actorId: number,
  applicationId: number,
  includeRejected: boolean,
): Promise<{ sent: number; tokens: Array<{ responseId: number; token: string | null }> }> {
  // Validate the requested form before discovering candidates. Without this
  // guard a typo/removed application looked like a successful empty batch.
  await requireApplication(pool, applicationId);

  // Do not hold response locks while discovering the batch. Each individual
  // sendDecision() reacquires the target user first, then the response, so an
  // account entering removal_pending is skipped safely instead of receiving a
  // decision or an email during the race.
  const statuses = includeRejected
    ? ["accepted_internal", "rejected_internal"]
    : ["accepted_internal"];
  const { rows } = await pool.query(
    `SELECT r.id FROM application_responses r
       JOIN users u ON u.id = r.user_id
      WHERE r.application_id = $1 AND u.account_state = 'active'
        AND u.anonymized_at IS NULL AND u.is_test_account = false
        AND r.status = ANY($2) AND r.decision_sent_at IS NULL
      ORDER BY r.id`,
    [applicationId, statuses],
  );
  const tokens: Array<{ responseId: number; token: string | null }> = [];
  for (const row of rows as Array<{ id: number }>) {
    try {
      const result = await sendDecision(actorId, Number(row.id));
      tokens.push({ responseId: Number(row.id), token: result.confirmationToken });
    } catch (err) {
      if (err instanceof NotFoundError) {
        // A target can enter removal_pending (or be finalized) after the
        // candidate read. Treat only that expected disappearance as a no-op;
        // provider, transaction and all other business failures must reach the
        // caller instead of silently reporting a partial batch.
        continue;
      }
      throw err;
    }
  }
  return { sent: tokens.length, tokens };
}

/**
 * Resend an already-sent decision (H14/H15). For accepted/expired this
 * regenerates the confirmation token + email (also the expired applicant's
 * second chance); for rejected it just re-enqueues the rejection email. Always
 * an explicit, single-response action — never triggered as a side effect of
 * sending unsent decisions (see `batchSendDecisions`), which is what caused
 * rejection emails to go out twice.
 */
export async function resendDecision(
  actorId: number,
  responseId: number,
): Promise<{ response: ResponseRow; confirmationToken: string | null }> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId, actorId);

    if (resp.status === "rejected") {
      const app = await requireApplication(client, resp.application_id);
      const user = await loadUserComms(client, resp.user_id);
      await client.query(
        `UPDATE application_responses SET decision_sent_at = now() WHERE id = $1`,
        [resp.id],
      );
      await enqueueDecisionEmailRow(client, resp.user_id, user, app, "rejected", null);
      await audit(client, {
        actorId,
        entityType: "application_response",
        entityId: resp.id,
        action: "decision_resent",
        before: { status: "rejected" },
        after: { status: "rejected" },
      });
      return { response: resp, confirmationToken: null };
    }

    if (resp.status !== "accepted" && resp.status !== "expired") {
      throw new ConflictError("Only accepted, rejected, or expired responses can be resent", {
        status: resp.status,
      });
    }
    const app = await requireApplication(client, resp.application_id);
    const user = await loadUserComms(client, resp.user_id);
    const token = await issueConfirmationToken(client, resp, app, user.email);
    // An expired response returns to 'accepted' — the org's explicit second chance.
    await client.query(
      `UPDATE application_responses SET status = 'accepted', decision_sent_at = now() WHERE id = $1`,
      [responseId],
    );
    await enqueueDecisionEmailRow(client, resp.user_id, user, app, "accepted", token);
    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: responseId,
      action: "decision_resent",
      before: { status: resp.status },
      after: { status: "accepted" },
    });
    const { rows } = await client.query(`SELECT * FROM application_responses WHERE id = $1`, [
      responseId,
    ]);
    return { response: rows[0], confirmationToken: token };
  });
}

/**
 * Re-accept a declined, rejected, or expired response — moves it back to
 * `accepted` with a fresh confirmation token and email. Admin operation
 * (APPLICATIONS_DECIDE) that re-checks capacity.
 */
export async function reAccept(
  actorId: number,
  responseId: number,
): Promise<{ response: ResponseRow; confirmationToken: string | null }> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId, actorId);
    if (resp.status !== "declined" && resp.status !== "rejected" && resp.status !== "expired") {
      throw new ConflictError("Only declined, rejected, or expired responses can be re-accepted", {
        status: resp.status,
      });
    }

    const app = await requireApplication(client, resp.application_id);

    if (app.capacity != null) {
      await assertCapacityAvailable(client, resp.application_id, app.capacity);
    }

    const user = await loadUserComms(client, resp.user_id);
    const token = await issueConfirmationToken(client, resp, app, user.email);

    await client.query(
      `UPDATE application_responses
       SET status = 'accepted', decision_sent_at = now(), confirmed_at = NULL, declined_at = NULL
       WHERE id = $1`,
      [resp.id],
    );
    // H8: keyed off the form's actual grants_role_ids, not a static
    // applications.type — see formGrantsMentorRole's doc comment.
    if (await formGrantsMentorRole(client, app.id)) await issueTicket(client, resp.user_id);

    await enqueueDecisionEmailRow(client, resp.user_id, user, app, "accepted", token);

    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: resp.id,
      action: "re_accepted",
      before: { status: resp.status },
      after: { status: "accepted" },
    });

    const { rows } = await client.query(`SELECT * FROM application_responses WHERE id = $1`, [
      responseId,
    ]);
    return { response: rows[0], confirmationToken: token };
  });
}

/**
 * Voids ticket-purpose wallet passes for a user who just lost their confirmed
 * spot, but only if they don't hold event access through some other route
 * (another confirmed response, or a manual attendee role) — the `tickets` row
 * itself is never touched (plan/07 invariant 10). Returns the voided pass ids
 * so the caller can push the update to devices after its transaction commits.
 */
async function voidTicketAccessIfLost(client: pg.PoolClient, userId: number): Promise<number[]> {
  if (await hasEventAccess(client, userId)) return [];
  await voidTicketPasses(client, userId);
  const voided = await client.query(
    `SELECT id FROM wallet_passes WHERE user_id = $1 AND purpose = 'ticket' AND status = 'voided'`,
    [userId],
  );
  return voided.rows.map((r: { id: number }) => r.id);
}

async function pushTicketVoid(userId: number, voidedPassIds: number[]): Promise<void> {
  if (voidedPassIds.length === 0) return;
  await broadcast(`${SSE_TOPICS.USER_PREFIX}${userId}`, EVENTS.LOGISTICS_WALLET_PASS_UPDATED, {
    purpose: "ticket",
    status: "voided",
  });
  await enqueueWalletSync(voidedPassIds);
}

/**
 * Revoke an already-sent acceptance — the "reject / decline spot" action that
 * must work EVEN AFTER the participant has confirmed (M2). Moves accepted or
 * confirmed → rejected: invalidates any pending confirmation token, frees the
 * capacity slot and notifies the applicant. A revoked spot is a normal
 * `rejected` row, so it can later be re-accepted like any other — dietary
 * data is left untouched precisely so a re-accept doesn't lose it.
 * Admin operation (APPLICATIONS_DECIDE).
 */
export async function revokeSpot(actorId: number, responseId: number): Promise<ResponseRow> {
  let voidedPassIds: number[] = [];
  const result = await withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId, actorId);
    if (resp.status !== "accepted" && resp.status !== "confirmed") {
      throw new ConflictError("Only accepted or confirmed spots can be revoked", {
        status: resp.status,
      });
    }
    const app = await requireApplication(client, resp.application_id);

    if (resp.confirmation_token_id) {
      await invalidateConfirmationToken(client, resp.confirmation_token_id);
    }
    const updated = await client.query(
      `UPDATE application_responses
       SET status = 'rejected', decision_sent_at = now(),
           confirmation_token_id = NULL, confirmed_at = NULL, declined_at = NULL
       WHERE id = $1 RETURNING *`,
      [responseId],
    );
    const user = await loadUserComms(client, resp.user_id);
    await enqueueDecisionEmailRow(client, resp.user_id, user, app, "rejected", null);

    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: responseId,
      action: "spot_revoked",
      before: { status: resp.status },
      after: { status: "rejected" },
      reason: resp.status === "confirmed" ? "revoked after confirmation" : "revoked before confirm",
    });

    // A ticket was only ever issued for a confirmed spot — void its wallet
    // pass(es) if this was the user's last remaining event access.
    if (resp.status === "confirmed") {
      voidedPassIds = await voidTicketAccessIfLost(client, resp.user_id);
    }
    return updated.rows[0] as ResponseRow;
  });
  await pushTicketVoid(result.user_id, voidedPassIds);
  return result;
}

// ── decision pool (review dashboard) ─────────────────────────────────────────

export interface DecisionPoolRow {
  id: number;
  user_id: number;
  name: string | null;
  email: string;
  status: string;
  decision_sent_at: Date | null;
  declined_at: Date | null;
  submitted_at: Date | null;
  avg_score: number | null;
  review_count: number;
}

export interface DecisionPool {
  accepted: { unsent: DecisionPoolRow[]; sent: DecisionPoolRow[] };
  rejected: { unsent: DecisionPoolRow[]; sent: DecisionPoolRow[] };
  declined: { manual: DecisionPoolRow[]; expired: DecisionPoolRow[] };
}

async function loadDecisionPoolRows(
  client: Queryable,
  applicationId: number,
  statuses: string[],
): Promise<DecisionPoolRow[]> {
  const { rows } = await client.query(
    `SELECT r.id, r.user_id, u.name, u.email, r.status, r.decision_sent_at,
            r.declined_at, r.submitted_at,
            COALESCE(avg(ar.score), NULL) AS avg_score,
            count(ar.author_id)::int AS review_count
     FROM application_responses r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN applicant_reviews ar ON ar.response_id = r.id
     WHERE r.application_id = $1 AND r.status = ANY($2)
       AND u.account_state = 'active' AND u.anonymized_at IS NULL
       AND u.is_test_account = false
     GROUP BY r.id, u.name, u.email
     ORDER BY r.id`,
    [applicationId, statuses],
  );
  return rows;
}

export async function getDecisionPool(applicationId: number): Promise<DecisionPool> {
  const { rows } = await pool.query(`SELECT id FROM applications WHERE id = $1`, [applicationId]);
  if (!rows[0]) throw new NotFoundError("Application not found");

  const [acceptedUns, acceptedSent, rejectedUns, rejectedSent, declinedManual, declinedExpired] =
    await Promise.all([
      loadDecisionPoolRows(pool, applicationId, ["accepted_internal"]),
      loadDecisionPoolRows(pool, applicationId, ["accepted"]),
      loadDecisionPoolRows(pool, applicationId, ["rejected_internal"]),
      loadDecisionPoolRows(pool, applicationId, ["rejected"]),
      loadDecisionPoolRows(pool, applicationId, ["declined"]),
      loadDecisionPoolRows(pool, applicationId, ["expired"]),
    ]);

  return {
    accepted: { unsent: acceptedUns, sent: acceptedSent },
    rejected: { unsent: rejectedUns, sent: rejectedSent },
    declined: { manual: declinedManual, expired: declinedExpired },
  };
}

// ── batch operations ─────────────────────────────────────────────────────────

export interface BatchResult {
  processed: number;
  // Per-id failures with their reason. Previously batches silently swallowed
  // these (the "flaky batch" symptom): callers saw a count and couldn't tell
  // which rows were skipped or why. Surfacing them makes batches observable.
  skipped: Array<{ id: number; reason: string }>;
}

/**
 * Run a per-response operation over a batch: deterministic id order, one row's
 * failure never aborts the rest, and every skip is reported with its reason.
 */
async function runBatch(
  responseIds: number[],
  op: (id: number) => Promise<unknown>,
): Promise<BatchResult> {
  const sorted = [...responseIds].sort((a, b) => a - b);
  let processed = 0;
  const skipped: Array<{ id: number; reason: string }> = [];
  for (const id of sorted) {
    try {
      await op(id);
      processed++;
    } catch (err) {
      skipped.push({ id, reason: err instanceof Error ? err.message : "failed" });
    }
  }
  return { processed, skipped };
}

export async function batchDecide(
  actorId: number,
  responseIds: number[],
  decision: "accepted" | "rejected",
): Promise<BatchResult> {
  return runBatch(responseIds, (id) => decide(actorId, id, decision));
}

/** Batch re-accept declined/rejected/expired responses (M2). */
export async function batchReAccept(actorId: number, responseIds: number[]): Promise<BatchResult> {
  return runBatch(responseIds, (id) => reAccept(actorId, id));
}

/** Batch revoke accepted/confirmed spots → rejected (M2). */
export async function batchRevokeSpots(
  actorId: number,
  responseIds: number[],
): Promise<BatchResult> {
  return runBatch(responseIds, (id) => revokeSpot(actorId, id));
}

/**
 * Send every still-unsent internal decision in the batch (outbox → sent).
 * Only ever acts on `accepted_internal`/`rejected_internal` rows — any other
 * status (already sent, already final) is skipped rather than resent, so this
 * can never double-send an email. Explicit re-sends go through
 * `batchResendDecisions` instead (H14).
 */
export async function batchSendDecisions(
  actorId: number,
  responseIds: number[],
): Promise<{
  sent: number;
  tokens: Array<{ responseId: number; token: string | null }>;
  skipped: Array<{ id: number; reason: string }>;
}> {
  const tokens: Array<{ responseId: number; token: string | null }> = [];
  const skipped: Array<{ id: number; reason: string }> = [];
  const sorted = [...responseIds].sort((a, b) => a - b);
  for (const id of sorted) {
    try {
      const { rows } = await pool.query(`SELECT status FROM application_responses WHERE id = $1`, [
        id,
      ]);
      if (!rows[0]) {
        skipped.push({ id, reason: "not found" });
        continue;
      }
      const status = rows[0].status;
      if (status === "accepted_internal" || status === "rejected_internal") {
        const result = await sendDecision(actorId, id);
        tokens.push({ responseId: id, token: result.confirmationToken });
      } else {
        skipped.push({ id, reason: `nothing to send from status ${status}` });
      }
    } catch (err) {
      skipped.push({ id, reason: err instanceof Error ? err.message : "failed" });
    }
  }
  return { sent: tokens.length, tokens, skipped };
}

/** Explicitly re-send an already-sent decision (accepted/rejected/expired) for each id in the batch (H14/H15). */
export async function batchResendDecisions(
  actorId: number,
  responseIds: number[],
): Promise<BatchResult> {
  return runBatch(responseIds, (id) => resendDecision(actorId, id));
}

export async function batchRevertDecisions(
  actorId: number,
  responseIds: number[],
  newDecision: "accepted" | "rejected" | "review",
): Promise<BatchResult> {
  return runBatch(responseIds, (id) => revertDecision(actorId, id, newDecision));
}

// ── confirm link retrieval (H15) ────────────────────────────────────────────

export async function getConfirmLink(
  responseId: number,
): Promise<{ token: string; expiresAt: Date } | null> {
  const { rows } = await pool.query(
    `SELECT t.token, t.expires_at
     FROM application_responses r
     JOIN email_verification_tokens t ON t.id = r.confirmation_token_id
     WHERE r.id = $1 AND r.status = 'accepted' AND t.type = 'spot_confirmation'
       AND EXISTS (
         SELECT 1 FROM users u
          WHERE u.id = r.user_id AND u.is_test_account = false
       )
     ORDER BY t.id DESC LIMIT 1`,
    [responseId],
  );
  if (!rows[0]) return null;
  return { token: rows[0].token, expiresAt: rows[0].expires_at };
}

async function enqueueDecisionEmailRow(
  client: pg.PoolClient,
  userId: number,
  user: UserComms,
  app: ApplicationRow,
  decision: "accepted" | "rejected",
  confirmToken: string | null,
): Promise<void> {
  const countdown =
    decision === "accepted" && confirmToken
      ? formatRemainingTime(new Date(Date.now() + app.confirmation_window_hours * 3_600_000))
      : "";
  const decisionDetails =
    decision === "accepted" && confirmToken
      ? `\n\nYou have been accepted. Please confirm your spot, or if you can't make it please let us know so we can give your spot to someone else:\n\n[Accept my spot](${config.WEB_URL}/applications/confirm?token=${confirmToken})\n[No, I can't make it](${config.WEB_URL}/applications/decline?token=${confirmToken})\n\n${countdown}\n\nAfter that time your spot will be automatically released.`
      : "";
  await client.query(
    `INSERT INTO notification_outbox (user_id, category, channel, payload)
     VALUES ($1, 'application', 'email', $2::jsonb)`,
    [
      userId,
      JSON.stringify({
        template: "application.decision",
        recipient: user.email,
        language: user.language,
        vars: {
          name: user.name ?? "",
          applicationName: app.name,
          decision,
          decisionDetails,
        },
      }),
    ],
  );
}

export interface ResponseDetail {
  response: ResponseRow;
  user: {
    name: string | null;
    email: string;
    shirt_size: string | null;
    food_intolerances: number[];
    food_intolerance_notes: string | null;
    dietary_data_state: "not_provided" | "present";
  };
  application: {
    id: number;
    name: string;
    /** H8: the badge_category of this form's highest-position granted role
     *  (see granted_badge_category doc in admin.routes.ts), or null if the
     *  form grants no role — replaces the retired static `type` field. */
    granted_badge_category: string | null;
    template: TemplateField[];
    sections: FormSection[];
    ask_shirt_size: boolean;
    ask_food_intolerances: boolean;
  };
  reviews: Array<{ author_id: number; score: number | null; notes: string | null }>;
  available_actions: string[];
}

/** Available staff actions for a response based on its current status. */
function computeAvailableActions(status: string): string[] {
  const actions: string[] = ["staff-notes"];
  switch (status) {
    case "submitted": // deprecated alias of "review" — see decide()
    case "review":
      actions.push("my-review", "decide");
      break;
    case "accepted_internal":
    case "rejected_internal":
      actions.push("decide", "revert-decision", "send-decision");
      break;
    case "accepted":
      actions.push("resend-decision", "revert-decision", "confirm-link", "decline-override");
      break;
    case "rejected":
      actions.push("re-accept", "resend-decision", "revert-decision");
      break;
    case "confirmed":
      actions.push("decline-override");
      break;
    case "declined":
    case "expired":
      actions.push("re-accept");
      break;
  }
  return actions;
}

export async function getResponseDetail(responseId: number): Promise<ResponseDetail> {
  const { rows } = await pool.query(
    `SELECT r.*, u.name, u.email, u.shirt_size,
            u.food_intolerances, u.food_intolerance_notes, u.dietary_data_state,
            a.id AS app_id, a.name AS app_name,
            (SELECT r2.badge_category::text
               FROM application_grants_roles agr
               JOIN roles r2 ON r2.id = agr.role_id AND r2.deleted_at IS NULL
              WHERE agr.application_id = a.id
              ORDER BY r2.position DESC
              LIMIT 1) AS granted_badge_category,
            fv.template,
            fv.sections,
            a.ask_shirt_size, a.ask_food_intolerances
     FROM application_responses r
     JOIN users u ON u.id = r.user_id
     JOIN applications a ON a.id = r.application_id
     JOIN application_form_versions fv
       ON fv.id = r.application_form_version_id
      AND fv.application_id = r.application_id
     WHERE r.id = $1 AND u.account_state = 'active' AND u.anonymized_at IS NULL
       AND u.is_test_account = false`,
    [responseId],
  );
  if (!rows[0]) throw new NotFoundError("Response not found");
  const {
    name,
    email,
    shirt_size,
    food_intolerances,
    food_intolerance_notes,
    dietary_data_state,
    app_id,
    app_name,
    granted_badge_category,
    template,
    sections,
    ask_shirt_size,
    ask_food_intolerances,
    ...response
  } = rows[0];

  const { rows: reviews } = await pool.query(
    `SELECT author_id, score, notes FROM applicant_reviews WHERE response_id = $1 ORDER BY author_id`,
    [responseId],
  );

  // Raw (un-enriched) template + the logistics flags/sections, matching what
  // GET /api/applications/:id returns — the web builds the shirt-size/dietary
  // rows itself (grouped under a synthetic Logistics section) so this and the
  // applications-tab review flow render identically (H11).
  return {
    response,
    user: {
      name,
      email,
      shirt_size,
      food_intolerances,
      food_intolerance_notes,
      dietary_data_state,
    },
    application: {
      id: app_id,
      name: app_name,
      granted_badge_category,
      template,
      sections,
      ask_shirt_size,
      ask_food_intolerances,
    },
    reviews,
    available_actions: computeAvailableActions(response.status),
  };
}

export async function editResponse(
  actorId: number,
  responseId: number,
  responses: Record<string, unknown>,
): Promise<ResponseRow> {
  return withTransaction(async (client) => {
    const response = await lockResponse(client, responseId, actorId);
    const { rows: versionRows } = await client.query(
      `SELECT fv.template
         FROM application_form_versions fv
        WHERE fv.id = $1 AND fv.application_id = $2`,
      [response.application_form_version_id, response.application_id],
    );
    if (!versionRows[0]) {
      throw new ConflictError("This response is missing its immutable form version", {
        code: "form_version_required",
      });
    }
    // Validate ONLY against the form template the staff answer-edit form
    // actually renders. Shirt size and dietary data live on the user row
    // (managed from the profile / logistics), not this form.
    validateResponses(versionRows[0].template, responses);
    const storedResponses = stripDietaryResponses(responses);

    const updated = await client.query(
      `UPDATE application_responses SET responses = $2::jsonb WHERE id = $1 RETURNING *`,
      [responseId, JSON.stringify(storedResponses)],
    );

    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: responseId,
      action: "edited",
      source: "web",
    });

    return updated.rows[0];
  });
}

// ── confirm / decline (H15) ──────────────────────────────────────────────────

async function confirmationTokenExpired(
  client: pg.PoolClient,
  resp: ResponseRow,
): Promise<boolean> {
  if (!resp.confirmation_token_id) return true;
  const { rows } = await client.query(
    `SELECT expires_at FROM email_verification_tokens WHERE id = $1`,
    [resp.confirmation_token_id],
  );
  if (!rows[0]) return true;
  return new Date(rows[0].expires_at) < new Date();
}

export interface ConfirmResult {
  status: string;
  alreadyConfirmed: boolean;
  ticketToken: string;
  /** Whose spot this is — the email link identifies a person, not a session. */
  userId: number;
}

/**
 * What the public email-link confirm returns (issue #369): the confirm result
 * plus a scoped wallet credential and just enough identity for the landing
 * page to say "this ticket belongs to m•••@example.com — sign in as them to
 * use the app". Never a session.
 */
export interface EmailConfirmResult extends ConfirmResult {
  walletToken: string;
  walletTokenExpiresAt: string;
  maskedEmail: string;
}

/**
 * m•••@example.com — enough for the holder of the link to recognize their own
 * account without printing a full address to whoever the mail was forwarded to.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

async function doConfirm(
  client: pg.PoolClient,
  resp: ResponseRow,
  via: ConfirmVia,
  actorId: number | null,
): Promise<ConfirmResult> {
  if (resp.status === "confirmed") {
    // Double-confirm is idempotent-friendly (H15): return already-confirmed.
    const existing = await client.query(`SELECT token FROM tickets WHERE user_id = $1`, [
      resp.user_id,
    ]);
    return {
      status: "confirmed",
      alreadyConfirmed: true,
      ticketToken: existing.rows[0]?.token ?? "",
      userId: resp.user_id,
    };
  }
  if (resp.status !== "accepted") {
    throw new ConflictError("This spot is not in a confirmable state", { status: resp.status });
  }
  if (await confirmationTokenExpired(client, resp)) {
    throw new ConflictError(
      "Your confirmation window has expired — ask the organization to resend",
      {
        code: "confirmation_expired",
        expired: true,
      },
    );
  }

  // capacity is NOT re-checked here: it binds at ACCEPT time (plan invariant);
  // confirm never exceeds it because accepts already respected capacity.
  const ticketToken = await issueTicket(client, resp.user_id);
  await client.query(
    `UPDATE application_responses SET status = 'confirmed', confirmed_at = now() WHERE id = $1`,
    [resp.id],
  );
  if (resp.confirmation_token_id) {
    await invalidateConfirmationToken(client, resp.confirmation_token_id);
  }
  // H8/H11: grant every role the form is configured to grant alongside
  // ticket issuance, in the same transaction as the confirmation write.
  const { rows: grantRows } = await client.query(
    `SELECT role_id FROM application_grants_roles WHERE application_id = $1`,
    [resp.application_id],
  );
  const grantedRoleIds = grantRows.map((r) => r.role_id as number);
  if (grantedRoleIds.length > 0) {
    await client.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by, source)
       SELECT $1, unnest($2::int[]), $3, 'application_confirmed'
       ON CONFLICT DO NOTHING`,
      [resp.user_id, grantedRoleIds, actorId],
    );
  }
  await audit(client, {
    actorId,
    entityType: "application_response",
    entityId: resp.id,
    action: "confirmed",
    source: via,
    before: { status: "accepted" },
    after: { status: "confirmed", grantedRoleIds },
  });
  return { status: "confirmed", alreadyConfirmed: false, ticketToken, userId: resp.user_id };
}

async function doDecline(
  client: pg.PoolClient,
  resp: ResponseRow,
  via: ConfirmVia,
  actorId: number | null,
): Promise<{ status: string; alreadyDeclined: boolean; voidedPassIds: number[] }> {
  if (resp.status === "declined") {
    return { status: "declined", alreadyDeclined: true, voidedPassIds: [] };
  }
  if (resp.status !== "accepted" && resp.status !== "confirmed") {
    throw new ConflictError("This spot is not in a declinable state", { status: resp.status });
  }
  await client.query(
    `UPDATE application_responses SET status = 'declined', declined_at = now() WHERE id = $1`,
    [resp.id],
  );
  if (resp.confirmation_token_id) {
    await invalidateConfirmationToken(client, resp.confirmation_token_id);
  }
  await audit(client, {
    actorId,
    entityType: "application_response",
    entityId: resp.id,
    action: "declined",
    source: via,
    before: { status: resp.status },
    after: { status: "declined" },
  });

  // A ticket was only ever issued once this spot was confirmed — void its
  // wallet pass(es) if this was the user's last remaining event access.
  const voidedPassIds =
    resp.status === "confirmed" ? await voidTicketAccessIfLost(client, resp.user_id) : [];
  return { status: "declined", alreadyDeclined: false, voidedPassIds };
}

/**
 * Email-link confirm (H15). The token identifies the applicant for this one
 * action; it never becomes a session. On success the caller also gets a scoped
 * wallet credential (issue #369) so the landing page can offer "add to Apple /
 * Google Wallet" to someone who is not — and need not become — signed in.
 */
export async function confirmByToken(token: string): Promise<EmailConfirmResult> {
  return withTransaction(async (client) => {
    const resp = await lockVerifiedResponseByToken(client, token, "confirmation");
    const result = await doConfirm(client, resp, "email_link", resp.user_id);
    const grant = await issueWalletAccessToken(client, resp.user_id, "ticket");
    const { rows: userRows } = await client.query(
      `SELECT email FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
      [resp.user_id],
    );
    return {
      ...result,
      walletToken: grant.token,
      walletTokenExpiresAt: grant.expiresAt.toISOString(),
      maskedEmail: maskEmail((userRows[0]?.email as string | undefined) ?? ""),
    };
  });
}

export async function confirmByResponseId(
  responseId: number,
  via: ConfirmVia,
  actorId: number | null,
  requireOwner?: number,
): Promise<ConfirmResult> {
  return withTransaction(async (client) => {
    // Lock the caller's verification state before the response, matching
    // submitResponse's user→response order. The ownership check below still
    // prevents acting on somebody else's response.
    if (requireOwner != null) {
      await assertVerifiedPrimaryEmail(client, requireOwner, { forUpdate: true });
    }
    const resp = await lockResponse(client, responseId, actorId ?? undefined);
    if (requireOwner != null && resp.user_id !== requireOwner) {
      throw new ForbiddenError("Not your application");
    }
    return doConfirm(client, resp, via, actorId);
  });
}

export async function declineByToken(token: string): Promise<{
  status: string;
  alreadyDeclined: boolean;
}> {
  const result = await withTransaction(async (client) => {
    const resp = await lockVerifiedResponseByToken(client, token, "decline");
    const decline = await doDecline(client, resp, "email_link", resp.user_id);
    return { ...decline, userId: resp.user_id };
  });
  await pushTicketVoid(result.userId, result.voidedPassIds);
  return { status: result.status, alreadyDeclined: result.alreadyDeclined };
}

export async function declineByResponseId(
  responseId: number,
  via: ConfirmVia,
  actorId: number | null,
  requireOwner?: number,
): Promise<{ status: string; alreadyDeclined: boolean }> {
  const result = await withTransaction(async (client) => {
    if (requireOwner != null) {
      await assertVerifiedPrimaryEmail(client, requireOwner, { forUpdate: true });
    }
    const resp = await lockResponse(client, responseId, actorId ?? undefined);
    if (requireOwner != null && resp.user_id !== requireOwner) {
      throw new ForbiddenError("Not your application");
    }
    const decline = await doDecline(client, resp, via, actorId);
    return { ...decline, userId: resp.user_id };
  });
  await pushTicketVoid(result.userId, result.voidedPassIds);
  return { status: result.status, alreadyDeclined: result.alreadyDeclined };
}

// ── expirer (plan/07 §5.2) ────────────────────────────────────────────────────

/**
 * Mark accepted responses whose confirmation window has elapsed as expired,
 * one audit row each. Directly invokable so tests don't wait on BullMQ repeat
 * timing.
 */
export async function expireDueConfirmations(): Promise<{ expired: number }> {
  return withTransaction(async (client) => {
    // Resolve candidates without locking responses, then acquire each owner
    // first. Removal uses user -> application_response ordering; expiring a
    // response must follow that order too or it can race the scrub.
    const { rows: candidates } = await client.query<{ id: number; user_id: number }>(
      `SELECT r.id, r.user_id FROM application_responses r
       JOIN applications a ON a.id = r.application_id
       JOIN users u ON u.id = r.user_id
       WHERE r.status = 'accepted'
         AND r.decision_sent_at IS NOT NULL
         AND r.decision_sent_at + make_interval(hours => a.confirmation_window_hours) < now()
         AND u.account_state = 'active' AND u.anonymized_at IS NULL
         AND u.is_test_account = false
       ORDER BY u.id, r.id`,
    );
    const rows: ResponseRow[] = [];
    for (const candidate of candidates) {
      const userLock = await client.query(
        `SELECT id FROM users
          WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
          FOR UPDATE SKIP LOCKED`,
        [candidate.user_id],
      );
      if (!userLock.rows[0]) continue;
      const responseLock = await client.query(
        `SELECT r.* FROM application_responses r
          WHERE r.id = $1 AND r.status = 'accepted'
            AND r.decision_sent_at IS NOT NULL
          FOR UPDATE`,
        [candidate.id],
      );
      const resp = responseLock.rows[0] as ResponseRow | undefined;
      if (!resp) continue;
      const expiry = await client.query(
        `SELECT r.decision_sent_at + make_interval(hours => a.confirmation_window_hours) AS expires_at
           FROM application_responses r JOIN applications a ON a.id = r.application_id
          WHERE r.id = $1`,
        [resp.id],
      );
      if (!expiry.rows[0] || new Date(expiry.rows[0].expires_at) >= new Date()) continue;
      await client.query(`UPDATE application_responses SET status = 'expired' WHERE id = $1`, [
        resp.id,
      ]);
      if (resp.confirmation_token_id) {
        await invalidateConfirmationToken(client, resp.confirmation_token_id);
      }
      await audit(client, {
        actorId: null,
        entityType: "application_response",
        entityId: resp.id,
        action: "expired",
        source: "system",
        before: { status: "accepted" },
        after: { status: "expired" },
      });
      rows.push(resp);
    }
    return { expired: rows.length };
  });
}

// ── read helpers ──────────────────────────────────────────────────────────────

/** Applicant-facing status masks internal decisions as "review" until sent (H14). */
export function maskStatus(status: string): string {
  if (status === "accepted_internal" || status === "rejected_internal") return "review";
  return status;
}

/**
 * Staff-facing list of one user's application responses (M3.3 — the profile's
 * Application tab). Unlike listMyResponses this keeps the REAL status (staff see
 * accepted_internal/rejected_internal), and includes the sent flag so the UI can
 * link straight into the review view for a modifiable, permission-guarded form.
 */
export async function listUserResponsesForStaff(userId: number): Promise<
  Array<{
    id: number;
    application_id: number;
    application_name: string;
    /** H8: badge_category of the form's highest-position granted role, or
     *  null if it grants none — replaces the retired static `type` field. */
    application_granted_badge_category: string | null;
    status: string;
    decision_sent: boolean;
    submitted_at: Date | null;
  }>
> {
  const { rows } = await pool.query(
    `SELECT r.id, r.application_id, a.name AS application_name,
            (SELECT r2.badge_category::text
               FROM application_grants_roles agr
               JOIN roles r2 ON r2.id = agr.role_id AND r2.deleted_at IS NULL
              WHERE agr.application_id = a.id
              ORDER BY r2.position DESC
              LIMIT 1) AS application_granted_badge_category,
            r.status, r.decision_sent_at, r.submitted_at
     FROM application_responses r
     JOIN applications a ON a.id = r.application_id
     JOIN users u ON u.id = r.user_id AND u.is_test_account = false
     WHERE r.user_id = $1 ORDER BY r.id DESC`,
    [userId],
  );
  return rows.map(
    (r: {
      id: number;
      application_id: number;
      application_name: string;
      application_granted_badge_category: string | null;
      status: string;
      decision_sent_at: Date | null;
      submitted_at: Date | null;
    }) => ({
      id: r.id,
      application_id: r.application_id,
      application_name: r.application_name,
      application_granted_badge_category: r.application_granted_badge_category,
      status: r.status,
      decision_sent: r.decision_sent_at !== null,
      submitted_at: r.submitted_at,
    }),
  );
}

export async function listMyResponses(userId: number): Promise<
  Array<{
    id: number;
    application_id: number;
    application_name: string;
    status: string;
    submitted_at: Date | null;
  }>
> {
  const { rows } = await pool.query(
    `SELECT r.id, r.application_id, a.name AS application_name, r.status,
            r.decision_sent_at, r.submitted_at
     FROM application_responses r
     JOIN applications a ON a.id = r.application_id
     WHERE r.user_id = $1 ORDER BY r.id DESC`,
    [userId],
  );
  return rows.map(
    (r: {
      id: number;
      application_id: number;
      application_name: string;
      status: string;
      decision_sent_at: Date | null;
      submitted_at: Date | null;
    }) => ({
      id: r.id,
      application_id: r.application_id,
      application_name: r.application_name,
      status: maskStatus(r.status),
      submitted_at: r.submitted_at,
    }),
  );
}
