import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireAnyCapability, requireCapability } from "../../lib/capabilities.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import {
  lockRoleGraph,
  type RoleGraphClient,
  requireCapabilityPossessionForAssignment,
  requireRoleMutationAuthority,
} from "../identity/role-authority.js";
import { createApplicationSchema, idParamSchema, updateApplicationSchema } from "./schemas.js";
import {
  anonymousRetentionConfiguration,
  isInvitedParticipant,
  isWindowOpen,
  normalizeTemplateForStorage,
} from "./service.js";

/** H8/H11: 404s if any of `roleIds` doesn't reference a real role. */
async function assertRolesExist(client: Queryable, roleIds: number[]): Promise<void> {
  if (roleIds.length === 0) return;
  const unique = [...new Set(roleIds)];
  const { rows } = await client.query(`SELECT id FROM roles WHERE id = ANY($1)`, [unique]);
  if (rows.length !== unique.length) {
    const found = new Set(rows.map((r) => r.id as number));
    const missing = unique.filter((id) => !found.has(id));
    throw new NotFoundError("Role not found", { roleIds: missing });
  }
}

/**
 * H8/H11: configuring a form to grant role X on confirmation is functionally
 * equivalent to being able to hand X to anyone who gets confirmed through it
 * — so it's gated by the exact same multi-role hierarchy + capability-
 * content authority that direct role assignment uses (routes/roles.ts), not
 * merely applications:manage. Rejects the whole request (throws on the first
 * failing role) rather than applying any grants partially. Assumes
 * assertRolesExist already confirmed every id is real.
 */
async function assertActorCanGrantRoles(
  client: RoleGraphClient,
  actorId: number,
  roleIds: number[],
): Promise<void> {
  if (roleIds.length === 0) return;
  const unique = [...new Set(roleIds)];
  const { rows } = await client.query(`SELECT id, position FROM roles WHERE id = ANY($1)`, [
    unique,
  ]);
  for (const { id, position } of rows as { id: number; position: number }[]) {
    await requireRoleMutationAuthority(client, actorId, Number(position));
    await requireCapabilityPossessionForAssignment(client, actorId, id);
  }
}

