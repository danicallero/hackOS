import type { Queryable } from "../../db/pool.js";

import { withTransaction } from "../../db/pool.js";

import { audit } from "../../lib/audit.js";

import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";

import { validateResponses } from "../../lib/form-validation.js";

import { activeLibraryFields, validateLibraryAnswers } from "../form-libraries/service.js";

import { lockRoleGraph } from "../identity/role-authority.js";

import { reconcileTicketAccess } from "../logistics/tickets.js";

import { sendOne } from "./decision-delivery.js";

import {
  type ApplicationFormVersion,
  enrichTemplate,
  ensureApplicationFormVersion,
  extractDni,
  isInvitedParticipant,
  isWindowOpen,
  privacyNotice,
  requireApplication,
  stripDietaryResponses,
} from "./forms.js";

import { assertCapacityAvailable } from "./internal.js";

import type { ApplicationRow, ResponseRow } from "./types.js";

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
      return { ...inserted.rows[0], can_delete_draft: true };
    }

    // Existing draft stays editable until submit; anything past draft is locked.
    if (existing.status !== "draft") {
      throw new ConflictError("This application has already been submitted", {
        status: existing.status,
      });
    }
    if (!isWindowOpen(app) && !invited && !existing.allow_resubmit_after_close) {
      throw new ConflictError("Applications are closed for this form", { applicationId });
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
    return { ...updated.rows[0], can_delete_draft: await canDeleteDraft(client, updated.rows[0]) };
  });
}

/** H12: returning a response clears submitted_at, so audit history owns this boundary. */
export async function canDeleteDraft(
  db: Queryable,
  response: Pick<ResponseRow, "id" | "status" | "submitted_at">,
): Promise<boolean> {
  if (response.status !== "draft" || response.submitted_at !== null) return false;
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM audit_log
      WHERE entity_type = 'application_response' AND entity_id = $1
        AND action IN ('submitted', 'returned_to_draft')) AS submitted`,
    [String(response.id)],
  );
  return !rows[0].submitted;
}

/** H12: owners may discard preparation, never a submitted or returned response. */
export async function deleteDraft(userId: number, applicationId: number): Promise<void> {
  await withTransaction(async (client) => {
    const user = await client.query(
      `SELECT id FROM users
       WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
       FOR UPDATE`,
      [userId],
    );
    if (!user.rows[0]) throw new NotFoundError("User not found");
    const { rows } = await client.query<ResponseRow & { previously_submitted: boolean }>(
      `SELECT r.*, EXISTS (
         SELECT 1 FROM audit_log l
         WHERE l.entity_type = 'application_response' AND l.entity_id = r.id::text
           AND l.action IN ('submitted', 'returned_to_draft')
       ) AS previously_submitted
       FROM application_responses r
       WHERE r.user_id = $1 AND r.application_id = $2 FOR UPDATE OF r`,
      [userId, applicationId],
    );
    const response = rows[0];
    if (!response) throw new NotFoundError("No response yet for this application");
    if (
      response.status !== "draft" ||
      response.submitted_at !== null ||
      response.previously_submitted
    ) {
      throw new ConflictError("This application has already been submitted", {
        status: response.status,
      });
    }
    await client.query(`DELETE FROM application_responses WHERE id = $1`, [response.id]);
    await audit(client, {
      actorId: userId,
      entityType: "application_response",
      entityId: response.id,
      action: "draft_deleted",
      source: "web",
      before: { applicationId, status: "draft" },
    });
  });
}

// ── submit (H12) ─────────────────────────────────────────────────────────────

interface SubmitInput {
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
    await lockRoleGraph(client);
    let app = await requireApplication(client, applicationId);

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
    const invited = await isInvitedParticipant(client, userId);
    if (existing.status !== "draft") {
      throw new ConflictError("This application has already been submitted", {
        status: existing.status,
      });
    }
    if (!isWindowOpen(app) && !invited && !existing.allow_resubmit_after_close) {
      throw new ConflictError("Applications are closed for this form", { applicationId });
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

    const enrichedTemplate = await enrichTemplate(
      app,
      await activeLibraryFields(client, formVersion.template),
    );
    validateResponses(enrichedTemplate, merged);
    await validateLibraryAnswers(client, enrichedTemplate, merged, userId);
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
           -- #933: a form that asks for dietary data records an explicit answer.
           dietary_confirmed_at = CASE WHEN $6 THEN now() ELSE dietary_confirmed_at END,
           shirt_size = COALESCE($4, shirt_size),
           dni = COALESCE($5, dni)
       WHERE id = $1`,
      [userId, foodIntolerances, foodNotes, shirtSize ?? null, dni, app.ask_food_intolerances],
    );

    const autoAccept = !invited && existing.auto_accept_on_resubmit;
    if (autoAccept) {
      const { rows: appRows } = await client.query(
        `SELECT * FROM applications WHERE id = $1 FOR UPDATE`,
        [applicationId],
      );
      app = appRows[0] as ApplicationRow;
      if (app.capacity != null) await assertCapacityAvailable(client, applicationId, app.capacity);
    }
    const nextStatus = invited ? "confirmed" : autoAccept ? "accepted_internal" : "review";
    const updated = await client.query(
      `UPDATE application_responses
       SET responses = $3::jsonb,
           status = $4,
           submitted_at = now(),
           allow_resubmit_after_close = false,
           auto_accept_on_resubmit = false
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [existing.id, userId, JSON.stringify(storedResponses), nextStatus],
    );

    if (autoAccept) {
      await sendOne(client, userId, updated.rows[0] as ResponseRow, app);
    }

    if (invited) {
      // Auto-confirm: reconcile the role-derived ticket, stamp confirmed_at,
      // and audit confirmed. The invite acceptance path assigns the role;
      // this transition only makes the response state durable.
      await client.query(`UPDATE application_responses SET confirmed_at = now() WHERE id = $1`, [
        existing.id,
      ]);
      await reconcileTicketAccess(client, userId);
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
      after: { status: invited ? "confirmed" : autoAccept ? "accepted" : "review" },
    });

    return {
      response: {
        ...updated.rows[0],
        status: invited ? "confirmed" : autoAccept ? "accepted" : "review",
      },
      privacyNotice: privacyNotice(userRows[0].language),
    };
  });
}
