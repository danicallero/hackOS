import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireAnyCapability, requireCapability } from "../../lib/capabilities.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import { createApplicationSchema, idParamSchema, updateApplicationSchema } from "./schemas.js";
import {
  anonymousRetentionConfiguration,
  isInvitedParticipant,
  isWindowOpen,
  normalizeTemplateForStorage,
} from "./service.js";

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

  const COLUMNS = `id, name, type, template, sections, description, active, open_at, close_at,
                   capacity, confirmation_window_hours, ask_shirt_size, ask_food_intolerances,
                   current_form_version, created_at, grants_role_id`;

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
          "Defines a new application form (H11): its template, optional named sections that group template fields under a title/description, open/close window, capacity, confirmation window, whether it asks for a shirt size and/or dietary restrictions (H12) — both off by default, independent of `type` — and an optional `grants_role_id` (H8) granted alongside ticket issuance when a response is confirmed.",
        body: createApplicationSchema,
      },
    },
    async (req, reply) => {
      const b = req.body;
      const row = await withTransaction(async (client) => {
        const template = normalizeTemplateForStorage(b.template);
        if (b.grants_role_id != null) {
          const { rows: roleRows } = await client.query(`SELECT 1 FROM roles WHERE id = $1`, [
            b.grants_role_id,
          ]);
          if (!roleRows[0]) throw new NotFoundError("Role not found", { roleId: b.grants_role_id });
        }
        const { rows } = await client.query(
          `INSERT INTO applications
             (name, type, template, sections, description, active, open_at, close_at, capacity,
              confirmation_window_hours, ask_shirt_size, ask_food_intolerances, current_form_version,
              grants_role_id)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13)
           RETURNING ${COLUMNS}`,
          [
            b.name,
            b.type,
            JSON.stringify(template),
            JSON.stringify(b.sections),
            b.description ?? null,
            b.active,
            b.open_at ?? null,
            b.close_at ?? null,
            b.capacity ?? null,
            b.confirmation_window_hours,
            b.ask_shirt_size,
            b.ask_food_intolerances,
            b.grants_role_id ?? null,
          ],
        );
        const application = rows[0];
        await client.query(
          `INSERT INTO application_form_versions
             (application_id, version, template, sections, created_by)
           VALUES ($1, 1, $2::jsonb, $3::jsonb, $4)`,
          [application.id, JSON.stringify(template), JSON.stringify(b.sections), req.userId],
        );
        await audit(client, {
          actorId: req.userId,
          entityType: "application",
          entityId: application.id,
          action: "created",
          after: {
            name: b.name,
            type: b.type,
            formVersion: 1,
            anonymousRetention: anonymousRetentionConfiguration(template),
          },
        });
        return application;
      });
      reply.code(201);
      return row;
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
          "Partial update of a form's template, named sections grouping template fields, window, capacity, active flag, shirt-size/dietary-restriction toggles (H11, H12), or the role granted on confirmation (`grants_role_id`, H8). Fields omitted from the body are left unchanged.",
        params: idParamSchema,
        body: updateApplicationSchema,
      },
    },
    async (req) => {
      const b = req.body;
      return withTransaction(async (client) => {
        const { rows: currentRows } = await client.query(
          `SELECT ${COLUMNS} FROM applications WHERE id = $1 FOR UPDATE`,
          [req.params.id],
        );
        const current = currentRows[0];
        if (!current) throw new NotFoundError("Application not found");

        const schemaChanged = b.template !== undefined || b.sections !== undefined;
        const nextTemplate = schemaChanged
          ? normalizeTemplateForStorage(b.template ?? current.template)
          : current.template;
        const nextSections = b.sections ?? current.sections ?? [];
        const nextVersion = Number(current.current_form_version ?? 1) + (schemaChanged ? 1 : 0);

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
        if (schemaChanged) {
          put("template", JSON.stringify(nextTemplate), "::jsonb");
          put("sections", JSON.stringify(nextSections), "::jsonb");
          put("current_form_version", nextVersion);
        }
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
        if (b.grants_role_id !== undefined) {
          if (b.grants_role_id !== null) {
            const { rows: roleRows } = await client.query(`SELECT 1 FROM roles WHERE id = $1`, [
              b.grants_role_id,
            ]);
            if (!roleRows[0])
              throw new NotFoundError("Role not found", { roleId: b.grants_role_id });
          }
          put("grants_role_id", b.grants_role_id ?? null);
        }

        if (sets.length === 0) return current;
        values.push(req.params.id);
        const { rows } = await client.query(
          `UPDATE applications SET ${sets.join(", ")} WHERE id = $${i} RETURNING ${COLUMNS}`,
          values,
        );
        if (!rows[0]) throw new NotFoundError("Application not found");

        if (schemaChanged) {
          await client.query(
            `INSERT INTO application_form_versions
               (application_id, version, template, sections, created_by)
             VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)`,
            [
              req.params.id,
              nextVersion,
              JSON.stringify(nextTemplate),
              JSON.stringify(nextSections),
              req.userId,
            ],
          );
        }
        await audit(client, {
          actorId: req.userId,
          entityType: "application",
          entityId: req.params.id,
          action: "updated",
          before: schemaChanged
            ? {
                formVersion: Number(current.current_form_version ?? 1),
                anonymousRetention: anonymousRetentionConfiguration(current.template ?? []),
              }
            : undefined,
          after: schemaChanged
            ? {
                formVersion: nextVersion,
                anonymousRetention: anonymousRetentionConfiguration(nextTemplate),
              }
            : b,
        });
        return rows[0];
      });
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
      const { rows: anonymousRefs } = await pool.query(
        `SELECT 1 FROM anonymous_participant_fields WHERE application_id = $1 LIMIT 1`,
        [req.params.id],
      );
      if (anonymousRefs.length > 0) {
        throw new ConflictError(
          "Cannot delete a form referenced by an anonymous audit record; deactivate it instead",
          { code: "anonymous_audit_references" },
        );
      }
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
