import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import { requireCapability } from "../../../lib/capabilities.js";
import { ServiceUnavailableError } from "../../../lib/errors.js";
import { idempotencyGuard } from "../../../lib/idempotency.js";
import { routeAccessOption as routeAccess } from "../../../lib/route-policy.js";
import { sendNoticeEmail } from "../channels/email.js";

const testEmailBody = z.object({
  to: z.string().email().max(254),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  language: z.enum(["es", "gl", "en"]).default("es"),
});

/** H52: individual email notice from the no-reply sender, for delivery and rendering checks. */
export function registerTestEmailRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.post(
    "/api/notifications/test-email",
    {
      ...routeAccess({ kind: "capability", capability: CAPABILITIES.NOTIFICATIONS_SEND }),
      preHandler: [requireCapability(CAPABILITIES.NOTIFICATIONS_SEND), idempotencyGuard],
      schema: {
        summary: "Send an individual email notice",
        description:
          "Sends one email with the given subject and body to any address, from the no-reply " +
          "notifications sender and in the standard branded layout, to check delivery and " +
          "rendering. It goes straight to the mail relay, not through the outbox, so a relay " +
          "failure is returned as 503. Audited without storing the message body (H52, H53).",
        body: testEmailBody,
        response: { 200: z.object({ status: z.literal(true) }) },
      },
    },
    async (req) => {
      const { to, subject, body, language } = req.body;
      try {
        await sendNoticeEmail(to, { subject, body, language });
      } catch (err) {
        console.error("[notifications:test-email] relay rejected the message", err);
        throw new ServiceUnavailableError("The mail relay could not send the message");
      }
      await audit(pool, {
        actorId: req.userId as number,
        entityType: "email",
        entityId: to,
        action: "test_email_sent",
        after: { subject, language },
      });
      return { status: true as const };
    },
  );
}
