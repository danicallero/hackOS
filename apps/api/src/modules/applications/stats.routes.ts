import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireCapability } from "../../lib/capabilities.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import { idParamSchema, statsQuerySchema } from "./schemas.js";
import { applicationStats } from "./stats.js";

/** H27 (LOGISTICS_STATS): pre-event statistics panel for one form. */
export function registerStatsRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/applications/:id/stats",
    {
      preHandler: requireCapability(CAPABILITIES.LOGISTICS_STATS),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.LOGISTICS_STATS }),
      schema: {
        summary: "Pre-event statistics for one form",
        description:
          "Aggregate counts for a form's responses (H27) — status breakdown, and, when `field` names a template field, that field's value distribution. Used by the pre-event statistics panel.",
        params: idParamSchema,
        querystring: statsQuerySchema,
      },
    },
    async (req) => applicationStats(req.params.id, req.query.field),
  );
}
