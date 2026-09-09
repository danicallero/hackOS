import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireAuth, requireCapability, userHasCapability } from "../../lib/capabilities.js";
import { ForbiddenError } from "../../lib/errors.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import { lockRoleGraph, requireRoleMutationAuthority } from "../identity/role-authority.js";
import { canonicalStatisticsPanelKey } from "../statistics/catalog.js";
import { idParamSchema, statsPanelAccessSchema, statsQuerySchema } from "./schemas.js";
import { requireApplication } from "./service.js";
import { allowedStatisticsPanels, applicationStats, statisticsPanelKeys } from "./stats.js";

const statsAccessRoleParamsSchema = idParamSchema.extend({
  roleId: z.coerce.number().int().positive(),
});

type StatsAccessRow = {
  panel_key: string;
  role_id: number;
  state: "allow" | "inherit" | "deny";
  role_name: string;
  position: number;
};

function canonicalAccessRows(rows: StatsAccessRow[]): StatsAccessRow[] {
  const priority = { inherit: 0, allow: 1, deny: 2 } as const;
  const canonical = new Map<string, StatsAccessRow>();
  for (const row of rows) {
    const panelKey = canonicalStatisticsPanelKey(row.panel_key);
    const key = `${panelKey}:${row.role_id}`;
    const previous = canonical.get(key);
    if (!previous || priority[row.state] > priority[previous.state]) {
      canonical.set(key, { ...row, panel_key: panelKey });
    }
  }
  return [...canonical.values()];
}

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
        `SELECT r.id, r.name, r.position, COALESCE(rc.state, 'inherit') AS general_state
           FROM roles r
           LEFT JOIN role_capabilities rc
             ON rc.role_id = r.id AND rc.capability = $2
          WHERE r.deleted_at IS NULL AND ($1::integer IS NULL OR r.position < $1)
          ORDER BY r.position DESC`,
        [actorPosition, CAPABILITIES.LOGISTICS_STATS],
      );
      const panelKeys = statisticsPanelKeys(application.template);
      const panelLabels = Object.fromEntries(
        application.template
          .map(
            (field) =>
              [`field:${field.key.toLowerCase()}`, field.statistics?.label ?? field.label] as const,
          )
          .filter(([key]) => panelKeys.has(key)),
      );
      return {
        panel_keys: [...panelKeys],
        panel_labels: panelLabels,
        access: canonicalAccessRows(rows as StatsAccessRow[]),
        roles,
      };
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
        await lockRoleGraph(client);
        const application = await requireApplication(client, req.params.id);
        const panelKey = canonicalStatisticsPanelKey(req.body.panel_key);
        if (!statisticsPanelKeys(application.template).has(panelKey)) {
          throw new ForbiddenError("Statistics panel is not reportable");
        }
        const { rows: roles } = await client.query(
          `SELECT position FROM roles WHERE id = $1 AND deleted_at IS NULL`,
          [req.body.role_id],
        );
        if (!roles[0]) throw new ForbiddenError("Role not found");
        await requireRoleMutationAuthority(client, req.userId as number, Number(roles[0].position));
        const { rows: before } = await client.query(
          `SELECT panel_key, state FROM application_stats_panel_role_access
            WHERE application_id = $1 AND panel_key = ANY($2::text[]) AND role_id = $3`,
          [
            application.id,
            panelKey === "overview" ? ["overview", "funnel"] : [panelKey],
            req.body.role_id,
          ],
        );
        if (panelKey === "overview") {
          await client.query(
            `DELETE FROM application_stats_panel_role_access
              WHERE application_id = $1 AND panel_key = 'funnel' AND role_id = $2`,
            [application.id, req.body.role_id],
          );
        }
        await client.query(
          `INSERT INTO application_stats_panel_role_access (application_id, panel_key, role_id, state)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (application_id, panel_key, role_id) DO UPDATE SET state = EXCLUDED.state`,
          [application.id, panelKey, req.body.role_id, req.body.state],
        );
        await audit(client, {
          actorId: req.userId,
          entityType: "application_statistics_panel",
          entityId: `${application.id}:${panelKey}`,
          action: "access_changed",
          before: before[0] ?? null,
          after: { ...req.body, panel_key: panelKey },
        });
        return { ok: true };
      }),
  );

  r.delete(
    "/api/applications/:id/stats/access/:roleId",
    {
      preHandler: requireCapability(CAPABILITIES.STATISTICS_MANAGE),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.STATISTICS_MANAGE }),
      schema: {
        summary: "Remove a role's application statistics overrides",
        description:
          "Removes every panel-specific override for one role on this application scope without changing the role's general Statistics capability.",
        params: statsAccessRoleParamsSchema,
      },
    },
    async (req) =>
      withTransaction(async (client) => {
        await lockRoleGraph(client);
        const application = await requireApplication(client, req.params.id);
        const { rows: roles } = await client.query(
          `SELECT position FROM roles WHERE id = $1 AND deleted_at IS NULL`,
          [req.params.roleId],
        );
        if (!roles[0]) throw new ForbiddenError("Role not found");
        await requireRoleMutationAuthority(client, req.userId as number, Number(roles[0].position));
        const { rows: before } = await client.query(
          `SELECT panel_key, state FROM application_stats_panel_role_access
            WHERE application_id = $1 AND role_id = $2 ORDER BY panel_key`,
          [application.id, req.params.roleId],
        );
        await client.query(
          `DELETE FROM application_stats_panel_role_access
            WHERE application_id = $1 AND role_id = $2`,
          [application.id, req.params.roleId],
        );
        await audit(client, {
          actorId: req.userId,
          entityType: "application_statistics_role_access",
          entityId: `${application.id}:${req.params.roleId}`,
          action: "access_removed",
          before,
          after: null,
        });
        return { ok: true };
      }),
  );

  r.get(
    "/api/applications/stats/forms",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        summary: "List application forms available for statistics",
        description:
          "Returns only the application forms for which the caller has at least one allowed statistics panel. Statistics managers receive every form; general readers also inherit all non-denied panels, while panel-only readers receive only forms with an explicit panel grant.",
      },
    },
    async (req) => {
      const manages = await userHasCapability(
        req.userId as number,
        CAPABILITIES.STATISTICS_MANAGE,
        req,
      );
      const generalAccess = await userHasCapability(
        req.userId as number,
        CAPABILITIES.LOGISTICS_STATS,
        req,
      );
      const { rows } = await pool.query<{ id: number; name: string }>(
        `SELECT id, name FROM applications ORDER BY id`,
      );
      if (manages) return { applications: rows };

      const accessible = await Promise.all(
        rows.map(async (application) => ({
          application,
          panels: await allowedStatisticsPanels(
            application.id,
            req.userId as number,
            generalAccess,
          ),
        })),
      );
      const applications = accessible
        .filter(({ panels }) => panels.size > 0)
        .map(({ application }) => application);
      if (applications.length === 0)
        throw new ForbiddenError("No statistics panels are shared with you");
      return { applications };
    },
  );

  r.get(
    "/api/applications/:id/stats",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "contextual", policy: "application-statistics-panels" }),
      schema: {
        summary: "Pre-event statistics for one form",
        description:
          "Aggregate counts for a form's responses (H27) — status breakdown, time series, logistics distributions, and explicitly published form-question distributions. A caller with general logistics-statistics access inherits every reportable panel unless a higher-priority role denies it; direct panel grants can also share one panel. New questions stay private until their statistics configuration is enabled; legacy choice panels are preserved by migration. Checkbox values other than explicit true, including unanswered responses, count as false. `field` can request one field histogram directly.",
        params: idParamSchema,
        querystring: statsQuerySchema,
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const manages = await userHasCapability(userId, CAPABILITIES.STATISTICS_MANAGE, req);
      if (manages) return applicationStats(req.params.id, req.query.field);
      const generalAccess = await userHasCapability(userId, CAPABILITIES.LOGISTICS_STATS, req);
      const allowed = await allowedStatisticsPanels(req.params.id, userId, generalAccess);
      if (allowed.size === 0) throw new ForbiddenError("No statistics panels are shared with you");
      return applicationStats(req.params.id, req.query.field, allowed);
    },
  );
}
