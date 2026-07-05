import { randomBytes } from "node:crypto";
import type pg from "pg";
import { config } from "../../config.js";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { type ApplicationType, SHIRT_TYPES, type TemplateField } from "./schemas.js";

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
        if (typeof value !== "number") errors[field.key] = "must be a number";
        break;
      default:
        if (typeof value !== "string") errors[field.key] = "must be a string";
    }
  }
  if (Object.keys(errors).length > 0) {
    throw new BadRequestError("Response fails template validation", { fields: errors });
  }
}

const SHIRT_SIZE_FIELD: TemplateField = {
  key: "shirt_size",
  label: { en: "T-shirt size", es: "Talla de camiseta", gl: "Talla de camiseta" },
  kind: "select",
  required: true,
  options: [
    { value: "XS", label: { en: "XS", es: "XS", gl: "XS" } },
    { value: "S", label: { en: "S", es: "S", gl: "S" } },
    { value: "M", label: { en: "M", es: "M", gl: "M" } },
    { value: "L", label: { en: "L", es: "L", gl: "L" } },
    { value: "XL", label: { en: "XL", es: "XL", gl: "XL" } },
    { value: "XXL", label: { en: "XXL", es: "XXL", gl: "XXL" } },
  ],
};

/** If the application type requires a shirt size, append the field to the template. */
export function augmentTemplate(
  appType: ApplicationType,
  template: TemplateField[],
): TemplateField[] {
  if (!SHIRT_TYPES.includes(appType)) return template;
  if (template.some((f) => f.key === "shirt_size")) return template;
  return [...template, SHIRT_SIZE_FIELD];
}

const FOOD_NOTES_FIELD: TemplateField = {
  key: "food_intolerance_notes",
  label: { en: "Dietary notes", es: "Notas dietéticas", gl: "Notas dietéticas" },
  kind: "textarea",
  required: false,
};

/**
 * Enrich the template with dynamically-loaded fields (food intolerances) when
 * the application type requires them. Async because it queries the DB for the
 * current set of food-intolerance options.
 */
