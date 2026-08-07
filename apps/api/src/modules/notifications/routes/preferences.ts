import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../../db/pool.js";
import { requireAuth, userHasCapability } from "../../../lib/capabilities.js";
import { ForbiddenError } from "../../../lib/errors.js";
import { routeAccessOption as routeAccess } from "../../../lib/route-policy.js";
import { setPreferencesBodySchema } from "../schemas.js";
import { getPreferences, QUEUE_STAFF_CATEGORY, setPreferences } from "../service.js";

/** H51: participant-facing notification preference matrix, incl. schedule:<id> reminder opt-ins. */
export function registerPreferenceRoutes(app: FastifyInstance): void {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    "/api/me/notification-preferences",
    { ...routeAccess({ kind: "authenticated" }), preHandler: requireAuth },
    async (req) => {
      return getPreferences(pool, req.userId as number);
    },
  );

  typedApp.put(
    "/api/me/notification-preferences",
    {
      ...routeAccess({ kind: "authenticated" }),
      preHandler: requireAuth,
      schema: { body: setPreferencesBodySchema },
    },
    async (req) => {
      if (req.body.preferences.some((item) => item.category === QUEUE_STAFF_CATEGORY)) {
        const userId = req.userId as number;
        const allowed = await Promise.all([
          userHasCapability(userId, CAPABILITIES.QUEUE_OPERATE),
          userHasCapability(userId, CAPABILITIES.QUEUE_ADMIN),
          userHasCapability(userId, CAPABILITIES.JUDGE_PANEL),
        ]);
        if (!allowed.some(Boolean)) {
          throw new ForbiddenError("Queue staff notifications require queue or judging access");
        }
      }
      await setPreferences(pool, req.userId as number, req.body.preferences);
      return getPreferences(pool, req.userId as number);
    },
  );
}
