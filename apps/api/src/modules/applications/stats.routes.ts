import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireCapability } from "../../lib/capabilities.js";
import { idParamSchema, statsQuerySchema } from "./schemas.js";
import { applicationStats } from "./stats.js";

/** H27 (LOGISTICS_STATS): pre-event statistics panel for one form. */
export function registerStatsRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/applications/:id/stats",
    {
      preHandler: requireCapability(CAPABILITIES.LOGISTICS_STATS),
      schema: { params: idParamSchema, querystring: statsQuerySchema },
    },
    async (req) => applicationStats(req.params.id, req.query.field),
  );
}