export async function enrichTemplate(
  appType: ApplicationType,
  template: TemplateField[],
): Promise<TemplateField[]> {
  let enriched = augmentTemplate(appType, template);
  if (SHIRT_TYPES.includes(appType) && !enriched.some((f) => f.key === "food_intolerances")) {
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
  "Your dietary restrictions are stored only to plan meals. If you do not confirm your spot (or you decline it), this sensitive data is deleted and no longer processed.";
const PRIVACY_NOTICE: Record<string, string> = {
  en: PRIVACY_NOTICE_EN,
  es: "Tus restricciones alimenticias se guardan solo para planificar las comidas. Si no confirmas tu plaza (o la rechazas), ese dato sensible se elimina y no se trata para nada más.",
  gl: "As túas restricións alimenticias gárdanse só para planificar as comidas. Se non confirmas a túa praza (ou a rexeitas), ese dato sensible elimínase e non se trata para nada máis.",
};

export function privacyNotice(language: string | null | undefined): string {
  return PRIVACY_NOTICE[language ?? "en"] ?? PRIVACY_NOTICE_EN;
}

// ── sensitive-data wipe (H12 / H27) ──────────────────────────────────────────

/**
 * Delete the user's food intolerances unless they still hold another confirmed
 * response (they might participate under a different application type). Called
 * on decline (H15) and on expiry (plan/07 §5.2) — the privacy promise made at
 * submit (H12).
 */
export async function wipeSensitiveDataIfOrphan(
  client: pg.PoolClient,
  userId: number,
  exceptResponseId: number,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM application_responses
     WHERE user_id = $1 AND status = 'confirmed' AND id <> $2 LIMIT 1`,
    [userId, exceptResponseId],
  );
  if (rows.length > 0) return false;
  await client.query(
    `UPDATE users SET food_intolerances = '{}', food_intolerance_notes = NULL WHERE id = $1`,
    [userId],
  );
  return true;
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

async function issueTicket(client: pg.PoolClient, userId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  // One ticket per user, permanent, never voided (plan/07 invariant 10).
  const { rows } = await client.query(
    `INSERT INTO tickets (user_id, token) VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING token`,
    [userId, token],
  );
  if (rows[0]) return rows[0].token;
  const existing = await client.query(`SELECT token FROM tickets WHERE user_id = $1`, [userId]);
  return existing.rows[0].token;
}

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

// ── create / update draft (H12) ──────────────────────────────────────────────

export async function saveDraft(
  userId: number,
  applicationId: number,
  responses: Record<string, unknown>,
): Promise<ResponseRow> {
  return withTransaction(async (client) => {
    const app = await requireApplication(client, applicationId);
    const { rows } = await client.query(
      `SELECT * FROM application_responses WHERE user_id = $1 AND application_id = $2 FOR UPDATE`,
      [userId, applicationId],
    );
    const existing = rows[0] as ResponseRow | undefined;

    if (!existing) {
      // 409 if the window is closed for a brand-new draft (H12).
      if (!isWindowOpen(app)) {
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

    if (SHIRT_TYPES.includes(app.type) && !shirtSize) {
      throw new BadRequestError("Shirt size is required for this application type", {
        code: "shirt_size_required",
      });
    }

    // Extract food data from responses if not provided as top-level fields
    const foodIntolerances = (
      input.food_intolerances.length > 0
        ? input.food_intolerances
        : ((merged.food_intolerances as number[] | undefined) ?? [])
    ).map(Number);
    const foodNotes =
      input.food_intolerance_notes ?? (merged.food_intolerance_notes as string | undefined) ?? null;

    // If the form carries a national-ID question (key "dni", any case), mirror
    // its answer onto users.dni — a first-class identity field, like shirt size
    // and food intolerances above (M1: the "DNI" sync; "DNA" in the brief was a
    // typo for DNI). Only non-empty string answers overwrite an existing value.
    const dni = extractDni(merged);

    const enrichedTemplate = await enrichTemplate(app.type, app.template);
    validateResponses(enrichedTemplate, merged);

    // Sensitive/logistics data lives on the user row, not the response (H12).
    await client.query(
      `UPDATE users
       SET food_intolerances = $2,
           food_intolerance_notes = $3,
           shirt_size = COALESCE($4, shirt_size),
           dni = COALESCE($5, dni)
       WHERE id = $1`,
      [userId, foodIntolerances, foodNotes, shirtSize ?? null, dni],
    );

    const updated = await client.query(
      `UPDATE application_responses
       SET responses = $3::jsonb, status = 'review', submitted_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [existing.id, userId, JSON.stringify(merged)],
    );

    await audit(client, {
      actorId: userId,
      entityType: "application_response",
      entityId: existing.id,
      action: "submitted",
      source: "web",
    });

    return { response: updated.rows[0], privacyNotice: privacyNotice(userRows[0].language) };
  });
}

// ── review (H13) ─────────────────────────────────────────────────────────────

