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
 *
 * Latency (H3): without a session, better-auth@1.6.23
 * (`dist/api/routes/email-verification.mjs`, `/send-verification-email`,
 * `MINIMUM_MS = 500`) sleeps until 500 ms have elapsed so "unknown / already
 * verified" cannot be told apart from "unverified" by timing. Every
 * unauthenticated call therefore takes at least 500 ms; do not lower it.
 * Delivery is the notification outbox, never inline. Time above the floor is
 * not attributed here: each phase is timed and a slow request logs the split.
 */
/** Better Auth's anti-enumeration floor for the unauthenticated path. */
const ANTI_ENUMERATION_FLOOR_MS = 500;
const SLOW_AUTH_MS = ANTI_ENUMERATION_FLOOR_MS + 250;
const SLOW_LIMIT_MS = 100;

/** Log fields when a phase exceeds its threshold, otherwise null. No PII. */
export function slowResendPhases(
  limitMs: number,
  authMs: number,
): { rateLimitMs: number; betterAuthMs: number; floorMs: number } | null {
  if (authMs <= SLOW_AUTH_MS && limitMs <= SLOW_LIMIT_MS) return null;
  return {
    rateLimitMs: Math.round(limitMs),
    betterAuthMs: Math.round(authMs),
    floorMs: ANTI_ENUMERATION_FLOOR_MS,
  };
}

export function registerResendVerificationRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.post(
    "/api/auth/resend-verification",
    {
      config: {
        routeAccessPolicy: {
          kind: "token",
          policy: "email-verification-resend",
          edition: "global",
        } satisfies RouteAccessPolicy,
      },
      schema: {
        summary: "Resend the sign-up verification email",
        description:
          "Rate limited to 3/hour with a 60s cooldown between attempts (H3), enforced in Valkey before delegating the actual token issuance and outbox enqueue to Better Auth. `callbackURL` optionally carries the same-origin destination to return to after verifying (#188).",
        body: z.object({
          email: z.string().email(),
          // The web app's own path to redirect back to after verification
          // (#188 return-path continuity); forwarded to Better Auth as-is,
          // which stamps it into the emailed verify link's callbackURL.
          callbackURL: z.string().optional(),
        }),
        response: { 200: z.object({ status: z.literal(true) }) },
      },
    },
    async (req) => {
      const { email, callbackURL } = req.body;
      const t0 = performance.now();
      const limit = await checkResendVerificationRateLimit(email);
      const limitMs = performance.now() - t0;
      if (!limit.allowed) {
        throw new TooManyRequestsError(
          "Too many verification requests — try again later.",
          limit.retryAfterSeconds,
        );
      }
      const t1 = performance.now();
      await auth.api.sendVerificationEmail({ body: { email, callbackURL } });
      const authMs = performance.now() - t1;
      const slow = slowResendPhases(limitMs, authMs);
      if (slow) {
        req.log.warn(
          { route: "resend-verification", ...slow },
          "resend-verification slower than the anti-enumeration floor",
        );
      }
      return { status: true as const };
    },
  );
}
