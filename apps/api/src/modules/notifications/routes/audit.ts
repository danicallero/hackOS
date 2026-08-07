import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../../db/pool.js";
import { requireCapability } from "../../../lib/capabilities.js";
import { routeAccessOption as routeAccess } from "../../../lib/route-policy.js";
import { queryAuditLog } from "../audit-service.js";
import { auditQuerySchema } from "../schemas.js";

/** H53 audit surface: filtered, paginated read view over audit_log. */
export function registerAuditRoutes(app: FastifyInstance): void {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    "/api/audit",
    {
      ...routeAccess({ kind: "capability", capability: CAPABILITIES.AUDIT_READ }),
      preHandler: requireCapability(CAPABILITIES.AUDIT_READ),
      schema: { querystring: auditQuerySchema },
    },
    async (req) => {
      const { limit, offset, ...rest } = req.query;
      return queryAuditLog(pool, { ...rest, limit, offset });
    },
  );
}
