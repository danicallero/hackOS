import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import {
  confirmByEmailResponseSchema,
  confirmTokenSchema,
  responseIdParamSchema,
} from "./schemas.js";
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
 * Email links are single-use; a replay with the same Idempotency-Key returns
 * the stored result. Declining just
 * moves status → declined; dietary data is left in place so the applicant
 * can be re-accepted later without losing it.
 */
export function registerConfirmRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── public via email link ───────────────────────────────────────────────────
  r.post(
    "/api/applications/confirm",
    {
      preHandler: idempotencyGuard,
      config: routeAccess({
        kind: "token",
        policy: "application-confirmation",
        emailVerification: "target",
      }),
      schema: {
        body: confirmTokenSchema,
        summary: "Confirm a spot from the acceptance email",
        description:
          "Public single-use confirm for the acceptance-email token (H15). A deliberate POST validates token purpose, expiry, unused state, response association, target user and current email under transaction locks; GET never mutates. The token is not a session. Confirmation assigns configured roles and returns a ticket and a one-hour, owner-scoped wallet credential when event access exists. Same-key retries replay the first result; a new request with a used token fails with confirmation_used and never reissues a credential. The response includes the owner ID and masked email for safe session handling.",
        response: { 200: confirmByEmailResponseSchema },
      },
    },
    async (req) => {
      const res = await confirmByToken(req.body.token);
      return {
        status: res.status,
        already_confirmed: res.alreadyConfirmed,
        ticket_token: res.ticketToken,
        user_id: res.userId,
        masked_email: res.maskedEmail,
        holder_name: res.holderName,
        wallet_token: res.walletToken,
        wallet_token_expires_at: res.walletTokenExpiresAt,
      };
    },
  );

  // ── public decline via email link ──────────────────────────────────────────
  r.post(
    "/api/applications/decline",
    {
      preHandler: idempotencyGuard,
      config: routeAccess({
        kind: "token",
        policy: "application-confirmation",
        emailVerification: "target",
      }),
      schema: {
        body: confirmTokenSchema,
        summary: "Decline a spot from the acceptance email",
        description:
          "Public single-use decline for the acceptance-email token (H15). A deliberate POST validates the token and current owner/email under transaction locks before moving an accepted response to declined. Same-key retries replay the result; a used token cannot reverse an earlier confirmation or decline.",
      },
    },
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
    {
      preHandler: [requireAuth, idempotencyGuard],
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        summary: "Confirm my own spot",
        description:
          "Authenticated owner confirms their own accepted response (H15), the web counterpart to the email-link confirm route.",
        params: responseIdParamSchema,
      },
    },
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
    {
      preHandler: [requireAuth, idempotencyGuard],
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        summary: "Decline my own spot",
        description: "Authenticated owner declines their own accepted response (H15).",
        params: responseIdParamSchema,
      },
    },
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
      config: routeAccess({
        kind: "capability",
        capability: CAPABILITIES.APPLICATIONS_CONFIRM_OVERRIDE,
      }),
      schema: {
        summary: "Confirm a spot on the applicant's behalf",
        description:
          "Staff override that confirms any accepted response (H15), for a participant who can't complete the confirm flow themselves.",
        params: responseIdParamSchema,
      },
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
      config: routeAccess({
        kind: "capability",
        capability: CAPABILITIES.APPLICATIONS_CONFIRM_OVERRIDE,
      }),
      schema: {
        summary: "Decline a spot on the applicant's behalf",
        description: "Staff override that declines any accepted response (H15).",
        params: responseIdParamSchema,
      },
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
