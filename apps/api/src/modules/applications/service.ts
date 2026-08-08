import { randomBytes } from "node:crypto";
import type pg from "pg";
import { config } from "../../config.js";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { issueTicket } from "../logistics/tickets.js";
import { issueWalletAccessToken } from "../logistics/wallet-access.js";
import type { ApplicationType, TemplateField } from "./schemas.js";

/**
 * Applications domain service (H11-H15, H27). Holds the state-machine
 * transitions (plan/07 §3: draft -> submitted -> review -> accepted|rejected;
 * accepted -> confirmed|declined|expired), the sensitive-data privacy
 * semantics (H12) and the confirm/decline/expire mechanics shared by the
 * three confirmation routes (H15) and the expirer worker (plan/07 §5.2).
 */

export interface ApplicationRow {
  id: number;
  name: string;
  type: ApplicationType;
  template: TemplateField[];
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
  const { rows } = await client.query(`SELECT email, name, language FROM users WHERE id = $1`, [
    userId,
  ]);
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
    const app = await requireApplication(client, applicationId);
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
        `INSERT INTO application_responses (user_id, application_id, responses, status)
         VALUES ($1, $2, $3::jsonb, 'draft') RETURNING *`,
        [userId, applicationId, JSON.stringify(responses)],
      );
      return inserted.rows[0];
    }

    // Existing draft stays editable until submit; anything past draft is locked.
    if (existing.status !== "draft") {
      throw new ConflictError("This application has already been submitted", {
        status: existing.status,
      });
    }
    const updated = await client.query(
      `UPDATE application_responses SET responses = $3::jsonb WHERE id = $1 AND user_id = $2 RETURNING *`,
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
      `SELECT email_verified, language FROM users WHERE id = $1 FOR UPDATE`,
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
        `SELECT food_intolerances, food_intolerance_notes FROM users WHERE id = $1`,
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

    const enrichedTemplate = await enrichTemplate(app, app.template);
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
    await lockResponse(client, responseId); // ensures the response exists
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
    await lockResponse(client, responseId);
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

async function lockResponse(client: pg.PoolClient, responseId: number): Promise<ResponseRow> {
  const { rows } = await client.query(
    `SELECT * FROM application_responses WHERE id = $1 FOR UPDATE`,
    [responseId],
  );
  if (!rows[0]) throw new NotFoundError("Response not found");
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
         WHERE application_id = $1 AND status IN ('accepted_internal', 'accepted', 'confirmed')`
      : `SELECT count(*)::int AS n FROM application_responses
         WHERE application_id = $1 AND id <> $2
           AND status IN ('accepted_internal', 'accepted', 'confirmed')`,
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
    const resp = await lockResponse(client, responseId);
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
    const resp = await lockResponse(client, responseId);

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
    // their decision is the ticket-issuing transition.
    if (app.type === "mentor") await issueTicket(client, resp.user_id);
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
    const resp = await lockResponse(client, responseId);
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
  return withTransaction(async (client) => {
    const app = await requireApplication(client, applicationId);
    const statuses = includeRejected
      ? ["accepted_internal", "rejected_internal"]
      : ["accepted_internal"];
    const { rows } = await client.query(
      `SELECT * FROM application_responses
       WHERE application_id = $1 AND status = ANY($2) AND decision_sent_at IS NULL
       ORDER BY id FOR UPDATE`,
      [applicationId, statuses],
    );
    const tokens: Array<{ responseId: number; token: string | null }> = [];
    for (const resp of rows as ResponseRow[]) {
      const token = await sendOne(client, actorId, resp, app);
      tokens.push({ responseId: resp.id, token });
    }
    return { sent: rows.length, tokens };
  });
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
    const resp = await lockResponse(client, responseId);

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
    const resp = await lockResponse(client, responseId);
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
    if (app.type === "mentor") await issueTicket(client, resp.user_id);

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
 * Revoke an already-sent acceptance — the "reject / decline spot" action that
 * must work EVEN AFTER the participant has confirmed (M2). Moves accepted or
 * confirmed → rejected: invalidates any pending confirmation token, frees the
 * capacity slot and notifies the applicant. A revoked spot is a normal
 * `rejected` row, so it can later be re-accepted like any other — dietary
 * data is left untouched precisely so a re-accept doesn't lose it.
 * Admin operation (APPLICATIONS_DECIDE).
 */
export async function revokeSpot(actorId: number, responseId: number): Promise<ResponseRow> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId);
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
    return updated.rows[0];
  });
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
  application: { id: number; name: string; type: ApplicationType; template: TemplateField[] };
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
            a.id AS app_id, a.name AS app_name, a.type AS app_type, a.template,
            a.ask_shirt_size, a.ask_food_intolerances
     FROM application_responses r
     JOIN users u ON u.id = r.user_id
     JOIN applications a ON a.id = r.application_id
     WHERE r.id = $1`,
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
    app_type,
    template,
    ask_shirt_size,
    ask_food_intolerances,
    ...response
  } = rows[0];

  const { rows: reviews } = await pool.query(
    `SELECT author_id, score, notes FROM applicant_reviews WHERE response_id = $1 ORDER BY author_id`,
    [responseId],
  );

  const enriched = await enrichTemplate({ ask_shirt_size, ask_food_intolerances }, template);
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
      type: app_type,
      template: enriched,
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
  const { rows } = await pool.query(
    `SELECT a.template
     FROM application_responses r
     JOIN applications a ON a.id = r.application_id
     WHERE r.id = $1`,
    [responseId],
  );
  if (!rows[0]) throw new NotFoundError("Response not found");
  const { template } = rows[0];
  // Validate ONLY against the form template the staff answer-edit form actually
  // renders. Shirt size and dietary data live on the user row (managed from the
  // profile / logistics), not this form — validating the *enriched* template
  // here made every edit fail with "shirt_size required" whenever that logistics
  // field was blank, a field staff can't even set in this form.
  validateResponses(template, responses);
  const storedResponses = stripDietaryResponses(responses);

  return withTransaction(async (client) => {
    const { rows: locked } = await client.query(
      `SELECT id FROM application_responses WHERE id = $1 FOR UPDATE`,
      [responseId],
    );
    if (!locked[0]) throw new NotFoundError("Response not found");

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
  await audit(client, {
    actorId,
    entityType: "application_response",
    entityId: resp.id,
    action: "confirmed",
    source: via,
    before: { status: "accepted" },
    after: { status: "confirmed" },
  });
  return { status: "confirmed", alreadyConfirmed: false, ticketToken, userId: resp.user_id };
}

async function doDecline(
  client: pg.PoolClient,
  resp: ResponseRow,
  via: ConfirmVia,
  actorId: number | null,
): Promise<{ status: string; alreadyDeclined: boolean }> {
  if (resp.status === "declined") {
    return { status: "declined", alreadyDeclined: true };
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
  return { status: "declined", alreadyDeclined: false };
}

/**
 * Email-link confirm (H15). The token identifies the applicant for this one
 * action; it never becomes a session. On success the caller also gets a scoped
 * wallet credential (issue #369) so the landing page can offer "add to Apple /
 * Google Wallet" to someone who is not — and need not become — signed in.
 */
export async function confirmByToken(token: string): Promise<EmailConfirmResult> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT r.* FROM email_verification_tokens t
       JOIN application_responses r ON r.id =
         (SELECT id FROM application_responses WHERE confirmation_token_id = t.id)
       WHERE t.token = $1 AND t.type = 'spot_confirmation'
       FOR UPDATE OF r`,
      [token],
    );
    const resp = rows[0] as ResponseRow | undefined;
    if (!resp) throw new NotFoundError("Invalid confirmation token");
    const result = await doConfirm(client, resp, "email_link", resp.user_id);
    const grant = await issueWalletAccessToken(client, resp.user_id, "ticket");
    const { rows: userRows } = await client.query(`SELECT email FROM users WHERE id = $1`, [
      resp.user_id,
    ]);
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
    const resp = await lockResponse(client, responseId);
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
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT r.* FROM email_verification_tokens t
       JOIN application_responses r ON r.id =
         (SELECT id FROM application_responses WHERE confirmation_token_id = t.id)
       WHERE t.token = $1 AND t.type = 'spot_confirmation'
       FOR UPDATE OF r`,
      [token],
    );
    const resp = rows[0] as ResponseRow | undefined;
    if (!resp) throw new NotFoundError("Invalid decline token");
    return doDecline(client, resp, "email_link", resp.user_id);
  });
}

