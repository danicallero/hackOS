import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireAnyCapability, requireCapability } from "../../lib/capabilities.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import { createApplicationSchema, idParamSchema, updateApplicationSchema } from "./schemas.js";
import { isInvitedParticipant, isWindowOpen } from "./service.js";

/**
 * H11 (APPLICATIONS_MANAGE): define application forms, open/close windows,
 * capacity. Plus the anonymous public read of open forms so a client can
 * render the template.
 */
export function registerAdminRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const manageReviewOrDecide = [
    CAPABILITIES.APPLICATIONS_MANAGE,
    CAPABILITIES.APPLICATIONS_REVIEW,
    CAPABILITIES.APPLICATIONS_DECIDE,
  ] as const;

  const COLUMNS = `id, name, type, template, description, active, open_at, close_at,
                   capacity, confirmation_window_hours, ask_shirt_size, ask_food_intolerances,
                   created_at`;

  // ── public: open forms with their template ──────────────────────────────────
  // A late invited participant (H10) can also discover/fetch a closed form —
  // the same bypass service.ts already grants them for saveDraft/submitResponse.
  r.get(
    "/api/public/applications",
    {
      config: routeAccess({ kind: "public", anonymousCategory: "public-content" }),
      schema: {
        summary: "List open application forms",
        description:
          "Anonymous read of every active application form (H11). A form is included once its window is open, OR the caller is authenticated and already invited (H10) — the invitee bypass an admin/review capability would otherwise gate.",
      },
    },
    async (req) => {
      const { rows } = await pool.query(`SELECT ${COLUMNS} FROM applications WHERE active = true`);
      const invited = req.userId ? await isInvitedParticipant(pool, req.userId) : false;
      const open = rows.filter((a) => isWindowOpen(a) || invited);
      return { applications: open };
    },
  );

  r.get(
    "/api/public/applications/:id",
    {
      config: routeAccess({ kind: "public", anonymousCategory: "public-content" }),
      schema: {
        summary: "Get one open application form",
        description:
          "Anonymous read of a single form's template (H11), so a client can render it. 404 while the window is closed, unless the caller is an already-invited participant (H10).",
        params: idParamSchema,
      },
    },
    async (req) => {
      const { rows } = await pool.query(`SELECT ${COLUMNS} FROM applications WHERE id = $1`, [
        req.params.id,
      ]);
      const found = rows[0];
      if (!found) throw new NotFoundError("Application not open");
      if (!isWindowOpen(found)) {
        const invited = req.userId ? await isInvitedParticipant(pool, req.userId) : false;
        if (!invited) throw new NotFoundError("Application not open");
      }
      return found;
    },
  );

  // ── manage (H11) ────────────────────────────────────────────────────────────
  r.get(
    "/api/applications",
    {
      preHandler: requireAnyCapability(...manageReviewOrDecide),
      config: routeAccess({
        kind: "capability",
        anyOf: manageReviewOrDecide,
      }),
      schema: {
        summary: "List every application form",
        description:
          "Staff read of all application forms regardless of window state (H11), open or closed, for management/review/decision workflows.",
      },
    },
    async () => {
      const { rows } = await pool.query(`SELECT ${COLUMNS} FROM applications ORDER BY id`);
      return { applications: rows };
    },
  );

  r.get(
    "/api/applications/:id",
    {
      preHandler: requireAnyCapability(...manageReviewOrDecide),
      config: routeAccess({
        kind: "capability",
        anyOf: manageReviewOrDecide,
      }),
      schema: {
        summary: "Get one application form",
        description: "Staff read of a single form regardless of window state (H11).",
        params: idParamSchema,
      },
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
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.APPLICATIONS_MANAGE }),
      schema: {
        summary: "Create an application form",
        description:
          "Defines a new application form (H11): its template, open/close window, capacity, confirmation window, and whether it asks for a shirt size and/or dietary restrictions (H12) — both off by default, independent of `type`.",
        body: createApplicationSchema,
      },
    },
    async (req, reply) => {
      const b = req.body;
      const { rows } = await pool.query(
        `INSERT INTO applications
           (name, type, template, description, active, open_at, close_at, capacity,
            confirmation_window_hours, ask_shirt_size, ask_food_intolerances)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11)
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
          b.ask_shirt_size,
          b.ask_food_intolerances,
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
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.APPLICATIONS_MANAGE }),
      schema: {
        summary: "Update an application form",
        description:
          "Partial update of a form's template, window, capacity, active flag, or shirt-size/dietary-restriction toggles (H11, H12). Fields omitted from the body are left unchanged.",
        params: idParamSchema,
        body: updateApplicationSchema,
      },
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
      if (b.ask_shirt_size !== undefined) put("ask_shirt_size", b.ask_shirt_size);
      if (b.ask_food_intolerances !== undefined)
        put("ask_food_intolerances", b.ask_food_intolerances);

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
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.APPLICATIONS_MANAGE }),
      schema: {
        summary: "Delete an application form",
        description:
          "Hard-deletes a form (H11). 409 if it already has responses — deactivate it (active: false) instead of deleting once people have applied.",
        params: idParamSchema,
      },
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
