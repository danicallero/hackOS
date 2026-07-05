import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { config } from "../../config.js";
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
      default:
        if (typeof value !== "string") errors[field.key] = "must be a string";
    }
  }
  if (Object.keys(errors).length > 0) {
    throw new BadRequestError("Response fails template validation", { fields: errors });
  }
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
    validateResponses(app.template, merged);

    if (SHIRT_TYPES.includes(app.type) && !input.shirt_size) {
      throw new BadRequestError("Shirt size is required for this application type", {
        code: "shirt_size_required",
      });
    }

    // Sensitive/logistics data lives on the user row, not the response (H12).
    await client.query(
      `UPDATE users
       SET food_intolerances = $2,
           food_intolerance_notes = $3,
           shirt_size = COALESCE($4, shirt_size)
       WHERE id = $1`,
      [
        userId,
        input.food_intolerances,
        input.food_intolerance_notes ?? null,
        input.shirt_size ?? null,
      ],
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
      throw new ConflictError("Responses move to review automatically on submit; cannot start review from this status", { status: resp.status });
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
 * Revert an internal decision — flip between accepted_internal and
 * rejected_internal. Only allowed when the decision hasn't been sent yet.
 * Reverting to accepted re-checks capacity. (H14)
 */
export async function revertDecision(
  actorId: number,
  responseId: number,
  newDecision: "accepted" | "rejected",
): Promise<ResponseRow> {
  return withTransaction(async (client) => {
    const resp = await lockResponse(client, responseId);
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

// ── batch operations ─────────────────────────────────────────────────────────

export async function batchDecide(
  actorId: number,
  responseIds: number[],
  decision: "accepted" | "rejected",
): Promise<{ processed: number }> {
  let processed = 0;
  const sorted = [...responseIds].sort((a, b) => a - b);
  for (const id of sorted) {
    try {
      await decide(actorId, id, decision);
      processed++;
    } catch {
      // skip individual failures so the rest proceed
    }
  }
  return { processed };
}

export async function batchSendDecisions(
  actorId: number,
  responseIds: number[],
): Promise<{ sent: number; tokens: Array<{ responseId: number; token: string | null }> }> {
  return withTransaction(async (client) => {
    const tokens: Array<{ responseId: number; token: string | null }> = [];
    const sorted = [...responseIds].sort((a, b) => a - b);
    for (const id of sorted) {
      const resp = await lockResponse(client, id);
      if (resp.status !== "accepted_internal" && resp.status !== "rejected_internal") continue;
      if (resp.decision_sent_at) continue;
      const app = await requireApplication(client, resp.application_id);
      const token = await sendOne(client, actorId, resp, app);
      tokens.push({ responseId: id, token });
    }
    return { sent: tokens.length, tokens };
  });
}

export async function batchRevertDecisions(
  actorId: number,
  responseIds: number[],
  newDecision: "accepted" | "rejected",
): Promise<{ processed: number }> {
  let processed = 0;
  const sorted = [...responseIds].sort((a, b) => a - b);
  for (const id of sorted) {
    try {
      await revertDecision(actorId, id, newDecision);
      processed++;
    } catch {
      // skip individual failures
    }
  }
  return { processed };
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
  const decisionDetails =
    decision === "accepted" && confirmToken
      ? `\n\n[Confirm my spot](${config.WEB_URL}/applications/confirm?token=${confirmToken})\n\nYou have ${app.confirmation_window_hours}h to confirm before your spot is released.`
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
