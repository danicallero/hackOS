import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../db/pool.js";
import { requireCapability } from "../../lib/capabilities.js";
import {
  decideSchema,
  idParamSchema,
  listResponsesQuerySchema,
  responseIdParamSchema,
  reviewUpsertSchema,
  sendDecisionsSchema,
  staffNotesSchema,
} from "./schemas.js";
import {
  decide,
  resendDecision,
  sendDecision,
  sendDecisionsBatch,
  setStaffNotes,
  startReview,
  upsertReview,
} from "./service.js";

/**
 * H13 (APPLICATIONS_REVIEW): list + score responses, shared staff notes.
 * H14 (APPLICATIONS_DECIDE): internal accept/reject, batch/individual send,
 * resend.
 */
export function registerReviewRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── H13: list responses for a form, with filters ───────────────────────────
  r.get(
    "/api/applications/:id/responses",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_REVIEW),
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
        `SELECT r.id, r.user_id, u.name, u.email, r.status, r.responses, r.staff_notes,
                r.submitted_at, r.decision_sent_at,
                COALESCE(avg(ar.score), NULL) AS avg_score,
                count(ar.author_id)::int AS review_count
         FROM application_responses r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN applicant_reviews ar ON ar.response_id = r.id
         WHERE ${filters.join(" AND ")}
         GROUP BY r.id, u.name, u.email
         ORDER BY r.id`,
        params,
      );
      return { responses: rows };
    },
  );

  // ── H13: submitted -> review ────────────────────────────────────────────────
  r.post(
    "/api/responses/:responseId/start-review",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_REVIEW),
      schema: { params: responseIdParamSchema },
    },
    async (req) => startReview(req.userId as number, req.params.responseId),
  );

  // ── H13: per-reviewer score/notes (own row) ─────────────────────────────────
  r.put(
    "/api/responses/:responseId/my-review",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_REVIEW),
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
      schema: { params: responseIdParamSchema, body: decideSchema },
    },
    async (req) => decide(req.userId as number, req.params.responseId, req.body.decision),
  );

  // ── H14: send an individual decision ────────────────────────────────────────
  r.post(
    "/api/responses/:responseId/send-decision",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
      schema: { params: responseIdParamSchema },
    },
    async (req) => sendDecision(req.userId as number, req.params.responseId),
  );

  // ── H14: batch send all unsent decisions for a form ─────────────────────────
  r.post(
    "/api/applications/:id/send-decisions",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_DECIDE),
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
      schema: { params: responseIdParamSchema },
    },
    async (req) => resendDecision(req.userId as number, req.params.responseId),
  );
}
