import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireCapability } from "../../lib/capabilities.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { createApplicationSchema, idParamSchema, updateApplicationSchema } from "./schemas.js";
import { isWindowOpen } from "./service.js";

/**
 * H11 (APPLICATIONS_MANAGE): define application forms, open/close windows,
 * capacity. Plus the anonymous public read of open forms so a client can
 * render the template.
 */
export function registerAdminRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const COLUMNS = `id, name, type, template, description, active, open_at, close_at,
                   capacity, confirmation_window_hours, created_at`;

  // ── public: open forms with their template ──────────────────────────────────
  r.get("/api/public/applications", async () => {
    const { rows } = await pool.query(`SELECT ${COLUMNS} FROM applications WHERE active = true`);
    const open = rows.filter((a) => isWindowOpen(a));
    return { applications: open };
  });

  r.get("/api/public/applications/:id", { schema: { params: idParamSchema } }, async (req) => {
    const { rows } = await pool.query(`SELECT ${COLUMNS} FROM applications WHERE id = $1`, [
      req.params.id,
    ]);
    const found = rows[0];
    if (!found || !isWindowOpen(found)) throw new NotFoundError("Application not open");
    return found;
  });

  // ── manage (H11) ────────────────────────────────────────────────────────────
  r.get(
    "/api/applications",
    { preHandler: requireCapability(CAPABILITIES.APPLICATIONS_MANAGE) },
    async () => {
      const { rows } = await pool.query(`SELECT ${COLUMNS} FROM applications ORDER BY id`);
      return { applications: rows };
    },
  );

  r.get(
    "/api/applications/:id",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_MANAGE),
      schema: { params: idParamSchema },
    },
    async (req) => {
      const { rows } = await pool.query(`SELECT ${COLUMNS} FROM applications WHERE id = $1`, [
        req.params.id,
      ]);
      if (!rows[0]) throw new NotFoundError("Application not found");
      return rows[0];
    },
  );

  r.post(
    "/api/applications",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_MANAGE),
      schema: { body: createApplicationSchema },
    },
    async (req, reply) => {
      const b = req.body;
      const { rows } = await pool.query(
        `INSERT INTO applications
           (name, type, template, description, active, open_at, close_at, capacity, confirmation_window_hours)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)
         RETURNING ${COLUMNS}`,
        [
          b.name,
          b.type,
          JSON.stringify(b.template),
          b.description ?? null,
          b.active,
          b.open_at ?? null,
          b.close_at ?? null,
          b.capacity ?? null,
          b.confirmation_window_hours,
        ],
      );
      await audit(pool, {
        actorId: req.userId,
        entityType: "application",
        entityId: rows[0].id,
        action: "created",
        after: { name: b.name, type: b.type },
      });
      reply.code(201);
      return rows[0];
    },
  );

  r.patch(
    "/api/applications/:id",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_MANAGE),
      schema: { params: idParamSchema, body: updateApplicationSchema },
    },
    async (req) => {
      const b = req.body;
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      const put = (col: string, val: unknown, cast = "") => {
        sets.push(`${col} = $${i}${cast}`);
        values.push(val);
        i += 1;
      };
      if (b.name !== undefined) put("name", b.name);
      if (b.type !== undefined) put("type", b.type);
      if (b.template !== undefined) put("template", JSON.stringify(b.template), "::jsonb");
      if (b.description !== undefined) put("description", b.description ?? null);
      if (b.active !== undefined) put("active", b.active);
      if (b.open_at !== undefined) put("open_at", b.open_at ?? null);
      if (b.close_at !== undefined) put("close_at", b.close_at ?? null);
      if (b.capacity !== undefined) put("capacity", b.capacity ?? null);
      if (b.confirmation_window_hours !== undefined)
        put("confirmation_window_hours", b.confirmation_window_hours);

      if (sets.length === 0) {
        const { rows } = await pool.query(`SELECT ${COLUMNS} FROM applications WHERE id = $1`, [
          req.params.id,
        ]);
        if (!rows[0]) throw new NotFoundError("Application not found");
        return rows[0];
      }
      values.push(req.params.id);
      const { rows } = await pool.query(
        `UPDATE applications SET ${sets.join(", ")} WHERE id = $${i} RETURNING ${COLUMNS}`,
        values,
      );
      if (!rows[0]) throw new NotFoundError("Application not found");
      await audit(pool, {
        actorId: req.userId,
        entityType: "application",
        entityId: req.params.id,
        action: "updated",
        after: b,
      });
      return rows[0];
    },
  );

  r.delete(
    "/api/applications/:id",
    {
      preHandler: requireCapability(CAPABILITIES.APPLICATIONS_MANAGE),
      schema: { params: idParamSchema },
    },
    async (req, reply) => {
      const { rows: refs } = await pool.query(
        `SELECT 1 FROM application_responses WHERE application_id = $1 LIMIT 1`,
        [req.params.id],
      );
      if (refs.length > 0) {
        throw new ConflictError("Cannot delete a form that already has responses; deactivate it", {
          code: "has_responses",
        });
      }
      const { rowCount } = await pool.query(`DELETE FROM applications WHERE id = $1`, [
        req.params.id,
      ]);
      if (rowCount === 0) throw new NotFoundError("Application not found");
      await audit(pool, {
        actorId: req.userId,
        entityType: "application",
        entityId: req.params.id,
        action: "deleted",
      });
      reply.code(204);
      return null;
    },
  );
}
