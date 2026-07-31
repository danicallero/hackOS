import { CAPABILITIES } from "@hackos/shared/capabilities";
import { i18nTextSchema } from "@hackos/shared/questions";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireCapability } from "../../lib/capabilities.js";
import { NotFoundError } from "../../lib/errors.js";
import type { RouteAccessPolicy } from "../../lib/route-policy.js";

/**
 * Food-intolerance dictionary (H12/H25). Administration maintains the shared
 * catalogue that the registration and profile pickers render; every entry
 * carries i18n labels. There is deliberately no FK from users.food_intolerances
 * (integer[]) to this table, so removing an entry is safe — stale ids simply
 * stop resolving in the meal-planning stats.
 */

const idParam = z.object({ id: z.coerce.number().int().positive() });

const createBody = z.object({
  label: i18nTextSchema,
  description: i18nTextSchema.nullish(),
});

const updateBody = z
  .object({
    label: i18nTextSchema.optional(),
    description: i18nTextSchema.nullish(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "no fields to update" });

const COLUMNS = "id, label, description, proposed_by, created_at";

function routeAccess(routeAccessPolicy: RouteAccessPolicy) {
  return { config: { routeAccessPolicy } };
}

export function registerIntoleranceRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const manage = requireCapability(CAPABILITIES.INTOLERANCES_MANAGE);
  const publicContent = {
    kind: "public",
    anonymousCategory: "public-content",
  } as const satisfies RouteAccessPolicy;
  const manageAccess = {
    kind: "capability",
    capability: CAPABILITIES.INTOLERANCES_MANAGE,
  } as const satisfies RouteAccessPolicy;

  // Public: the picker's option list.
  r.get(
    "/api/public/food-intolerances",
    {
      ...routeAccess(publicContent),
      schema: {
        summary: "List public food-intolerance options",
        description:
          "Anonymous read-only catalogue used by application and profile pickers; staff maintain it through the protected management endpoints.",
      },
    },
    async () => {
      const { rows } = await pool.query(
        `SELECT id, label, description FROM food_intolerances ORDER BY id`,
      );
      return { intolerances: rows };
    },
  );

  r.post(
    "/api/food-intolerances",
    { ...routeAccess(manageAccess), preHandler: manage, schema: { body: createBody } },
    async (req, reply) => {
      const userId = req.userId as number;
      const { rows } = await pool.query(
        `INSERT INTO food_intolerances (label, description, proposed_by)
       VALUES ($1::jsonb, $2::jsonb, $3) RETURNING ${COLUMNS}`,
        [
          JSON.stringify(req.body.label),
          req.body.description ? JSON.stringify(req.body.description) : null,
          userId,
        ],
      );
      await audit(pool, {
        actorId: userId,
        entityType: "food_intolerance",
        entityId: rows[0].id,
        action: "created",
        after: { label: req.body.label },
      });
      reply.code(201);
      return rows[0];
    },
  );

  r.patch(
    "/api/food-intolerances/:id",
    {
      ...routeAccess(manageAccess),
      preHandler: manage,
      schema: { params: idParam, body: updateBody },
    },
    async (req) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (req.body.label !== undefined) {
        sets.push(`label = $${i}::jsonb`);
        values.push(JSON.stringify(req.body.label));
        i += 1;
      }
      if (req.body.description !== undefined) {
        sets.push(`description = $${i}::jsonb`);
        values.push(req.body.description === null ? null : JSON.stringify(req.body.description));
        i += 1;
      }
      values.push(req.params.id);
      const { rows } = await pool.query(
        `UPDATE food_intolerances SET ${sets.join(", ")} WHERE id = $${i} RETURNING ${COLUMNS}`,
        values,
      );
      if (!rows[0]) throw new NotFoundError("Food intolerance not found", { id: req.params.id });
      await audit(pool, {
        actorId: req.userId,
        entityType: "food_intolerance",
        entityId: req.params.id,
        action: "updated",
        after: req.body,
      });
      return rows[0];
    },
  );

  r.delete(
    "/api/food-intolerances/:id",
    { ...routeAccess(manageAccess), preHandler: manage, schema: { params: idParam } },
    async (req, reply) => {
      const { rowCount } = await pool.query(`DELETE FROM food_intolerances WHERE id = $1`, [
        req.params.id,
      ]);
      if (rowCount === 0)
        throw new NotFoundError("Food intolerance not found", { id: req.params.id });
      await audit(pool, {
        actorId: req.userId,
        entityType: "food_intolerance",
        entityId: req.params.id,
        action: "deleted",
      });
      reply.code(204);
      return null;
    },
  );
}
