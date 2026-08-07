import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../../db/pool.js";
import { requireAuth } from "../../../lib/capabilities.js";
import { routeAccessOption as routeAccess } from "../../../lib/route-policy.js";
import { registerPushTokenBodySchema } from "../schemas.js";

/**
 * H4/H51/H55: mobile app registers its Expo push token here so operational
 * queue-call notices (non-optional per H51) and other push notifications can
 * reach the device. `token` is globally unique (push_tokens.token) — the same
 * physical device re-registering under a different signed-in account (shared
 * device, account switch) reassigns the row to the new owner rather than
 * erroring, matching the natural single-owner-per-device reality of a phone.
 * Failed/uninstalled tokens are removed by the dispatcher itself on
 * DeviceNotRegistered (notifications/channels/push.ts).
 */
export function registerPushTokenRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.post(
    "/api/me/push-tokens",
    {
      ...routeAccess({ kind: "authenticated" }),
      preHandler: requireAuth,
      schema: {
        summary: "Register an Expo push token",
        description:
          "Upserts the caller's Expo push token so operational notifications " +
          "(queue calls, announcements) can reach this device. Idempotent: " +
          "re-registering the same token reassigns it to the calling user.",
        body: registerPushTokenBodySchema,
        response: { 200: z.object({ status: z.literal(true) }) },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const { token, platform } = req.body;
      await pool.query(
        `INSERT INTO push_tokens (user_id, token, platform)
         VALUES ($1, $2, $3)
         ON CONFLICT (token) DO UPDATE SET user_id = $1, platform = $3, updated_at = now()`,
        [userId, token, platform ?? null],
      );
      return { status: true as const };
    },
  );
}
