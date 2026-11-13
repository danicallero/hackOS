import { pool, withTransaction } from "../../db/pool.js";

import { audit } from "../../lib/audit.js";

import { NotFoundError } from "../../lib/errors.js";

import { validateResponses } from "../../lib/form-validation.js";
import { stripDietaryResponses } from "./forms.js";
import { grantedRoleNameSql } from "./granted-role.js";
import { lockResponse } from "./internal.js";
import type { FormSection, TemplateField } from "./schemas.js";

import type { ResponseRow } from "./types.js";

interface ResponseDetail {
  response: ResponseRow;
  user: {
    name: string | null;
    email: string;
    /** Applicant language: the rejection reason should be written in it. */
    language: string | null;
    shirt_size: string | null;
    food_intolerances: number[];
    food_intolerance_notes: string | null;
    dietary_data_state: "not_provided" | "present";
  };
  application: {
    id: number;
    name: string;
    /** H8: the name of this form's highest-position granted role
     *  (see granted_role_name doc in admin.routes.ts), or null if the
     *  form grants no role — replaces the retired static `type` field. */
    granted_role_name: string | null;
    template: TemplateField[];
    sections: FormSection[];
    ask_shirt_size: boolean;
    ask_food_intolerances: boolean;
    review_hidden_fields: string[];
  };
  reviews: Array<{
    author_id: number;
    author_name: string | null;
    score: number | null;
    notes: string | null;
    updated_at: Date;
  }>;
  avg_score: number | null;
  review_count: number;
  available_actions: string[];
}

/** Available staff actions for a response based on its current status. */
function computeAvailableActions(status: string): string[] {
  const actions: string[] = ["staff-notes"];
  switch (status) {
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

export async function getResponseDetail(
  responseId: number,
  reviewerId: number,
  canViewAllReviews: boolean,
): Promise<ResponseDetail> {
  const { rows } = await pool.query(
    `SELECT r.*, u.notes AS staff_notes, u.language AS user_language,
            NULLIF(concat_ws(' ', u.name, u.surname), '') AS name,
            u.name AS first_name, u.surname AS last_name, u.email, u.shirt_size,
            u.food_intolerances, u.food_intolerance_notes, u.dietary_data_state,
            a.id AS app_id, a.name AS app_name,
            ${grantedRoleNameSql("a", "granted_role_name")},
            a.template,
            a.sections,
            a.ask_shirt_size, a.ask_food_intolerances, a.review_hidden_fields
     FROM application_responses r
     JOIN users u ON u.id = r.user_id
     JOIN applications a ON a.id = r.application_id
     WHERE r.id = $1 AND u.account_state = 'active' AND u.anonymized_at IS NULL
       AND u.is_test_account = false`,
    [responseId],
  );
  if (!rows[0]) throw new NotFoundError("Response not found");
  const {
    name,
    email,
    user_language,
    shirt_size,
    food_intolerances,
    food_intolerance_notes,
    dietary_data_state,
    app_id,
    app_name,
    granted_role_name,
    template,
    sections,
    ask_shirt_size,
    ask_food_intolerances,
    review_hidden_fields,
    ...response
  } = rows[0];

  const reviewWhere = canViewAllReviews
    ? "ar.response_id = $1"
    : "ar.response_id = $1 AND ar.author_id = $2";
  const reviewParams = canViewAllReviews ? [responseId] : [responseId, reviewerId];
  const { rows: reviews } = await pool.query(
    `SELECT ar.author_id, u2.name AS author_name, ar.score, ar.notes, ar.updated_at
       FROM applicant_reviews ar
       JOIN users u2 ON u2.id = ar.author_id
      WHERE ${reviewWhere}
      ORDER BY ar.updated_at DESC`,
    reviewParams,
  );
  const { rows: scoreRows } = await pool.query(
    `SELECT avg(score)::float AS avg_score, count(*)::int AS review_count
       FROM applicant_reviews
      WHERE response_id = $1`,
    [responseId],
  );
  const avgScore = scoreRows[0]?.avg_score ?? null;
  const reviewCount = scoreRows[0]?.review_count ?? 0;

  // Raw (un-enriched) template + the logistics flags/sections, matching what
  // GET /api/applications/:id returns — the web builds the shirt-size/dietary
  // rows itself (grouped under a synthetic Logistics section) so this and the
  // applications-tab review flow render identically (H11).
  return {
    response,
    user: {
      name,
      email,
      language: user_language ?? null,
      shirt_size,
      food_intolerances,
      food_intolerance_notes,
      dietary_data_state,
    },
    application: {
      id: app_id,
      name: app_name,
      granted_role_name,
      template,
      sections,
      ask_shirt_size,
      ask_food_intolerances,
      review_hidden_fields,
    },
    reviews,
    avg_score: avgScore,
    review_count: reviewCount,
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
    const { rows: applicationRows } = await client.query<{ template: TemplateField[] }>(
      `SELECT template
         FROM applications
        WHERE id = $1
        FOR SHARE`,
      [response.application_id],
    );
    if (!applicationRows[0]) throw new NotFoundError("Application not found");
    // Staff correction renders the current form, not the response's immutable
    // submission snapshot. Match its field kinds and validation rules exactly;
    // shirt size and dietary data remain on the user row.
    validateResponses(applicationRows[0].template, responses);
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
      after: {
        changed_fields: [
          ...new Set([...Object.keys(response.responses), ...Object.keys(storedResponses)]),
        ].filter(
          (key) => JSON.stringify(response.responses[key]) !== JSON.stringify(storedResponses[key]),
        ),
      },
    });

    return updated.rows[0];
  });
}
