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
  const reviewOrDecide = requireAnyCapability(
    CAPABILITIES.APPLICATIONS_REVIEW,
    CAPABILITIES.APPLICATIONS_DECIDE,
  );
  const reviewOrDecideAccess = anyCapability(
    CAPABILITIES.APPLICATIONS_REVIEW,
    CAPABILITIES.APPLICATIONS_DECIDE,
  );

  // ── H13: list responses for a form, with filters ───────────────────────────
  r.get(
    "/api/applications/:id/responses",
    {
      preHandler: reviewOrDecide,
      config: reviewOrDecideAccess,
      schema: {
        summary: "List a form's responses",
        description:
          "Staff read of every response to a form (H13), with optional status and name/email search filters, plus each response's aggregate review score.",
        params: idParamSchema,
        querystring: listResponsesQuerySchema,
      },
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
         WHERE u.account_state = 'active' AND u.anonymized_at IS NULL
           AND u.is_test_account = false
           AND ${filters.join(" AND ")}
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
      schema: {
        summary: "Score a response",
        description: "Upserts the caller's own review (score + notes) for one response (H13).",
        params: responseIdParamSchema,
        body: reviewUpsertSchema,
      },
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
      schema: {
        summary: "Set shared staff notes",
        description:
          "Replaces the shared (non-reviewer-specific) staff notes on one response (H13).",
        params: responseIdParamSchema,
        body: staffNotesSchema,
      },
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
      schema: {
        summary: "Record an internal decision",
        description:
          "Sets a response's internal accept/reject decision (H14). Not yet visible to the applicant — see send-decision.",
        params: responseIdParamSchema,
        body: decideSchema,
      },
    },
    async (req) => decide(req.userId as number, req.params.responseId, req.body.decision),
  );

  // ── H14: send an individual decision ────────────────────────────────────────
  r.post(
    "/api/responses/:responseId/send-decision",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: {
        summary: "Send a decision to the applicant",
        description:
          "Sends the already-recorded internal decision as the applicant-facing accept/reject email (H14). No-op if there is no unsent internal decision.",
        params: responseIdParamSchema,
      },
    },
    async (req) => sendDecision(req.userId as number, req.params.responseId),
  );

  // ── H14: batch send all unsent decisions for a form ─────────────────────────
  r.post(
    "/api/applications/:id/send-decisions",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: {
        summary: "Send all unsent decisions for a form",
        description:
          "Sends the applicant-facing email for every response with an unsent internal decision (H14); `include_rejected` controls whether rejections are sent too.",
        params: idParamSchema,
        body: sendDecisionsSchema,
      },
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
      schema: {
        summary: "Resend a decision",
        description:
          "Re-sends the decision email for a response already at accepted, rejected, or expired (H15) — an expired one returns to accepted, giving a second chance.",
        params: responseIdParamSchema,
      },
    },
    async (req) => resendDecision(req.userId as number, req.params.responseId),
  );

  // ── re-accept a declined/rejected/expired response ───────────────────────────
  r.post(
    "/api/responses/:responseId/re-accept",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: {
        summary: "Re-accept a response",
        description:
          "Moves a declined, rejected, or expired response back to accepted with a fresh confirmation token and email; re-checks capacity.",
        params: responseIdParamSchema,
      },
    },
    async (req) => reAccept(req.userId as number, req.params.responseId),
  );

  // ── revoke an accepted/confirmed spot → rejected (works post-confirmation) ────
  r.post(
    "/api/responses/:responseId/revoke-spot",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: {
        summary: "Revoke an accepted or confirmed spot",
        description:
          "Moves an accepted or confirmed response to rejected. Works post-confirmation, unlike a normal decision reversal.",
        params: responseIdParamSchema,
      },
    },
    async (req) => revokeSpot(req.userId as number, req.params.responseId),
  );

  // ── M3.3: one user's responses for their profile Application tab ─────────────
  r.get(
    "/api/users/:id/applications",
    {
      preHandler: reviewOrDecide,
      config: reviewOrDecideAccess,
      schema: {
        summary: "Get a user's application responses",
        description:
          "Every response a user has submitted, across all forms — what the admin panel's profile Application tab shows.",
        params: idParamSchema,
      },
    },
    async (req) => ({ responses: await listUserResponsesForStaff(req.params.id) }),
  );

  // ── decision pool (accepted/rejected/declined grouped for the review UI) ─────
  r.get(
    "/api/applications/:id/decision-pool",
    {
      preHandler: reviewOrDecide,
      config: reviewOrDecideAccess,
      schema: {
        summary: "Get a form's decision pool",
        description:
          "Responses for a form grouped by decision outcome (accepted/rejected/declined/expired, internal and sent), for the review UI's decision-pool view.",
        params: idParamSchema,
      },
    },
    async (req) => getDecisionPool(req.params.id),
  );

  // ── H14: revert a decision to review, or flip an unsent internal decision ────
  r.post(
    "/api/responses/:responseId/revert-decision",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: {
        summary: "Revert a decision",
        description:
          "Sends a decided response back to review, or flips/un-sends an internal decision to the other outcome (H14).",
        params: responseIdParamSchema,
        body: revertDecisionSchema,
      },
    },
    async (req) => revertDecision(req.userId as number, req.params.responseId, req.body.decision),
  );

  // ── H15: get confirm link with token ─────────────────────────────────────────
  r.get(
    "/api/responses/:responseId/confirm-link",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: {
        summary: "Get a response's confirm link",
        description:
          "Returns the H15 confirmation link and its expiry for a response still holding an unexpired token, so staff can hand it to an applicant directly.",
        params: responseIdParamSchema,
      },
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
      preHandler: reviewOrDecide,
      config: reviewOrDecideAccess,
      schema: {
        summary: "Get response detail",
        description:
          "Full staff-facing detail for one response, including its available next actions given its current status.",
        params: responseIdParamSchema,
      },
    },
    async (req) => getResponseDetail(req.params.responseId),
  );

  // ── staff edit response form data ────────────────────────────────────────────
  r.put(
    "/api/responses/:responseId",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_EDIT_RESPONSE),
      config: capability(CAPABILITIES.APPLICATIONS_EDIT_RESPONSE),
      schema: {
        summary: "Edit a response's form data",
        description: "Staff correction of a response's submitted form answers.",
        params: responseIdParamSchema,
        body: saveDraftSchema,
      },
    },
    async (req) => editResponse(req.userId as number, req.params.responseId, req.body.responses),
  );

  // ── batch operations ─────────────────────────────────────────────────────────
  r.post(
    "/api/responses/batch/decide",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: {
        summary: "Batch internal decision",
        description:
          "Records the same internal accept/reject decision (H14) for each response id; per-row failures are collected rather than aborting the batch.",
        body: batchDecideSchema,
      },
    },
    async (req) => batchDecide(req.userId as number, req.body.response_ids, req.body.decision),
  );

  r.post(
    "/api/responses/batch/send-decision",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: {
        summary: "Batch send never-sent decisions",
        description:
          "Sends the applicant-facing decision email for each response id, only for responses with an unsent internal decision (H14).",
        body: batchSendDecisionsSchema,
      },
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
      schema: {
        summary: "Batch revert decisions",
        description:
          "Reverts the decision for each response id — to review, or to the other internal decision (H14).",
        body: batchRevertDecisionSchema,
      },
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
      schema: {
        summary: "Batch re-accept",
        description:
          "Moves each declined, rejected, or expired response id back to accepted, re-checking capacity for each.",
        body: batchIdsSchema,
      },
    },
    async (req) => batchReAccept(req.userId as number, req.body.response_ids),
  );

  // ── batch revoke spots (accepted/confirmed → rejected) ───────────────────────
  r.post(
    "/api/responses/batch/revoke-spot",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      config: capability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: {
        summary: "Batch revoke spots",
        description: "Moves each accepted or confirmed response id to rejected.",
        body: batchIdsSchema,
      },
    },
    async (req) => batchRevokeSpots(req.userId as number, req.body.response_ids),
  );
}
