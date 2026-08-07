import type { Capability } from "@hackos/shared/capabilities";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../db/pool.js";
import { requireAnyCapability, requireCapability } from "../../lib/capabilities.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import {
  batchDecideSchema,
  batchIdsSchema,
  batchRevertDecisionSchema,
  batchSendDecisionsSchema,
  decideSchema,
  idParamSchema,
  listResponsesQuerySchema,
  responseIdParamSchema,
  revertDecisionSchema,
  reviewUpsertSchema,
  saveDraftSchema,
  sendDecisionsSchema,
  staffNotesSchema,
} from "./schemas.js";
import {
  batchDecide,
  batchReAccept,
  batchResendDecisions,
  batchRevertDecisions,
  batchRevokeSpots,
  batchSendDecisions,
  decide,
  editResponse,
  getConfirmLink,
  getDecisionPool,
  getResponseDetail,
  listUserResponsesForStaff,
  reAccept,
  resendDecision,
  revertDecision,
  revokeSpot,
  sendDecision,
  sendDecisionsBatch,
  setStaffNotes,
  upsertReview,
} from "./service.js";

/**
 * H13 (APPLICATIONS_REVIEW): list + score responses, shared staff notes.
 * H14 (APPLICATIONS_DECIDE): internal accept/reject, batch/individual send,
 * resend.
 */
