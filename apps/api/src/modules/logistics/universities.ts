import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { keyByUser, rateLimitGuard } from "../../lib/rate-limit.js";
import {
  type RouteAccessPolicy,
  routeAccessOption as routeAccess,
} from "../../lib/route-policy.js";
import { idParamSchema } from "./schemas.js";

const idParam = idParamSchema;

const createBody = z.object({
  name: z.string().min(1).max(200),
});

const COLUMNS = "id, name, proposed_by, created_at";
const proposalRateLimit = rateLimitGuard(
  "university-proposal",
  { windowSeconds: 60 * 60, max: 5 },
  keyByUser,
);

/** Postgres unique_violation — thrown by the unique `universities.name` index. */
const PG_UNIQUE_VIOLATION = "23505";

function normalizeUniversityName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

async function createUniversity(actorId: number, name: string, suggested = false) {
  return withTransaction(async (client) => {
    const normalizedName = normalizeUniversityName(name);
    // Serialise equivalent names (case/whitespace-insensitive) so concurrent
    // self-service proposals resolve to the same catalogue row.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended(lower($1), 0))`, [
      normalizedName,
    ]);
    const existing = await client.query(
      `SELECT ${COLUMNS} FROM universities
        WHERE lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = lower($1)
        ORDER BY id
        LIMIT 1`,
      [normalizedName],
    );
    if (existing.rows[0]) return { university: existing.rows[0], created: false };

    const { rows } = await client.query(
      `INSERT INTO universities (name, proposed_by, suggested_by)
       VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
      [normalizedName, actorId, suggested ? actorId : null],
    );
    await audit(client, {
      actorId,
      entityType: "university",
      entityId: rows[0].id,
      action: "created",
      after: { name: normalizedName, suggested },
    });
    return { university: rows[0], created: true };
  });
}

async function normalizeUniversity(actorId: number, sourceId: number, targetId: number) {
  if (sourceId === targetId) {
    throw new BadRequestError("Choose a different university to consolidate into");
  }
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT ${COLUMNS} FROM universities WHERE id = ANY($1::integer[]) ORDER BY id FOR UPDATE`,
      [[sourceId, targetId]],
    );
    const source = rows.find((row) => row.id === sourceId);
    const target = rows.find((row) => row.id === targetId);
    if (!source || !target) throw new NotFoundError("University not found");

    const users = await client.query(
      `UPDATE users SET university_id = $2 WHERE university_id = $1 RETURNING id`,
      [sourceId, targetId],
    );
    const responses = await client.query(
      `WITH university_fields AS (
         SELECT response.id, field->>'key' AS field_key
           FROM application_responses response
           JOIN application_form_versions form ON form.id = response.application_form_version_id
           CROSS JOIN LATERAL jsonb_array_elements(form.template) field
          WHERE field->>'kind' = 'university'
            AND response.responses ? (field->>'key')
            AND response.responses ->> (field->>'key') = $1::text
       )
       UPDATE application_responses response
          SET responses = jsonb_set(
            response.responses,
            ARRAY[university_fields.field_key],
            to_jsonb($2::integer),
            true
          )
         FROM university_fields
        WHERE response.id = university_fields.id
       RETURNING response.id`,
      [sourceId, targetId],
    );
    await client.query(`DELETE FROM universities WHERE id = $1`, [sourceId]);
    await audit(client, {
      actorId,
      entityType: "university",
      entityId: targetId,
      action: "normalized",
      after: {
        mergedUniversityId: sourceId,
        usersUpdated: users.rowCount,
        applicationResponsesUpdated: responses.rowCount,
      },
    });
    return {
      university: target,
      mergedUniversityId: sourceId,
      usersUpdated: users.rowCount,
      applicationResponsesUpdated: responses.rowCount,
    };
  });
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
      preHandler: [proposalRateLimit, requireAuth],
      schema: {
        summary: "Propose a university",
        description:
          "Authenticated self-service proposal, limited to one active suggestion per account. Equivalent concurrent proposals resolve to the same catalogue row. The proposal is attributed to the current user; anonymous clients cannot create catalogue rows. Staff can add catalogue rows through the management endpoint.",
        body: createBody,
      },
    },
    async (req, reply) => {
      try {
        const result = await createUniversity(req.userId as number, req.body.name, true);
        reply.code(result.created ? 201 : 200);
        return result.university;
      } catch (err) {
        if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
          throw new ConflictError("You have already suggested a university", {
            code: "university_suggestion_exists",
          });
        }
        throw err;
      }
    },
  );

  // Admin: create a university.
  r.post(
    "/api/universities",
    { ...routeAccess(manageAccess), preHandler: manage, schema: { body: createBody } },
    async (req, reply) => {
      const result = await createUniversity(req.userId as number, req.body.name);
      reply.code(result.created ? 201 : 200);
      return result.university;
    },
  );

  r.post(
    "/api/universities/:id/normalize",
    {
      ...routeAccess(manageAccess),
      preHandler: manage,
      schema: {
        params: idParam,
        body: z.object({ targetId: z.number().int().positive() }),
        summary: "Consolidate duplicate universities",
        description:
          "Staff-only consolidation of two university catalogue rows. Every affected profile and application response is reassigned to the retained university before the duplicate row is deleted.",
      },
    },
    async (req) => normalizeUniversity(req.userId as number, req.params.id, req.body.targetId),
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
        return await withTransaction(async (client) => {
          const { rows } = await client.query(
            `UPDATE universities SET name = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
            [req.params.id, req.body.name],
          );
          if (!rows[0]) throw new NotFoundError("University not found", { id: req.params.id });
          await audit(client, {
            actorId: req.userId,
            entityType: "university",
            entityId: req.params.id,
            action: "updated",
            after: { name: req.body.name },
          });
          return rows[0];
        });
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
      await withTransaction(async (client) => {
        const { rowCount } = await client.query(`DELETE FROM universities WHERE id = $1`, [
          req.params.id,
        ]);
        if (rowCount === 0) throw new NotFoundError("University not found", { id: req.params.id });
        await audit(client, {
          actorId: req.userId,
          entityType: "university",
          entityId: req.params.id,
          action: "deleted",
        });
      });
      reply.code(204);
      return null;
    },
  );
}
