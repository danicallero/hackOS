import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { TooManyRequestsError } from "../../../lib/errors.js";
import type { RouteAccessPolicy } from "../../../lib/route-policy.js";
import { auth } from "../auth.js";
import { checkResendVerificationRateLimit } from "../rate-limit.js";

/**
 * H3: resend verification email, rate limited (3/hour, 60s between
 * attempts) via Valkey. This has to be a route of our own rather than just
 * calling Better Auth's built-in POST /api/auth/send-verification-email
 * directly: that endpoint is served through the raw Better Auth pass-through
 * (index.ts), whose thrown errors never reach our Fastify error handler, so
 * there's no way to surface a `TooManyRequestsError` (with `retry-after`)
 * from inside it. Here we enforce the limit ourselves first, then call
 * Better Auth's endpoint server-side (`auth.api.sendVerificationEmail`) to
 * do the actual (enumeration-safe, timing-equalized) token issuance +
 * outbox enqueue.
 */
export function registerResendVerificationRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.post(
    "/api/auth/resend-verification",
    {
      config: {
        routeAccessPolicy: {
          kind: "token",
          policy: "email-verification-resend",
        } satisfies RouteAccessPolicy,
      },
      schema: {
        summary:
          "Resend the sign-up verification email (H3: 3/hour, 60s cooldown), optionally carrying the same-origin destination to return to after verifying (H188).",
        body: z.object({
          email: z.string().email(),
          // The web app's own path to redirect back to after verification
          // (H188 return-path continuity); forwarded to Better Auth as-is,
          // which stamps it into the emailed verify link's callbackURL.
          callbackURL: z.string().optional(),
        }),
        response: { 200: z.object({ status: z.literal(true) }) },
      },
    },
    async (req) => {
      const { email, callbackURL } = req.body;
      const limit = await checkResendVerificationRateLimit(email);
      if (!limit.allowed) {
        throw new TooManyRequestsError(
          "Too many verification requests — try again later.",
          limit.retryAfterSeconds,
        );
      }
      await auth.api.sendVerificationEmail({ body: { email, callbackURL } });
      return { status: true as const };
    },
  );
}
