import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../../db/pool.js";
import { requireCapability } from "../../../lib/capabilities.js";
import { NotFoundError } from "../../../lib/errors.js";
import { routeAccessOption as routeAccess } from "../../../lib/route-policy.js";
import { queryAuditActionVocabulary, queryAuditLog, queryAuditLogById } from "../audit-service.js";
import { auditIdParamsSchema, auditQuerySchema } from "../schemas.js";

/** H53 audit surface: filtered, paginated read view over audit_log. */
export function registerAuditRoutes(app: FastifyInstance): void {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    "/api/audit",
    {
      ...routeAccess({ kind: "capability", capability: CAPABILITIES.AUDIT_READ }),
      preHandler: requireCapability(CAPABILITIES.AUDIT_READ),
      schema: {
        summary: "Query audit log",
        description:
          "Filtered, paginated read view over H53 audit events for sensitive mutations (announcements, preferences, etc). Each row includes the acting user's name/surname/email (actor_name/actor_surname/actor_email) alongside actor_id, resolved via a left join so system-originated rows (actor_id null) still return.",
        querystring: auditQuerySchema,
      },
    },
    async (req) => {
      const { limit, offset, ...rest } = req.query;
      return queryAuditLog(pool, { ...rest, limit, offset });
    },
  );

  typedApp.get(
    "/api/audit/actions",
    {
      ...routeAccess({ kind: "capability", capability: CAPABILITIES.AUDIT_READ }),
      preHandler: requireCapability(CAPABILITIES.AUDIT_READ),
      schema: {
        summary: "List audit action/entity-type vocabulary",
        description:
          "Distinct {action, entityType} pairs actually present in audit_log, used to populate the audit log's Action and Entity type filter dropdowns without guessing exact strings.",
      },
    },
    async () => {
      const items = await queryAuditActionVocabulary(pool);
      return { items };
    },
  );

  typedApp.get(
    "/api/audit/:id",
    {
      ...routeAccess({ kind: "capability", capability: CAPABILITIES.AUDIT_READ }),
      preHandler: requireCapability(CAPABILITIES.AUDIT_READ),
      schema: {
        summary: "Get one audit log entry",
        description:
          "Single audit_log row by id, same shape as the list query's items, backing the audit log's detail route.",
        params: auditIdParamsSchema,
      },
    },
    async (req) => {
      const row = await queryAuditLogById(pool, req.params.id);
      if (!row) throw new NotFoundError("Audit log entry not found");
      return row;
    },
  );
}