export async function startReview(actorId: number, responseId: number): Promise<ResponseRow> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId);
    if (resp.status === "review") return resp; // idempotent
    if (resp.status !== "submitted") {
      throw new ConflictError(
        "Responses move to review automatically on submit; cannot start review from this status",
        { status: resp.status },
      );
    }
    const updated = await client.query(
      `UPDATE application_responses SET status = 'review' WHERE id = $1 RETURNING *`,
      [responseId],
    );
    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: responseId,
      action: "review_started",
      before: { status: "submitted" },
      after: { status: "review" },
    });
    return updated.rows[0];
  });
}

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

    if (resp.status !== "review") {
      throw new ConflictError("Only reviewed responses can be decided", { status: resp.status });
    }

    if (decision === "accepted" && app.capacity != null) {
      const { rows: countRows } = await client.query(
        `SELECT count(*)::int AS n FROM application_responses
         WHERE application_id = $1 AND status IN ('accepted_internal', 'accepted', 'confirmed')`,
        [resp.application_id],
      );
      if (countRows[0].n >= app.capacity) {
        throw new ConflictError("Capacity reached for this application", {
          code: "capacity_full",
          capacity: app.capacity,
        });
      }
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
 * rejected_internal, or send it back to submitted for re-review.
 * Reverting to accepted re-checks capacity. (H14)
 */
export async function revertDecision(
  actorId: number,
  responseId: number,
  newDecision: "accepted" | "rejected" | "submitted",
): Promise<ResponseRow> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId);

    if (newDecision === "submitted") {
      if (
        resp.status !== "accepted_internal" &&
        resp.status !== "rejected_internal" &&
        resp.status !== "accepted" &&
        resp.status !== "rejected"
      ) {
        throw new ConflictError("Only decided responses can be reverted to submitted", {
          status: resp.status,
        });
      }
      // Invalidate any pending confirmation token
      if (resp.confirmation_token_id) {
        await client.query(
          `UPDATE email_verification_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
          [resp.confirmation_token_id],
        );
      }
      const updated = await client.query(
        `UPDATE application_responses
         SET status = 'submitted', decision_sent_at = NULL, confirmation_token_id = NULL,
             confirmed_at = NULL, declined_at = NULL
         WHERE id = $1 RETURNING *`,
        [responseId],
      );
      await audit(client, {
        actorId,
        entityType: "application_response",
        entityId: responseId,
        action: "reverted_to_submitted",
        before: { status: resp.status },
        after: { status: "submitted" },
      });
      return updated.rows[0];
    }

    // accepted_internal / rejected_internal flip
    if (resp.decision_sent_at) {
      throw new ConflictError("Cannot revert a decision that has already been sent", {
        status: resp.status,
      });
    }
    if (resp.status !== "accepted_internal" && resp.status !== "rejected_internal") {
      throw new ConflictError("Only internal decisions can be reverted", {
        status: resp.status,
      });
    }

    const newInternalStatus =
      newDecision === "accepted" ? "accepted_internal" : "rejected_internal";
    if (resp.status === newInternalStatus) {
      return resp; // idempotent — same decision
    }

    // If reverting to accepted, re-check capacity
    if (newDecision === "accepted") {
      const { rows: appRows } = await client.query(
        `SELECT * FROM applications WHERE id = $1 FOR UPDATE`,
        [resp.application_id],
      );
      const app = appRows[0] as ApplicationRow;
      if (app.capacity != null) {
        const { rows: countRows } = await client.query(
          `SELECT count(*)::int AS n FROM application_responses
           WHERE application_id = $1 AND status IN ('accepted_internal', 'accepted', 'confirmed')`,
          [resp.application_id],
        );
        if (countRows[0].n >= app.capacity) {
          throw new ConflictError("Capacity reached for this application", {
            code: "capacity_full",
            capacity: app.capacity,
          });
        }
      }
    }

    const updated = await client.query(
      `UPDATE application_responses SET status = $2 WHERE id = $1 RETURNING *`,
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

/** Resend an accepted decision — regenerates the token + email, second chance for the expired (H15). */
export async function resendDecision(
  actorId: number,
  responseId: number,
): Promise<{ response: ResponseRow; confirmationToken: string | null }> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId);
    if (resp.status !== "accepted" && resp.status !== "expired") {
      throw new ConflictError("Only accepted or expired responses can be resent", {
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
      const { rows: countRows } = await client.query(
        `SELECT count(*)::int AS n FROM application_responses
         WHERE application_id = $1 AND status IN ('accepted_internal', 'accepted', 'confirmed')`,
        [resp.application_id],
      );
      if (countRows[0].n >= app.capacity) {
        throw new ConflictError("Capacity reached for this application", {
          code: "capacity_full",
          capacity: app.capacity,
        });
      }
    }

    const user = await loadUserComms(client, resp.user_id);
    const token = await issueConfirmationToken(client, resp, app, user.email);

    await client.query(
      `UPDATE application_responses
       SET status = 'accepted', decision_sent_at = now(), confirmed_at = NULL, declined_at = NULL
       WHERE id = $1`,
      [resp.id],
    );

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
 * capacity slot, wipes now-orphaned sensitive data (H12) and notifies the
 * applicant. A revoked spot is a normal `rejected` row, so it can later be
 * re-accepted like any other. Admin operation (APPLICATIONS_DECIDE).
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
      await client.query(
        `UPDATE email_verification_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
        [resp.confirmation_token_id],
      );
    }
    const updated = await client.query(
      `UPDATE application_responses
       SET status = 'rejected', decision_sent_at = now(),
           confirmation_token_id = NULL, confirmed_at = NULL, declined_at = NULL
       WHERE id = $1 RETURNING *`,
      [responseId],
    );
    // A confirmed applicant kept their sensitive data; revoking frees it (H12).
    await wipeSensitiveDataIfOrphan(client, resp.user_id, responseId);

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
  client: pg.PoolClient,
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
      loadDecisionPoolRows(pool as unknown as pg.PoolClient, applicationId, ["accepted_internal"]),
      loadDecisionPoolRows(pool as unknown as pg.PoolClient, applicationId, ["accepted"]),
      loadDecisionPoolRows(pool as unknown as pg.PoolClient, applicationId, ["rejected_internal"]),
      loadDecisionPoolRows(pool as unknown as pg.PoolClient, applicationId, ["rejected"]),
      loadDecisionPoolRows(pool as unknown as pg.PoolClient, applicationId, ["declined"]),
      loadDecisionPoolRows(pool as unknown as pg.PoolClient, applicationId, ["expired"]),
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
      } else if (status === "accepted" || status === "expired") {
        const result = await resendDecision(actorId, id);
        tokens.push({ responseId: id, token: result.confirmationToken });
      } else if (status === "rejected") {
        // re-send a rejected decision: just re-enqueue the email
        await resendRejectedDecision(actorId, id);
        tokens.push({ responseId: id, token: null });
      } else {
        skipped.push({ id, reason: `nothing to send from status ${status}` });
      }
    } catch (err) {
      skipped.push({ id, reason: err instanceof Error ? err.message : "failed" });
    }
  }
  return { sent: tokens.length, tokens, skipped };
}

