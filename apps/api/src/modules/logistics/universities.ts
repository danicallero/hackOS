import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import type { RouteAccessPolicy } from "../../lib/route-policy.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });

const createBody = z.object({
  name: z.string().min(1).max(200),
});

const COLUMNS = "id, name, proposed_by, created_at";

/** Postgres unique_violation — thrown by the unique `universities.name` index. */
const PG_UNIQUE_VIOLATION = "23505";

function routeAccess(routeAccessPolicy: RouteAccessPolicy) {
  return { config: { routeAccessPolicy } };
}

export function registerUniversityRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const manage = requireCapability(CAPABILITIES.INTOLERANCES_MANAGE);
  const publicContent = {
    kind: "public",
    anonymousCategory: "public-content",
  } as const satisfies RouteAccessPolicy;
  const authenticated = { kind: "authenticated" } as const satisfies RouteAccessPolicy;
  const manageAccess = {
    kind: "capability",
    capability: CAPABILITIES.INTOLERANCES_MANAGE,
  } as const satisfies RouteAccessPolicy;

  // Public: autocomplete list for the university picker. `q` filters by name;
  // `ids` (comma-separated) resolves specific ids by NAME — needed so callers
  // (the staff response view, a reloaded draft) can render the name of a stored
  // university id even when it falls outside the alphabetical top-50 page.
  r.get(
    "/api/public/universities",
    {
      ...routeAccess(publicContent),
      schema: {
        summary: "Search the public university catalogue",
        description:
          "Anonymous read-only autocomplete for application and profile university pickers. It accepts a name query or a comma-separated set of IDs.",
      },
    },
    async (req) => {
      const q = (req.query as { q?: string; ids?: string }).q;
      const idsParam = (req.query as { q?: string; ids?: string }).ids;

      if (idsParam) {
        const ids = idsParam
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n > 0);
        if (ids.length === 0) return { universities: [] };
        const { rows } = await pool.query(
          `SELECT id, name FROM universities WHERE id = ANY($1) ORDER BY name`,
          [ids],
        );
        return { universities: rows };
      }

      const params: unknown[] = [];
      let sql = `SELECT id, name FROM universities`;
      if (q) {
        params.push(`%${q}%`);
        sql += ` WHERE name ILIKE $1`;
      }
      sql += ` ORDER BY name LIMIT 50`;
      const { rows } = await pool.query(sql, params);
      return { universities: rows };
    },
  );

  // Public: propose a new university.
  r.post(
    "/api/public/universities/propose",
    {
      ...routeAccess(authenticated),
      preHandler: requireAuth,
      schema: {
        summary: "Propose a university",
        description:
          "Authenticated self-service proposal. The proposal is attributed to the current user; anonymous clients cannot create catalogue rows.",
        body: createBody,
      },
    },
    async (req, reply) => {
      const { rows } = await pool.query(
        `INSERT INTO universities (name, proposed_by)
         VALUES ($1, $2) RETURNING ${COLUMNS}`,
        [req.body.name, req.userId],
      );
      await audit(pool, {
        actorId: req.userId,
        entityType: "university",
        entityId: rows[0].id,
        action: "created",
        after: { name: req.body.name },
      });
      reply.code(201);
      return rows[0];
    },
  );

  // Admin: create a university.
  r.post(
    "/api/universities",
    { ...routeAccess(manageAccess), preHandler: manage, schema: { body: createBody } },
    async (req, reply) => {
      const { rows } = await pool.query(
        `INSERT INTO universities (name, proposed_by)
         VALUES ($1, $2) RETURNING ${COLUMNS}`,
        [req.body.name, req.userId],
      );
      await audit(pool, {
        actorId: req.userId,
        entityType: "university",
        entityId: rows[0].id,
        action: "created",
        after: { name: req.body.name },
      });
      reply.code(201);
      return rows[0];
    },
  );

  // Admin: rename a university.
  r.patch(
    "/api/universities/:id",
    {
      ...routeAccess(manageAccess),
      preHandler: manage,
      schema: { params: idParam, body: createBody },
    },
    async (req) => {
      try {
        const { rows } = await pool.query(
          `UPDATE universities SET name = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
          [req.params.id, req.body.name],
        );
        if (!rows[0]) throw new NotFoundError("University not found", { id: req.params.id });
        await audit(pool, {
          actorId: req.userId,
          entityType: "university",
          entityId: req.params.id,
          action: "updated",
          after: { name: req.body.name },
        });
        return rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
          throw new ConflictError("A university with that name already exists", {
            name: req.body.name,
          });
        }
        throw err;
      }
    },
  );

  // Admin: delete a university.
  r.delete(
    "/api/universities/:id",
    { ...routeAccess(manageAccess), preHandler: manage, schema: { params: idParam } },
    async (req, reply) => {
      const { rowCount } = await pool.query(`DELETE FROM universities WHERE id = $1`, [
        req.params.id,
      ]);
      if (rowCount === 0) throw new NotFoundError("University not found", { id: req.params.id });
      await audit(pool, {
        actorId: req.userId,
        entityType: "university",
        entityId: req.params.id,
        action: "deleted",
      });
      reply.code(204);
      return null;
    },
  );
}
