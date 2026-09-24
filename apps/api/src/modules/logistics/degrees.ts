import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { keyByUser, rateLimitGuard } from "../../lib/rate-limit.js";
import { routeAccessOption as routeAccess } from "../../lib/route-policy.js";
import { idParamSchema } from "./schemas.js";

const body = z.object({ name: z.string().min(1).max(200) });
const COLUMNS = "id, name, proposed_by, created_at";
const proposalRateLimit = rateLimitGuard(
  "degree-proposal",
  { windowSeconds: 3600, max: 5 },
  keyByUser,
);
const uniqueViolation = "23505";
const normalize = (name: string) => name.trim().replace(/\s+/g, " ");

async function create(actorId: number, name: string, suggested = false) {
  return withTransaction(async (client) => {
    const normalized = normalize(name);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended(lower($1), 0))", [
      normalized,
    ]);
    const existing = await client.query(
      `SELECT ${COLUMNS} FROM university_degrees
       WHERE lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = lower($1) LIMIT 1`,
      [normalized],
    );
    if (existing.rows[0]) return { degree: existing.rows[0], created: false };
    const { rows } = await client.query(
      `INSERT INTO university_degrees (name, proposed_by, suggested_by)
       VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
      [normalized, actorId, suggested ? actorId : null],
    );
    await audit(client, {
      actorId,
      entityType: "university_degree",
      entityId: rows[0].id,
      action: "created",
      after: { name: normalized, suggested },
    });
    return { degree: rows[0], created: true };
  });
}

export function registerDegreeRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const manage = requireCapability(CAPABILITIES.INTOLERANCES_MANAGE);
  const publicAccess = routeAccess({ kind: "public", anonymousCategory: "public-content" });
  const authenticated = routeAccess({ kind: "authenticated" });
  const manageAccess = routeAccess({
    kind: "capability",
    capability: CAPABILITIES.INTOLERANCES_MANAGE,
  });

  r.get(
    "/api/public/degrees",
    {
      ...publicAccess,
      schema: {
        summary: "Search the public degree catalogue",
        description:
          "Anonymous autocomplete for degree application fields. Accepts a name query or comma-separated IDs.",
      },
    },
    async (req) => {
      const { q, ids } = req.query as { q?: string; ids?: string };
      if (ids) {
        const parsed = ids
          .split(",")
          .map(Number)
          .filter((id) => Number.isInteger(id) && id > 0);
        if (!parsed.length) return { degrees: [] };
        const { rows } = await pool.query(
          "SELECT id, name FROM university_degrees WHERE id = ANY($1) ORDER BY name",
          [parsed],
        );
        return { degrees: rows };
      }
      const { rows } = await pool.query(
        `SELECT id, name FROM university_degrees ${q ? "WHERE name ILIKE $1" : ""} ORDER BY name LIMIT 50`,
        q ? [`%${q}%`] : [],
      );
      return { degrees: rows };
    },
  );
  r.post(
    "/api/public/degrees/propose",
    {
      ...authenticated,
      preHandler: [proposalRateLimit, requireAuth],
      schema: {
        summary: "Propose a degree",
        description:
          "Authenticated self-service degree proposal, limited to five attempts per hour and one active suggestion per account.",
        body,
      },
    },
    async (req, reply) => {
      try {
        const result = await create(req.userId as number, req.body.name, true);
        reply.code(result.created ? 201 : 200);
        return result.degree;
      } catch (error) {
        if ((error as { code?: string }).code === uniqueViolation)
          throw new ConflictError("You have already suggested a degree", {
            code: "degree_suggestion_exists",
          });
        throw error;
      }
    },
  );
  r.post(
    "/api/degrees",
    {
      ...manageAccess,
      preHandler: manage,
      schema: {
        summary: "Create a degree",
        description: "Adds a curated degree to the application-form catalogue.",
        body,
      },
    },
    async (req, reply) => {
      const result = await create(req.userId as number, req.body.name);
      reply.code(result.created ? 201 : 200);
      return result.degree;
    },
  );
  r.patch(
    "/api/degrees/:id",
    {
      ...manageAccess,
      preHandler: manage,
      schema: {
        summary: "Rename a degree",
        description: "Renames a curated degree.",
        params: idParamSchema,
        body,
      },
    },
    async (req) => {
      try {
        return await withTransaction(async (client) => {
          const { rows } = await client.query(
            `UPDATE university_degrees SET name = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
            [req.params.id, normalize(req.body.name)],
          );
          if (!rows[0]) throw new NotFoundError("Degree not found");
          await audit(client, {
            actorId: req.userId,
            entityType: "university_degree",
            entityId: req.params.id,
            action: "updated",
            after: { name: rows[0].name },
          });
          return rows[0];
        });
      } catch (error) {
        if ((error as { code?: string }).code === uniqueViolation)
          throw new ConflictError("A degree with that name already exists");
        throw error;
      }
    },
  );
  r.delete(
    "/api/degrees/:id",
    {
      ...manageAccess,
      preHandler: manage,
      schema: {
        summary: "Delete a degree",
        description: "Deletes an unused curated degree.",
        params: idParamSchema,
      },
    },
    async (req, reply) => {
      await withTransaction(async (client) => {
        const { rowCount } = await client.query("DELETE FROM university_degrees WHERE id = $1", [
          req.params.id,
        ]);
        if (!rowCount) throw new NotFoundError("Degree not found");
        await audit(client, {
          actorId: req.userId,
          entityType: "university_degree",
          entityId: req.params.id,
          action: "deleted",
        });
      });
      reply.code(204);
      return null;
    },
  );
}