async function resendRejectedDecision(actorId: number, responseId: number): Promise<void> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId);
    if (resp.status !== "rejected") {
      throw new ConflictError("Only rejected responses can be resent via this path", {
        status: resp.status,
      });
    }
    const app = await requireApplication(client, resp.application_id);
    const user = await loadUserComms(client, resp.user_id);
    await client.query(`UPDATE application_responses SET decision_sent_at = now() WHERE id = $1`, [
      resp.id,
    ]);
    await enqueueDecisionEmailRow(client, resp.user_id, user, app, "rejected", null);
    await audit(client, {
      actorId,
      entityType: "application_response",
      entityId: resp.id,
      action: "decision_resent",
      before: { status: resp.status },
      after: { status: "rejected" },
    });
  });
}

export async function batchRevertDecisions(
  actorId: number,
  responseIds: number[],
  newDecision: "accepted" | "rejected" | "submitted",
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
  user: { name: string | null; email: string; shirt_size: string | null };
  application: { id: number; name: string; type: ApplicationType; template: TemplateField[] };
  reviews: Array<{ author_id: number; score: number | null; notes: string | null }>;
  available_actions: string[];
}

/** Available staff actions for a response based on its current status. */
function computeAvailableActions(status: string): string[] {
  const actions: string[] = ["staff-notes"];
  switch (status) {
    case "submitted":
    case "review":
      actions.push("my-review");
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
            a.id AS app_id, a.name AS app_name, a.type AS app_type, a.template
     FROM application_responses r
     JOIN users u ON u.id = r.user_id
     JOIN applications a ON a.id = r.application_id
     WHERE r.id = $1`,
    [responseId],
  );
  if (!rows[0]) throw new NotFoundError("Response not found");
  const { name, email, shirt_size, app_id, app_name, app_type, template, ...response } = rows[0];

  const { rows: reviews } = await pool.query(
    `SELECT author_id, score, notes FROM applicant_reviews WHERE response_id = $1 ORDER BY author_id`,
    [responseId],
  );

  const enriched = await enrichTemplate(app_type, template);
  return {
    response,
    user: { name, email, shirt_size },
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
    `SELECT r.*, a.type, a.template,
            u.shirt_size, u.food_intolerances, u.food_intolerance_notes
     FROM application_responses r
     JOIN applications a ON a.id = r.application_id
     JOIN users u ON u.id = r.user_id
     WHERE r.id = $1`,
    [responseId],
  );
  if (!rows[0]) throw new NotFoundError("Response not found");
  const { type, template, shirt_size, food_intolerances, food_intolerance_notes } = rows[0];
  const enriched = await enrichTemplate(type, template);
  // Shirt size and dietary data live on the user row, not the answers. Backfill
  // any the caller didn't send so an edit that only touched form questions still
  // passes enriched validation (which marks shirt_size required for these types).
  const forValidation: Record<string, unknown> = { ...responses };
  if (forValidation.shirt_size == null && shirt_size != null) {
    forValidation.shirt_size = shirt_size;
  }
  if (forValidation.food_intolerances == null && Array.isArray(food_intolerances)) {
    forValidation.food_intolerances = food_intolerances.map(String);
  }
  if (forValidation.food_intolerance_notes == null && food_intolerance_notes != null) {
    forValidation.food_intolerance_notes = food_intolerance_notes;
  }
  validateResponses(enriched, forValidation);

  return withTransaction(async (client) => {
    const { rows: locked } = await client.query(
      `SELECT id FROM application_responses WHERE id = $1 FOR UPDATE`,
      [responseId],
    );
    if (!locked[0]) throw new NotFoundError("Response not found");

    const updated = await client.query(
      `UPDATE application_responses SET responses = $2::jsonb WHERE id = $1 RETURNING *`,
      [responseId, JSON.stringify(responses)],
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
    await client.query(
      `UPDATE email_verification_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
      [resp.confirmation_token_id],
    );
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
  return { status: "confirmed", alreadyConfirmed: false, ticketToken };
}

