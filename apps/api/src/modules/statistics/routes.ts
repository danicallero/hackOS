import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireAuth, userHasCapability } from "../../lib/capabilities.js";
import { ForbiddenError } from "../../lib/errors.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import { lockRoleGraph, requireRoleMutationAuthority } from "../identity/role-authority.js";
import { canonicalStatisticsPanelKey, ROLE_SCOPE_PANEL_KEYS } from "./catalog.js";
import {
  accessibleStatisticsScopes,
  parseStatisticsScopeKey,
  queryStatistics,
  type StatisticsQuery,
  statisticsCsv,
} from "./service.js";

const statisticsQueryBody = z
  .object({
    scopes: z
      .array(z.string().regex(/^(application|role):[0-9]+$/))
      .min(1)
      .max(50),
    panel_keys: z
      .array(z.string().regex(/^[a-z0-9:_-]+$/))
      .max(100)
      .optional(),
  })
  .strict();

const statisticsExportQuery = z.object({
  scopes: z.string().min(1),
  panels: z.string().optional(),
});

const statisticsScopeAccessBody = z
  .object({
    scope_key: z.string().regex(/^(application|role):[0-9]+$/),
    panel_key: z.string().regex(/^[a-z0-9:_-]+$/),
    role_id: z.number().int().positive(),
    state: z.enum(["allow", "inherit", "deny"]),
  })
  .strict();

const statisticsScopeAccessDeleteParams = z.object({
  roleId: z.coerce.number().int().positive(),
});

const statisticsScopeAccessDeleteQuery = z.object({
  scope_key: z.string().regex(/^role:[0-9]+$/),
});

function sendCsv(reply: FastifyReply, filename: string, csv: string) {
  reply.header("content-type", "text/csv; charset=utf-8");
  reply.header("content-disposition", `attachment; filename="${filename}"`);
  return reply.send(csv);
}

/** Shared H27 dashboard/query boundary. All returned scopes are already
 * authorized; the query route repeats the check before aggregating. */
