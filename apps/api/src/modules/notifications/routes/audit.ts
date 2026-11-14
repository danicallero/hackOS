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
          "Filtered H53 audit trail. Includes executor type, verified actor, initiating user for automatic work, changed field names, safe operational snapshots and server-generated request correlation. Badge IDs and email/reference identifiers remain visible as operational evidence; private notes, answers and authentication secrets are minimized. Known automatic actions use System for executor and source, including legacy entries. actorId/actorQuery match actors and initiators; actorQuery ignores case and accents. requestId groups related actions. entity_label carries the current name of catalogue subjects (university, degree, enterprise, challenge, role, room, application, activity, active user), or null when the subject has no name or no longer exists.",
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
          "Single privacy-minimized H53 audit entry, including changed_fields, actor_kind, initiated_by, initiator_name, request_id, entity_label and last_edited_at when known. Historical missing context remains unknown.",
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