/** H8/H11: replaces the full set of roles a form grants on confirmation. */
async function replaceGrantedRoles(
  client: Queryable,
  applicationId: number,
  roleIds: number[],
): Promise<void> {
  await client.query(`DELETE FROM application_grants_roles WHERE application_id = $1`, [
    applicationId,
  ]);
  if (roleIds.length > 0) {
    await client.query(
      `INSERT INTO application_grants_roles (application_id, role_id)
       SELECT $1, unnest($2::int[])`,
      [applicationId, [...new Set(roleIds)]],
    );
  }
}

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

  // H8/H11: grants_role_ids is a correlated-subquery column, not a stored
  // one — it aggregates application_grants_roles per form so callers get a
  // plain array without a second round trip.
  const GRANTS_ROLE_IDS_EXPR = `COALESCE(
        (SELECT array_agg(agr.role_id ORDER BY agr.role_id)
           FROM application_grants_roles agr WHERE agr.application_id = applications.id),
        ARRAY[]::integer[]
      ) AS grants_role_ids`;
  // H8: cheap boolean so the builder UI can warn that editing grants_role_ids
  // is not retroactive — roles are granted once at confirmation time, so a
  // form with any confirmed response already has grants "locked in" for it.
  const HAS_CONFIRMED_RESPONSES_EXPR = `EXISTS (
        SELECT 1 FROM application_responses ar
         WHERE ar.application_id = applications.id AND ar.status = 'confirmed'
      ) AS has_confirmed_responses`;
  // H8: replaces the retired static `type` column as the "is this a
  // participant/mentor/... form" answer — the NAME (no separate stored
  // category) of the form's highest-position granted role, or null if it
  // grants none. Derived from grants_role_ids so it can never drift from
  // what the form actually grants the way a separately-set `type` string
  // could.
  const GRANTED_ROLE_NAME_EXPR = `(
        SELECT r.name
          FROM application_grants_roles agr
          JOIN roles r ON r.id = agr.role_id AND r.deleted_at IS NULL
         WHERE agr.application_id = applications.id
         ORDER BY r.position DESC
         LIMIT 1
      ) AS granted_role_name`;
  const COLUMNS = `id, name, template, sections, description, open_at, close_at,
                   capacity, confirmation_window_hours, ask_shirt_size, ask_food_intolerances,
                   current_form_version, created_at, ${GRANTS_ROLE_IDS_EXPR},
                   ${HAS_CONFIRMED_RESPONSES_EXPR}, ${GRANTED_ROLE_NAME_EXPR}`;

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
          "Anonymous read of every application form whose window is open (H11), OR the caller is authenticated and already invited (H10) — the invitee bypass an admin/review capability would otherwise gate.",
      },
    },
    async (req) => {
      const { rows } = await pool.query(`SELECT ${COLUMNS} FROM applications`);
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
        description:
          "Staff read of a single form regardless of window state (H11). Includes `has_confirmed_responses` (H8) — true once any response reached confirmed, meaning further `grants_role_ids` edits only affect future confirmations, not past ones.",
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
          "Defines a new application form (H11): its template, optional named sections that group template fields under a title/description, open/close window, capacity, confirmation window, whether it asks for a shirt size and/or dietary restrictions (H12, both off by default), and an optional `grants_role_ids` (H8) list of roles granted alongside ticket issuance when a response is confirmed. `grants_role_ids` is also the answer to 'what kind of application is this' — the legacy static `type` classification is retired; a returned form instead carries `granted_role_name`, derived live from the name of its highest-position granted role. Configuring a role into `grants_role_ids` is gated exactly like directly assigning that role (H8): the actor's highest assigned-role position must sit strictly above every requested role's position, and (unless they hold the wildcard) they must already possess every capability that role's own rows explicitly allow.",
        body: createApplicationSchema,
      },
    },
    async (req, reply) => {
      const b = req.body;
      const row = await withTransaction(async (client) => {
        const template = normalizeTemplateForStorage(b.template);
        const roleIds = b.grants_role_ids ?? [];
        if (roleIds.length > 0) {
          await lockRoleGraph(client);
          await assertRolesExist(client, roleIds);
          await assertActorCanGrantRoles(client, req.userId as number, roleIds);
        }
        const { rows } = await client.query(
          `INSERT INTO applications
             (name, template, sections, description, open_at, close_at, capacity,
              confirmation_window_hours, ask_shirt_size, ask_food_intolerances, current_form_version)
           VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, 1)
           RETURNING id`,
          [
            b.name,
            JSON.stringify(template),
            JSON.stringify(b.sections),
            b.description ?? null,
            b.open_at ?? null,
            b.close_at ?? null,
            b.capacity ?? null,
            b.confirmation_window_hours,
            b.ask_shirt_size,
            b.ask_food_intolerances,
          ],
        );
        const applicationId = rows[0].id as number;
        await client.query(
          `INSERT INTO application_form_versions
             (application_id, version, template, sections, created_by)
           VALUES ($1, 1, $2::jsonb, $3::jsonb, $4)`,
          [applicationId, JSON.stringify(template), JSON.stringify(b.sections), req.userId],
        );
        await replaceGrantedRoles(client, applicationId, roleIds);
        await audit(client, {
          actorId: req.userId,
          entityType: "application",
          entityId: applicationId,
          action: "created",
          after: {
            name: b.name,
            formVersion: 1,
            anonymousRetention: anonymousRetentionConfiguration(template),
            grantsRoleIds: roleIds,
          },
        });
        const { rows: finalRows } = await client.query(
          `SELECT ${COLUMNS} FROM applications WHERE id = $1`,
          [applicationId],
        );
        return finalRows[0];
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
          "Partial update of a form's template, named sections grouping template fields, window, capacity, shirt-size/dietary-restriction toggles (H11, H12), or the roles granted on confirmation (`grants_role_ids`, H8). Fields omitted from the body are left unchanged; passing `grants_role_ids` replaces the full set of granted roles for the form (an empty array clears every grant). Adding a role to `grants_role_ids` requires the same role-mutation authority (position hierarchy + capability possession, H8) as assigning that role directly.",
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
        if (schemaChanged) {
          put("template", JSON.stringify(nextTemplate), "::jsonb");
          put("sections", JSON.stringify(nextSections), "::jsonb");
          put("current_form_version", nextVersion);
        }
        if (b.description !== undefined) put("description", b.description ?? null);
        if (b.open_at !== undefined) put("open_at", b.open_at ?? null);
        if (b.close_at !== undefined) put("close_at", b.close_at ?? null);
        if (b.capacity !== undefined) put("capacity", b.capacity ?? null);
        if (b.confirmation_window_hours !== undefined)
          put("confirmation_window_hours", b.confirmation_window_hours);
        if (b.ask_shirt_size !== undefined) put("ask_shirt_size", b.ask_shirt_size);
        if (b.ask_food_intolerances !== undefined)
          put("ask_food_intolerances", b.ask_food_intolerances);

        // grants_role_ids replaces the form's full role-grant set (H8, H11).
        // Omitted (undefined) leaves it unchanged; [] clears every grant.
        const grantsChanged = b.grants_role_ids !== undefined;
        const nextRoleIds = b.grants_role_ids ?? [];
        if (grantsChanged && nextRoleIds.length > 0) {
          await lockRoleGraph(client);
          await assertRolesExist(client, nextRoleIds);
          await assertActorCanGrantRoles(client, req.userId as number, nextRoleIds);
        }

        if (sets.length === 0 && !grantsChanged) return current;
        let rows: Record<string, unknown>[];
        if (sets.length > 0) {
          values.push(req.params.id);
          ({ rows } = await client.query(
            `UPDATE applications SET ${sets.join(", ")} WHERE id = $${i} RETURNING id`,
            values,
          ));
        } else {
          rows = [{ id: req.params.id }];
        }
        if (!rows[0]) throw new NotFoundError("Application not found");
        if (grantsChanged) await replaceGrantedRoles(client, req.params.id, nextRoleIds);

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
                ...(grantsChanged ? { grantsRoleIds: current.grants_role_ids } : {}),
              }
            : grantsChanged
              ? { grantsRoleIds: current.grants_role_ids }
              : undefined,
          after: schemaChanged
            ? {
                formVersion: nextVersion,
                anonymousRetention: anonymousRetentionConfiguration(nextTemplate),
                ...(grantsChanged ? { grantsRoleIds: nextRoleIds } : {}),
              }
            : { ...b, ...(grantsChanged ? { grants_role_ids: nextRoleIds } : {}) },
        });
        const { rows: finalRows } = await client.query(
          `SELECT ${COLUMNS} FROM applications WHERE id = $1`,
          [req.params.id],
        );
        return finalRows[0];
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
          "Hard-deletes a form (H11). 409 if it already has responses — close its window (set `close_at`) instead of deleting once people have applied.",
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