export function registerStatisticsRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/statistics/scopes",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated" }),
      schema: { summary: "List statistics scopes available to the caller" },
    },
    async (req) => {
      const scopes = await accessibleStatisticsScopes(req.userId as number, req);
      return {
        scopes: scopes.map(({ application: _application, ...scope }) => scope),
      };
    },
  );

  r.post(
    "/api/statistics/query",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        summary: "Query authorized statistics panels",
        description:
          "Aggregates only the selected authorized scopes and returns panel-ready data. Sensitive source records are never returned.",
        body: statisticsQueryBody,
      },
    },
    async (req) => queryStatistics(req.userId as number, req.body as StatisticsQuery, req),
  );

  r.get(
    "/api/exports/statistics.csv",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        summary: "Export authorized statistics aggregates",
        description:
          "Exports only the same authorized aggregate panels available to the dashboard; raw application answers and derived source fields are excluded.",
        querystring: statisticsExportQuery,
      },
    },
    async (req, reply) => {
      if (!(await userHasCapability(req.userId as number, CAPABILITIES.EXPORTS_RUN, req))) {
        throw new ForbiddenError("Missing capability: exports:run");
      }
      const query: StatisticsQuery = {
        scopes: req.query.scopes.split(",").filter(Boolean),
        panelKeys: req.query.panels?.split(",").filter(Boolean),
      };
      return sendCsv(
        reply,
        "statistics.csv",
        await statisticsCsv(req.userId as number, query, req),
      );
    },
  );

  r.get(
    "/api/statistics/access",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        summary: "List generic statistics scope access",
        description:
          "Lists role-scope panel overrides for statistics managers. Application-scope overrides remain available through the application statistics access resource.",
      },
    },
    async (req) => {
      if (!(await userHasCapability(req.userId as number, CAPABILITIES.STATISTICS_MANAGE, req))) {
        throw new ForbiddenError("Missing capability: statistics:manage");
      }
      const scopes = await accessibleStatisticsScopes(req.userId as number, req);
      const { rows: access } = await pool.query(
        `SELECT scope_key, panel_key, role_id, state
           FROM statistics_scope_panel_role_access
          ORDER BY scope_key, panel_key, role_id`,
      );
      const { rows: roles } = await pool.query(
        `SELECT id, name, position,
                COALESCE(rc.state, 'inherit') AS general_state
           FROM roles r
           LEFT JOIN role_capabilities rc
             ON rc.role_id = r.id AND rc.capability = $1
          WHERE r.deleted_at IS NULL
          ORDER BY r.position DESC, r.id`,
        [CAPABILITIES.LOGISTICS_STATS],
      );
      return {
        scopes: scopes.map(({ application: _application, ...scope }) => scope),
        access,
        roles,
      };
    },
  );

  r.put(
    "/api/statistics/access",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        summary: "Set a generic statistics scope panel override",
        body: statisticsScopeAccessBody,
      },
    },
    async (req) => {
      if (!(await userHasCapability(req.userId as number, CAPABILITIES.STATISTICS_MANAGE, req))) {
        throw new ForbiddenError("Missing capability: statistics:manage");
      }
      const panelKey = canonicalStatisticsPanelKey(req.body.panel_key);
      const parsed = parseStatisticsScopeKey(req.body.scope_key);
      if (
        parsed?.kind !== "role" ||
        !(ROLE_SCOPE_PANEL_KEYS as readonly string[]).includes(panelKey)
      ) {
        throw new ForbiddenError("Statistics scope or panel is not configurable");
      }
      return withTransaction(async (client) => {
        await lockRoleGraph(client);
        const { rows: scopeRoles } = await client.query(
          `SELECT id FROM roles WHERE id = $1 AND deleted_at IS NULL`,
          [parsed.id],
        );
        if (!scopeRoles[0]) throw new ForbiddenError("Statistics scope is not available");
        const { rows: roleRows } = await client.query(
          `SELECT position FROM roles WHERE id = $1 AND deleted_at IS NULL`,
          [req.body.role_id],
        );
        if (!roleRows[0]) throw new ForbiddenError("Role not found");
        await requireRoleMutationAuthority(
          client,
          req.userId as number,
          Number(roleRows[0].position),
        );
        const { rows: before } = await client.query(
          `SELECT state FROM statistics_scope_panel_role_access
            WHERE scope_key = $1 AND panel_key = $2 AND role_id = $3`,
          [req.body.scope_key, panelKey, req.body.role_id],
        );
        await client.query(
          `INSERT INTO statistics_scope_panel_role_access (scope_key, panel_key, role_id, state)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (scope_key, panel_key, role_id) DO UPDATE SET state = EXCLUDED.state`,
          [req.body.scope_key, panelKey, req.body.role_id, req.body.state],
        );
        await audit(client, {
          actorId: req.userId,
          entityType: "statistics_scope_panel",
          entityId: `${req.body.scope_key}:${panelKey}`,
          action: "access_changed",
          before: before[0] ?? null,
          after: { ...req.body, panel_key: panelKey },
        });
        return { ok: true };
      });
    },
  );

  r.delete(
    "/api/statistics/access/:roleId",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        summary: "Remove a role's generic statistics overrides",
        description:
          "Removes every panel override for one role on the selected role scope without changing the role's general Statistics capability.",
        params: statisticsScopeAccessDeleteParams,
        querystring: statisticsScopeAccessDeleteQuery,
      },
    },
    async (req) => {
      if (!(await userHasCapability(req.userId as number, CAPABILITIES.STATISTICS_MANAGE, req))) {
        throw new ForbiddenError("Missing capability: statistics:manage");
      }
      const parsed = parseStatisticsScopeKey(req.query.scope_key);
      if (parsed?.kind !== "role") {
        throw new ForbiddenError("Statistics scope is not configurable");
      }
      return withTransaction(async (client) => {
        await lockRoleGraph(client);
        const { rows: scopeRoles } = await client.query(
          `SELECT id FROM roles WHERE id = $1 AND deleted_at IS NULL`,
          [parsed.id],
        );
        if (!scopeRoles[0]) throw new ForbiddenError("Statistics scope is not available");
        const { rows: roleRows } = await client.query(
          `SELECT position FROM roles WHERE id = $1 AND deleted_at IS NULL`,
          [req.params.roleId],
        );
        if (!roleRows[0]) throw new ForbiddenError("Role not found");
        await requireRoleMutationAuthority(
          client,
          req.userId as number,
          Number(roleRows[0].position),
        );
        const { rows: before } = await client.query(
          `SELECT panel_key, state FROM statistics_scope_panel_role_access
            WHERE scope_key = $1 AND role_id = $2 ORDER BY panel_key`,
          [req.query.scope_key, req.params.roleId],
        );
        await client.query(
          `DELETE FROM statistics_scope_panel_role_access
            WHERE scope_key = $1 AND role_id = $2`,
          [req.query.scope_key, req.params.roleId],
        );
        await audit(client, {
          actorId: req.userId,
          entityType: "statistics_scope_role_access",
          entityId: `${req.query.scope_key}:${req.params.roleId}`,
          action: "access_removed",
          before,
          after: null,
        });
        return { ok: true };
      });
    },
  );
}
