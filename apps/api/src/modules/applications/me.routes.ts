import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../db/pool.js";
import { requireAuth } from "../../lib/capabilities.js";
import { NotFoundError } from "../../lib/errors.js";
import { idParamSchema, saveDraftSchema, submitSchema } from "./schemas.js";
import { listMyResponses, maskStatus, saveDraft, submitResponse } from "./service.js";

/**
 * H12 (authenticated): fill in a form, save a draft, submit, and check status.
 * The applicant view masks internal accepted/rejected as "review" until the
 * decision is actually sent (H14).
 */
export function registerMeRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // List my responses across all forms.
  r.get("/api/me/applications", { preHandler: requireAuth }, async (req) => ({
    responses: await listMyResponses(req.userId as number),
  }));

  // My response for one form (draft included), with masked status.
  r.get(
    "/api/applications/:id/response",
    { preHandler: requireAuth, schema: { params: idParamSchema } },
    async (req) => {
      const { rows } = await pool.query(
        `SELECT * FROM application_responses WHERE user_id = $1 AND application_id = $2`,
        [req.userId, req.params.id],
      );
      if (!rows[0]) throw new NotFoundError("No response yet for this application");
      const row = rows[0];
      return { ...row, status: maskStatus(row.status, row.decision_sent_at) };
    },
  );

  // Create/update my draft (H12): 409 if the window is closed for a NEW draft.
  r.put(
    "/api/applications/:id/response",
    {
      preHandler: requireAuth,
      schema: { params: idParamSchema, body: saveDraftSchema },
    },
    async (req) => {
      const row = await saveDraft(req.userId as number, req.params.id, req.body.responses);
      return { ...row, status: maskStatus(row.status, row.decision_sent_at) };
    },
  );

  // Submit (H12): verified-email gate, template validation, sensitive data to users row.
  r.post(
    "/api/applications/:id/response/submit",
    {
      preHandler: requireAuth,
      schema: { params: idParamSchema, body: submitSchema },
    },
    async (req) => {
      const { response, privacyNotice } = await submitResponse(
        req.userId as number,
        req.params.id,
        req.body,
      );
      return {
        response: { ...response, status: maskStatus(response.status, response.decision_sent_at) },
        privacy_notice: privacyNotice,
      };
    },
  );
}