async function doDecline(
  client: pg.PoolClient,
  resp: ResponseRow,
  via: ConfirmVia,
  actorId: number | null,
): Promise<{ status: string; alreadyDeclined: boolean; wiped: boolean }> {
  if (resp.status === "declined") {
    return { status: "declined", alreadyDeclined: true, wiped: false };
  }
  if (resp.status !== "accepted" && resp.status !== "confirmed") {
    throw new ConflictError("This spot is not in a declinable state", { status: resp.status });
  }
  await client.query(
    `UPDATE application_responses SET status = 'declined', declined_at = now() WHERE id = $1`,
    [resp.id],
  );
  if (resp.confirmation_token_id) {
    await client.query(
      `UPDATE email_verification_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
      [resp.confirmation_token_id],
    );
  }
  // Privacy promise (H12): wipe dietary data unless another confirmed spot needs it.
  const wiped = await wipeSensitiveDataIfOrphan(client, resp.user_id, resp.id);
  await audit(client, {
    actorId,
    entityType: "application_response",
    entityId: resp.id,
    action: "declined",
    source: via,
    before: { status: resp.status },
    after: { status: "declined", sensitive_wiped: wiped },
  });
  return { status: "declined", alreadyDeclined: false, wiped };
}

export async function confirmByToken(token: string): Promise<ConfirmResult> {
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
    return doConfirm(client, resp, "email_link", resp.user_id);
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
  wiped: boolean;
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
): Promise<{ status: string; alreadyDeclined: boolean; wiped: boolean }> {
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
 * wiping sensitive data exactly like decline, one audit row each. Directly
 * invokable so tests don't wait on BullMQ repeat timing.
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
        await client.query(
          `UPDATE email_verification_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
          [resp.confirmation_token_id],
        );
      }
      const wiped = await wipeSensitiveDataIfOrphan(client, resp.user_id, resp.id);
      await audit(client, {
        actorId: null,
        entityType: "application_response",
        entityId: resp.id,
        action: "expired",
        source: "system",
        before: { status: "accepted" },
        after: { status: "expired", sensitive_wiped: wiped },
      });
    }
    return { expired: rows.length };
  });
}

// ── read helpers ──────────────────────────────────────────────────────────────

/** Applicant-facing status masks internal decisions as "review" until sent (H14). */
export function maskStatus(status: string, _decisionSentAt: Date | null): string {
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
      status: maskStatus(r.status, r.decision_sent_at),
      submitted_at: r.submitted_at,
    }),
  );
}