export async function declineByResponseId(
  responseId: number,
  via: ConfirmVia,
  actorId: number | null,
  requireOwner?: number,
): Promise<{ status: string; alreadyDeclined: boolean }> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId);
    if (requireOwner != null && resp.user_id !== requireOwner) {
      throw new ForbiddenError("Not your application");
    }
    return doDecline(client, resp, via, actorId);
  });
}

// ── expirer (plan/07 §5.2) ────────────────────────────────────────────────────

/**
 * Mark accepted responses whose confirmation window has elapsed as expired,
 * one audit row each. Directly invokable so tests don't wait on BullMQ repeat
 * timing.
 */
export async function expireDueConfirmations(): Promise<{ expired: number }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM application_responses r
       WHERE r.status = 'accepted'
         AND r.decision_sent_at IS NOT NULL
         AND r.decision_sent_at + make_interval(hours =>
               (SELECT confirmation_window_hours FROM applications a WHERE a.id = r.application_id)
             ) < now()
       ORDER BY r.id
       FOR UPDATE OF r SKIP LOCKED`,
    );
    for (const resp of rows as ResponseRow[]) {
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
    application_type: ApplicationType;
    status: string;
    decision_sent: boolean;
    submitted_at: Date | null;
  }>
> {
  const { rows } = await pool.query(
    `SELECT r.id, r.application_id, a.name AS application_name, a.type AS application_type,
            r.status, r.decision_sent_at, r.submitted_at
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
      application_type: ApplicationType;
      status: string;
      decision_sent_at: Date | null;
      submitted_at: Date | null;
    }) => ({
      id: r.id,
      application_id: r.application_id,
      application_name: r.application_name,
      application_type: r.application_type,
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
