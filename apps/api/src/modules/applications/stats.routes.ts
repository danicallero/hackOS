import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireAuth, requireCapability, userHasCapability } from "../../lib/capabilities.js";
import { ForbiddenError } from "../../lib/errors.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import { requireRoleMutationAuthority } from "../identity/role-authority.js";
import { idParamSchema, statsPanelAccessSchema, statsQuerySchema } from "./schemas.js";
import { requireApplication } from "./service.js";
import { allowedStatisticsPanels, applicationStats, statisticsPanelKeys } from "./stats.js";

/** H27 (LOGISTICS_STATS): pre-event statistics panel for one form. */
export function registerStatsRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/applications/:id/stats/access",
    {
      preHandler: requireCapability(CAPABILITIES.STATISTICS_MANAGE),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.STATISTICS_MANAGE }),
      schema: {
        summary: "List statistics panel access",
        description: "Role ACL for dynamic application statistics panels.",
        params: idParamSchema,
      },
    },
    async (req) => {
      const application = await requireApplication(pool, req.params.id);
      const { rows: actorRoles } = await pool.query(
        `SELECT max(r.position) AS position FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = $1 AND r.deleted_at IS NULL`,
        [req.userId],
      );
      const actorPosition = actorRoles[0]?.position == null ? null : Number(actorRoles[0].position);
      const { rows } = await pool.query(
        `SELECT a.panel_key, a.role_id, a.state, r.name AS role_name, r.position
           FROM application_stats_panel_role_access a JOIN roles r ON r.id = a.role_id
          WHERE a.application_id = $1 AND r.deleted_at IS NULL ORDER BY a.panel_key, r.position DESC`,
        [application.id],
      );
      const { rows: roles } = await pool.query(
        `SELECT id, name, position FROM roles
          WHERE deleted_at IS NULL AND ($1::integer IS NULL OR position < $1)
          ORDER BY position DESC`,
        [actorPosition],
      );
      return { panel_keys: [...statisticsPanelKeys(application.template)], access: rows, roles };
    },
  );

  r.put(
    "/api/applications/:id/stats/access",
    {
      preHandler: requireCapability(CAPABILITIES.STATISTICS_MANAGE),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.STATISTICS_MANAGE }),
      schema: {
        summary: "Set statistics panel role access",
        description:
          "Sets one role's allow, inherit, or deny state for an existing application statistics panel.",
        params: idParamSchema,
        body: statsPanelAccessSchema,
      },
    },
    async (req) =>
      withTransaction(async (client) => {
        const application = await requireApplication(client, req.params.id);
        if (!statisticsPanelKeys(application.template).has(req.body.panel_key)) {
          throw new ForbiddenError("Statistics panel is not reportable");
        }
        const { rows: roles } = await client.query(
          `SELECT position FROM roles WHERE id = $1 AND deleted_at IS NULL`,
          [req.body.role_id],
        );
        if (!roles[0]) throw new ForbiddenError("Role not found");
        await requireRoleMutationAuthority(client, req.userId as number, Number(roles[0].position));
        const { rows: before } = await client.query(
          `SELECT state FROM application_stats_panel_role_access WHERE application_id = $1 AND panel_key = $2 AND role_id = $3`,
          [application.id, req.body.panel_key, req.body.role_id],
        );
        await client.query(
          `INSERT INTO application_stats_panel_role_access (application_id, panel_key, role_id, state)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (application_id, panel_key, role_id) DO UPDATE SET state = EXCLUDED.state`,
          [application.id, req.body.panel_key, req.body.role_id, req.body.state],
        );
        await audit(client, {
          actorId: req.userId,
          entityType: "application_statistics_panel",
          entityId: `${application.id}:${req.body.panel_key}`,
          action: "access_changed",
          before: before[0] ?? null,
          after: req.body,
        });
        return { ok: true };
      }),
  );

  r.get(
    "/api/applications/:id/stats",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "contextual", policy: "application-statistics-panels" }),
      schema: {
        summary: "Pre-event statistics for one form",
        description:
          "Aggregate counts for a form's responses (H27) — status breakdown, time series, logistics distributions, and form-driven field distributions. Choice fields are included automatically; other fields must be explicitly marked reportable in the form builder. `field` can request one field histogram directly.",
        params: idParamSchema,
        querystring: statsQuerySchema,
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const manages = await userHasCapability(userId, CAPABILITIES.STATISTICS_MANAGE, req);
      if (manages) return applicationStats(req.params.id, req.query.field);
      const allowed = await allowedStatisticsPanels(req.params.id, userId);
      if (allowed.size === 0) throw new ForbiddenError("No statistics panels are shared with you");
      return applicationStats(req.params.id, req.query.field, allowed);
    },
  );
}
