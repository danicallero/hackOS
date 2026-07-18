import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { confirmTokenSchema, responseIdParamSchema } from "./schemas.js";
import {
  confirmByResponseId,
  confirmByToken,
  declineByResponseId,
  declineByToken,
} from "./service.js";

/**
 * H15: confirm/decline a spot via three audited routes —
 *   via=email_link : public POST with the token from the acceptance email
 *   via=web        : authenticated owner action on their own response
 *   via=admin_override : staff (APPLICATIONS_DECIDE) acting on behalf
 * Confirm only while the token is unexpired AND status is accepted; a second
 * confirm is idempotent-friendly (returns already-confirmed). Declining just
 * moves status → declined; dietary data is left in place so the applicant
 * can be re-accepted later without losing it.
 */
export function registerConfirmRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── public via email link ───────────────────────────────────────────────────
  r.post(
    "/api/applications/confirm",
    { preHandler: idempotencyGuard, schema: { body: confirmTokenSchema } },
    async (req) => {
      const res = await confirmByToken(req.body.token);
      return {
        status: res.status,
        already_confirmed: res.alreadyConfirmed,
        ticket_token: res.ticketToken,
      };
    },
  );

  // ── public decline via email link ──────────────────────────────────────────
  r.post(
    "/api/applications/decline",
    { preHandler: idempotencyGuard, schema: { body: confirmTokenSchema } },
    async (req) => {
      const res = await declineByToken(req.body.token);
      return {
        status: res.status,
        already_declined: res.alreadyDeclined,
      };
    },
  );

  // ── authenticated owner (web) ───────────────────────────────────────────────
  r.post(
    "/api/me/responses/:responseId/confirm",
    { preHandler: [requireAuth, idempotencyGuard], schema: { params: responseIdParamSchema } },
    async (req) => {
      const uid = req.userId as number;
      const res = await confirmByResponseId(req.params.responseId, "web", uid, uid);
      return {
        status: res.status,
        already_confirmed: res.alreadyConfirmed,
        ticket_token: res.ticketToken,
      };
    },
  );

  r.post(
    "/api/me/responses/:responseId/decline",
    { preHandler: requireAuth, schema: { params: responseIdParamSchema } },
    async (req) => {
      const uid = req.userId as number;
      const res = await declineByResponseId(req.params.responseId, "web", uid, uid);
      return {
        status: res.status,
        already_declined: res.alreadyDeclined,
      };
    },
  );

  // ── admin override ──────────────────────────────────────────────────────────
  r.post(
    "/api/responses/:responseId/confirm",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_CONFIRM_OVERRIDE),
      schema: { params: responseIdParamSchema },
    },
    async (req) => {
      const res = await confirmByResponseId(
        req.params.responseId,
        "admin_override",
        req.userId as number,
      );
      return {
        status: res.status,
        already_confirmed: res.alreadyConfirmed,
        ticket_token: res.ticketToken,
      };
    },
  );

  r.post(
    "/api/responses/:responseId/decline",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_CONFIRM_OVERRIDE),
      schema: { params: responseIdParamSchema },
    },
    async (req) => {
      const res = await declineByResponseId(
        req.params.responseId,
        "admin_override",
        req.userId as number,
      );
      return {
        status: res.status,
        already_declined: res.alreadyDeclined,
      };
    },
  );
}