export function registerReviewRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const capability = (value: Capability) => routeAccess({ kind: "capability", capability: value });
  const anyCapability = (...values: Capability[]) =>
    routeAccess({ kind: "capability", anyOf: values });

  // ── H13: list responses for a form, with filters ───────────────────────────
  r.get(
    "/api/applications/:id/responses",
    {
      preHandler: requireAnyCapability(
        CAPABILITIES.APPLICATIONS_REVIEW,
        CAPABILITIES.APPLICATIONS_DECIDE,
      ),
      config: anyCapability(CAPABILITIES.APPLICATIONS_REVIEW, CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { params: idParamSchema, querystring: listResponsesQuerySchema },
    },
    async (req) => {
      const params: unknown[] = [req.params.id];
      const filters: string[] = [`r.application_id = $1`];
      if (req.query.status) {
        params.push(req.query.status);
        filters.push(`r.status = $${params.length}`);
      }
      if (req.query.search) {
        params.push(`%${req.query.search}%`);
        filters.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
      }
      const { rows } = await pool.query(
        `SELECT r.id, r.user_id, u.name, u.email, u.shirt_size,
                u.food_intolerances, u.food_intolerance_notes, u.dietary_data_state,
                r.status, r.responses,
                r.staff_notes, r.submitted_at, r.decision_sent_at,
                r.confirmed_at, r.declined_at, t.expires_at AS confirmation_expires_at,
                COALESCE(avg(ar.score), NULL) AS avg_score,
                count(ar.author_id)::int AS review_count
         FROM application_responses r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN applicant_reviews ar ON ar.response_id = r.id
         LEFT JOIN email_verification_tokens t ON t.id = r.confirmation_token_id
         WHERE ${filters.join(" AND ")}
         GROUP BY r.id, u.name, u.email, u.shirt_size, u.food_intolerances,
                  u.food_intolerance_notes, u.dietary_data_state,
                  t.expires_at
         ORDER BY r.id`,
        params,
      );
      return { responses: rows };
    },
  );

  // ── H13: per-reviewer score/notes (own row) ─────────────────────────────────
  r.put(
    "/api/responses/:responseId/my-review",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_REVIEW),
      config: capability(CAPABILITIES.APPLICATIONS_REVIEW),
      schema: { params: responseIdParamSchema, body: reviewUpsertSchema },
    },
    async (req) => {
      await upsertReview(
        req.userId as number,
        req.params.responseId,
        req.body.score,
        req.body.notes,
      );
      return { status: true };
    },
  );

  // ── H13: shared staff notes ─────────────────────────────────────────────────
  r.patch(
    "/api/responses/:responseId/staff-notes",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_REVIEW),
      config: capability(CAPABILITIES.APPLICATIONS_REVIEW),
      schema: { params: responseIdParamSchema, body: staffNotesSchema },
    },
    async (req) => {
      await setStaffNotes(
        req.userId as number,
        req.params.responseId,
        req.body.staff_notes ?? null,
      );
      return { status: true };
    },
  );

  // ── H14: internal decision ──────────────────────────────────────────────────
  r.post(
    "/api/responses/:responseId/decide",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { params: responseIdParamSchema, body: decideSchema },
    },
    async (req) => decide(req.userId as number, req.params.responseId, req.body.decision),
  );

  // ── H14: send an individual decision ────────────────────────────────────────
  r.post(
    "/api/responses/:responseId/send-decision",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { params: responseIdParamSchema },
    },
    async (req) => sendDecision(req.userId as number, req.params.responseId),
  );

  // ── H14: batch send all unsent decisions for a form ─────────────────────────
  r.post(
    "/api/applications/:id/send-decisions",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { params: idParamSchema, body: sendDecisionsSchema },
    },
    async (req) =>
      sendDecisionsBatch(req.userId as number, req.params.id, req.body.include_rejected),
  );

  // ── H15: resend (second chance for the expired) ─────────────────────────────
  r.post(
    "/api/responses/:responseId/resend-decision",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { params: responseIdParamSchema },
    },
    async (req) => resendDecision(req.userId as number, req.params.responseId),
  );

  // ── re-accept a declined/rejected/expired response ───────────────────────────
  r.post(
    "/api/responses/:responseId/re-accept",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { params: responseIdParamSchema },
    },
    async (req) => reAccept(req.userId as number, req.params.responseId),
  );

  // ── revoke an accepted/confirmed spot → rejected (works post-confirmation) ────
  r.post(
    "/api/responses/:responseId/revoke-spot",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { params: responseIdParamSchema },
    },
    async (req) => revokeSpot(req.userId as number, req.params.responseId),
  );

  // ── M3.3: one user's responses for their profile Application tab ─────────────
  r.get(
    "/api/users/:id/applications",
    {
      preHandler: requireAnyCapability(
        CAPABILITIES.APPLICATIONS_REVIEW,
        CAPABILITIES.APPLICATIONS_DECIDE,
      ),
      config: anyCapability(CAPABILITIES.APPLICATIONS_REVIEW, CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { params: idParamSchema },
    },
    async (req) => ({ responses: await listUserResponsesForStaff(req.params.id) }),
  );

  // ── decision pool (accepted/rejected/declined grouped for the review UI) ─────
  r.get(
    "/api/applications/:id/decision-pool",
    {
      preHandler: requireAnyCapability(
        CAPABILITIES.APPLICATIONS_REVIEW,
        CAPABILITIES.APPLICATIONS_DECIDE,
      ),
      config: anyCapability(CAPABILITIES.APPLICATIONS_REVIEW, CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { params: idParamSchema },
    },
    async (req) => getDecisionPool(req.params.id),
  );

  // ── H14: revert a decision to review, or flip an unsent internal decision ────
  r.post(
    "/api/responses/:responseId/revert-decision",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { params: responseIdParamSchema, body: revertDecisionSchema },
    },
    async (req) => revertDecision(req.userId as number, req.params.responseId, req.body.decision),
  );

  // ── H15: get confirm link with token ─────────────────────────────────────────
  r.get(
    "/api/responses/:responseId/confirm-link",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { params: responseIdParamSchema },
    },
    async (req) => {
      const link = await getConfirmLink(req.params.responseId);
      if (!link) return { confirm_url: null };
      return {
        confirm_url: `/applications/confirm?token=${link.token}`,
        expires_at: link.expiresAt,
      };
    },
  );

  // ── single response detail with available actions ────────────────────────────
  r.get(
    "/api/responses/:responseId",
    {
      preHandler: requireAnyCapability(
        CAPABILITIES.APPLICATIONS_REVIEW,
        CAPABILITIES.APPLICATIONS_DECIDE,
      ),
      config: anyCapability(CAPABILITIES.APPLICATIONS_REVIEW, CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { params: responseIdParamSchema },
    },
    async (req) => getResponseDetail(req.params.responseId),
  );

  // ── staff edit response form data ────────────────────────────────────────────
  r.put(
    "/api/responses/:responseId",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_EDIT_RESPONSE),
      config: capability(CAPABILITIES.APPLICATIONS_EDIT_RESPONSE),
      schema: { params: responseIdParamSchema, body: saveDraftSchema },
    },
    async (req) => editResponse(req.userId as number, req.params.responseId, req.body.responses),
  );

  // ── batch operations ─────────────────────────────────────────────────────────
  r.post(
    "/api/responses/batch/decide",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { body: batchDecideSchema },
    },
    async (req) => batchDecide(req.userId as number, req.body.response_ids, req.body.decision),
  );

  r.post(
    "/api/responses/batch/send-decision",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { body: batchSendDecisionsSchema },
    },
    async (req) => batchSendDecisions(req.userId as number, req.body.response_ids),
  );

  // ── H14/H15: batch re-send already-sent decisions (accepted/rejected/expired) ─
  r.post(
    "/api/responses/batch/resend-decision",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: {
        summary: "Batch re-send already-sent decisions",
        description:
          "Explicitly re-sends the decision email for each response id, for responses " +
          "already at accepted, rejected, or expired (an expired one returns to accepted — " +
          "a second chance). Distinct from batch send-decision, which only sends never-sent " +
          "internal decisions and never resends.",
        body: batchIdsSchema,
      },
    },
    async (req) => batchResendDecisions(req.userId as number, req.body.response_ids),
  );

  r.post(
    "/api/responses/batch/revert-decision",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { body: batchRevertDecisionSchema },
    },
    async (req) =>
      batchRevertDecisions(req.userId as number, req.body.response_ids, req.body.decision),
  );

  // ── batch re-accept (declined/rejected/expired → accepted) ───────────────────
  r.post(
    "/api/responses/batch/re-accept",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { body: batchIdsSchema },
    },
    async (req) => batchReAccept(req.userId as number, req.body.response_ids),
  );

  // ── batch revoke spots (accepted/confirmed → rejected) ───────────────────────
  r.post(
    "/api/responses/batch/revoke-spot",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { body: batchIdsSchema },
    },
    async (req) => batchRevokeSpots(req.userId as number, req.body.response_ids),
  );
}
