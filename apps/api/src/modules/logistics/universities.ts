import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireCapability } from "../../lib/capabilities.js";
import { NotFoundError } from "../../lib/errors.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });

const createBody = z.object({
  name: z.string().min(1).max(200),
});

const COLUMNS = "id, name, proposed_by, created_at";

export function registerUniversityRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const manage = requireCapability(CAPABILITIES.INTOLERANCES_MANAGE);

  // Public: autocomplete list for the university picker.
  r.get("/api/public/universities", async (req) => {
    const query = (req.query as { q?: string }).q;
    const params: unknown[] = [];
    let sql = `SELECT id, name FROM universities`;
    if (query) {
      params.push(`%${query}%`);
      sql += ` WHERE name ILIKE $1`;
    }
    sql += ` ORDER BY name LIMIT 50`;
    const { rows } = await pool.query(sql, params);
    return { universities: rows };
  });

  // Public: propose a new university.
  r.post(
    "/api/public/universities/propose",
    {
      schema: { body: createBody },
    },
    async (req, reply) => {
      const { rows } = await pool.query(
        `INSERT INTO universities (name, proposed_by)
         VALUES ($1, $2) RETURNING ${COLUMNS}`,
        [req.body.name, req.userId ?? 0],
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
    { preHandler: manage, schema: { body: createBody } },
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

  // Admin: delete a university.
  r.delete(
    "/api/universities/:id",
    { preHandler: manage, schema: { params: idParam } },
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
