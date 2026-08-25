import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../../lib/capabilities.js";
import { NotFoundError } from "../../lib/errors.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import { idParamSchema, saveDraftSchema, submitSchema } from "./schemas.js";
import {
  enrichTemplate,
  listMyResponses,
  maskStatus,
  saveDraft,
  submitResponse,
} from "./service.js";

/**
 * H12 (authenticated): fill in a form, save a draft, submit, and check status.
 * The applicant view masks internal accepted/rejected as "review" until the
 * decision is actually sent (H14).
 */
export function registerMeRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // List my responses across all forms.
  r.get(
    "/api/me/applications",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        summary: "List my application responses",
        description: "Every response the caller has started or submitted, across all forms (H12).",
      },
    },
    async (req) => ({
      responses: await listMyResponses(req.userId as number),
    }),
  );

  // My response for one form (draft included), with masked status.
  r.get(
    "/api/applications/:id/response",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        summary: "Get my response for one form",
        description:
          "The caller's own response to a form, including any unsubmitted draft, with the internal accepted/rejected status masked as 'review' until the decision is sent (H12, H14).",
        params: idParamSchema,
      },
    },
    async (req) => {
      const { rows } = await pool.query(
        `SELECT a.template, a.type, a.ask_shirt_size, a.ask_food_intolerances,
                r.*, t.expires_at AS confirmation_expires_at
         FROM application_responses r
         JOIN applications a ON a.id = r.application_id
         LEFT JOIN email_verification_tokens t ON t.id = r.confirmation_token_id
         WHERE r.user_id = $1 AND r.application_id = $2`,
        [req.userId, req.params.id],
      );
      if (!rows[0]) throw new NotFoundError("No response yet for this application");
      const { template, type, ask_shirt_size, ask_food_intolerances, ...row } = rows[0];
      const enriched = await enrichTemplate({ ask_shirt_size, ask_food_intolerances }, template);
      const { rows: userRows } = await pool.query(
        `SELECT shirt_size, food_intolerances, food_intolerance_notes, dietary_data_state
         FROM users WHERE id = $1`,
        [req.userId],
      );
      return {
        ...row,
        status: maskStatus(row.status),
        template: enriched,
        shirt_size: userRows[0]?.shirt_size ?? null,
        food_intolerances: userRows[0]?.food_intolerances ?? [],
        food_intolerance_notes: userRows[0]?.food_intolerance_notes ?? null,
        dietary_data_state: userRows[0]?.dietary_data_state ?? "not_provided",
      };
    },
  );

  // Create/update my draft (H12): 409 if the window is closed for a NEW draft.
  r.put(
    "/api/applications/:id/response",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated", emailVerification: "none" }),
      schema: {
        summary: "Save my draft response",
        description:
          "Creates or updates the caller's draft for a form (H12). 409 if the window is closed and no draft exists yet for this form.",
        params: idParamSchema,
        body: saveDraftSchema,
      },
    },
    async (req) => {
      const row = await saveDraft(req.userId as number, req.params.id, req.body.responses);
      return { ...row, status: maskStatus(row.status) };
    },
  );

  // Submit (H12): verified-email gate, template validation, sensitive data to users row.
  r.post(
    "/api/applications/:id/response/submit",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        summary: "Submit my response",
        description:
          "Submits the caller's response for staff review (H12): validates the answers against the form's template and requires a verified email before accepting the submission.",
        params: idParamSchema,
        body: submitSchema,
      },
    },
    async (req) => {
      const { response, privacyNotice } = await submitResponse(
        req.userId as number,
        req.params.id,
        req.body,
      );
      return {
        response: { ...response, status: maskStatus(response.status) },
        privacy_notice: privacyNotice,
      };
    },
  );
}
