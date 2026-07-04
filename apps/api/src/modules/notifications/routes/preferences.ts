import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../../db/pool.js";
import { requireAuth } from "../../../lib/capabilities.js";
import { setPreferencesBodySchema } from "../schemas.js";
import { getPreferences, setPreferences } from "../service.js";

/** H51: participant-facing notification preference matrix, incl. schedule:<id> reminder opt-ins. */
export function registerPreferenceRoutes(app: FastifyInstance): void {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get("/api/me/notification-preferences", { preHandler: requireAuth }, async (req) => {
    return getPreferences(pool, req.userId as number);
  });

  typedApp.put(
    "/api/me/notification-preferences",
    { preHandler: requireAuth, schema: { body: setPreferencesBodySchema } },
    async (req) => {
      await setPreferences(pool, req.userId as number, req.body.preferences);
      return getPreferences(pool, req.userId as number);
    },
  );
}
