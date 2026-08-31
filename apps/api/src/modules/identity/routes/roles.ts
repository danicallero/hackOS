import { ALL_CAPABILITIES, CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import { z } from "zod";
import { pool, withTransaction } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import {
  assertKnownCapabilities,
  requireAnyCapability,
  requireCapability,
} from "../../../lib/capabilities.js";
import { ConflictError, NotFoundError } from "../../../lib/errors.js";
import { routeAccessConfig as routeAccess } from "../../../lib/route-policy.js";
import { broadcast } from "../../../lib/sse.js";
import { issueTicket } from "../../logistics/tickets.js";
import {
  assertActiveWildcardHolder,
  lockRoleGraph,
  requireRoleMutationAuthority,
  requireWildcardRoleAuthority,
  roleGrantsWildcard,
  userHasAnyCapability,
} from "../role-authority.js";
import { getPermissionGroupTemplate, PERMISSION_GROUP_TEMPLATES } from "../templates.js";

/**
 * Role management (H8): a Discord-style hierarchical role model replaces
 * capability groups as the authorization source. A user may hold several
 * roles; roles sit on one global reorderable hierarchy (`position`, higher =
 * more priority); each role holds an ALLOW/DENY/INHERIT tri-state per
 * capability, resolved over the user's OWN assigned roles ordered by
 * position descending (lib/capabilities.ts). To assign/remove/edit/reorder a
 * role, the actor needs PERMISSIONS_MANAGE AND the role's position (its NEW
 * position, for a reorder) must sit strictly below the actor's own highest
 * assigned role — enforced here, not just in the UI. Every mutation is
 * audited (H53) and broadcast on the identity topic (H7-H10) in the same
 * transaction as the write.
 */

const manage = requireCapability(CAPABILITIES.PERMISSIONS_MANAGE);
const readRoles = requireAnyCapability(
  CAPABILITIES.PERMISSIONS_MANAGE,
  CAPABILITIES.INVITES_MANAGE,
);

const permissionState = z.enum(["allow", "deny", "inherit"]);
const roleIdParams = z.object({ roleId: z.coerce.number().int() });

const roleResponse = z.object({
  id: z.number(),
  name: z.string(),
  position: z.number(),
  isVisible: z.boolean(),
  isProtected: z.boolean(),
  // Sparse: capabilities with no explicit row are implicitly 'inherit' and
  // omitted (mirrors the role_capabilities table — a missing row IS inherit).
  capabilities: z.array(z.object({ capability: z.string(), state: permissionState })),
  memberIds: z.array(z.number()),
});

async function loadRole(db: pg.Pool | pg.PoolClient, roleId: number) {
  const { rows } = await db.query(`SELECT * FROM roles WHERE id = $1`, [roleId]);
  if (!rows[0]) throw new NotFoundError("Role not found", { roleId });
  // Sequential on purpose: `db` may be a single PoolClient inside a
  // transaction, which cannot run queries concurrently.
  const caps = await db.query(
    `SELECT capability, state FROM role_capabilities WHERE role_id = $1 ORDER BY capability`,
    [roleId],
  );
  const members = await db.query(
    `SELECT user_id FROM user_roles WHERE role_id = $1 ORDER BY user_id`,
    [roleId],
  );
  return {
    id: rows[0].id as number,
    name: rows[0].name as string,
    position: rows[0].position as number,
    isVisible: rows[0].is_visible as boolean,
    isProtected: rows[0].is_protected as boolean,
    capabilities: caps.rows as { capability: string; state: "allow" | "deny" | "inherit" }[],
    memberIds: members.rows.map((r: { user_id: number }) => r.user_id),
  };
}

function announceRoleChange(): void {
  broadcast(SSE_TOPICS.IDENTITY, EVENTS.DOMAIN_CHANGED, {});
}

export function registerRoleRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    "/api/role-templates",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "List role-creation templates",
        description:
          "Returns the stable H8 template catalogue used to prefill a new role's capabilities. Labels/descriptions are message keys for the client i18n catalogue; `sponsor:portal` is deliberately absent.",
        response: {
          200: z.array(
            z.object({
              key: z.string(),
              labelKey: z.string(),
              descriptionKey: z.string(),
              capabilities: z.array(z.string()),
            }),
          ),
        },
      },
    },
    async () =>
      PERMISSION_GROUP_TEMPLATES.map((template) => ({
        ...template,
        capabilities: [...template.capabilities],
      })),
  );

  api.get(
    "/api/roles",
    {
      preHandler: readRoles,
      config: routeAccess({
        kind: "capability",
        anyOf: [CAPABILITIES.PERMISSIONS_MANAGE, CAPABILITIES.INVITES_MANAGE],
      }),
      schema: {
        summary: "List roles by position",
        description:
          "Lists every role highest-position first (H8). Invitation managers get this same read access to choose deferred role pre-assignments; only PERMISSIONS_MANAGE can mutate.",
        response: { 200: z.array(roleResponse) },
      },
    },
    async () => {
      const { rows } = await pool.query(`SELECT id FROM roles ORDER BY position DESC`);
      return Promise.all(rows.map((row: { id: number }) => loadRole(pool, row.id)));
    },
  );

  api.get(
    "/api/roles/:roleId",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: { params: roleIdParams, response: { 200: roleResponse } },
    },
    async (req) => loadRole(pool, req.params.roleId),
  );

  api.post(
    "/api/roles",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Create a role",
        description:
          "Creates a role at an explicit position strictly below the actor's own highest role (H8). Optionally seeded from an H8 template's capability set, or from an explicit tri-state capability list.",
        body: z.object({
          name: z.string().min(1).max(200),
          position: z.number().int(),
          isVisible: z.boolean().default(true),
          templateKey: z.string().min(1).max(120).optional(),
          capabilities: z
            .array(z.object({ capability: z.string().min(1), state: permissionState }))
            .default([]),
        }),
        response: { 201: roleResponse },
      },
    },
    async (req, reply) => {
      const { name, position, isVisible, templateKey } = req.body;
      let capabilities = req.body.capabilities;
      if (templateKey) {
        const template = getPermissionGroupTemplate(templateKey);
        if (!template) throw new NotFoundError("Role template not found", { templateKey });
        capabilities = template.capabilities.map((capability) => ({
          capability,
          state: "allow" as const,
        }));
      }
      assertKnownCapabilities(capabilities.map((c) => c.capability));
      const role = await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const actorId = req.userId as number;
        await requireRoleMutationAuthority(client, actorId, position);
        if (
          capabilities.some((c) => c.capability === CAPABILITIES.ADMIN_ALL && c.state === "allow")
        ) {
          await requireWildcardRoleAuthority(client, actorId);
        }
        const { rows: existing } = await client.query(`SELECT id FROM roles WHERE name = $1`, [
          name,
        ]);
        if (existing.length > 0) {
          throw new ConflictError("A role with this name already exists", { name });
        }
        const { rows } = await client.query(
          `INSERT INTO roles (name, position, is_visible) VALUES ($1, $2, $3) RETURNING id`,
          [name, position, isVisible],
        );
        const roleId = rows[0].id as number;
        for (const { capability, state } of capabilities) {
          await client.query(
            `INSERT INTO role_capabilities (role_id, capability, state) VALUES ($1, $2, $3)`,
            [roleId, capability, state],
          );
        }
        const created = await loadRole(client, roleId);
        await audit(client, {
          actorId,
          entityType: "role",
          entityId: roleId,
          action: "create",
          source: "admin",
          after: created,
        });
        return created;
      });
      announceRoleChange();
      return reply.code(201).send(role);
    },
  );

  api.patch(
    "/api/roles/:roleId",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Rename or toggle visibility of a role",
        params: roleIdParams,
        body: z.object({
          name: z.string().min(1).max(200).optional(),
          isVisible: z.boolean().optional(),
        }),
        response: { 200: roleResponse },
      },
    },
    async (req) => {
      const { roleId } = req.params;
      const role = await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const before = await loadRole(client, roleId);
        await requireRoleMutationAuthority(client, req.userId as number, before.position);
        const name = req.body.name ?? before.name;
        const isVisible = req.body.isVisible ?? before.isVisible;
        await client.query(`UPDATE roles SET name = $2, is_visible = $3 WHERE id = $1`, [
          roleId,
          name,
          isVisible,
        ]);
        await audit(client, {
          actorId: req.userId,
          entityType: "role",
          entityId: roleId,
          action: "update",
          source: "admin",
          before: { name: before.name, isVisible: before.isVisible },
          after: { name, isVisible },
        });
        return loadRole(client, roleId);
      });
      announceRoleChange();
      return role;
    },
  );

  api.patch(
    "/api/roles/:roleId/position",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Reorder a role",
        description:
          "Moves a role to an explicit new position (H8). Both the role's current and new position must sit strictly below the actor's own highest role; a position already in use 409s so the client can retry with a different gap value.",
        params: roleIdParams,
        body: z.object({ position: z.number().int() }),
        response: { 200: roleResponse },
      },
    },
    async (req) => {
      const { roleId } = req.params;
      const role = await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const actorId = req.userId as number;
        const before = await loadRole(client, roleId);
        await requireRoleMutationAuthority(client, actorId, before.position);
        await requireRoleMutationAuthority(client, actorId, req.body.position);
        const { rows: collision } = await client.query(
          `SELECT id FROM roles WHERE position = $1 AND id <> $2`,
          [req.body.position, roleId],
        );
        if (collision.length > 0) {
          throw new ConflictError("Another role already occupies this position", {
            position: req.body.position,
          });
        }
        await client.query(`UPDATE roles SET position = $2 WHERE id = $1`, [
          roleId,
          req.body.position,
        ]);
        await audit(client, {
          actorId,
          entityType: "role",
          entityId: roleId,
          action: "reorder",
          source: "admin",
          before: { position: before.position },
          after: { position: req.body.position },
        });
        return loadRole(client, roleId);
      });
      announceRoleChange();
      return role;
    },
  );

  api.put(
    "/api/roles/:roleId/capabilities",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Replace a role's tri-state capability grants",
        description:
          "Replaces every explicit ALLOW/DENY/INHERIT row for this role (H8). A capability omitted from the body reverts to the implicit INHERIT default.",
        params: roleIdParams,
        body: z.object({
          capabilities: z.array(
            z.object({ capability: z.string().min(1), state: permissionState }),
          ),
        }),
        response: { 200: roleResponse },
      },
    },
    async (req) => {
      const { roleId } = req.params;
      assertKnownCapabilities(req.body.capabilities.map((c) => c.capability));
      const result = await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const actorId = req.userId as number;
        const before = await loadRole(client, roleId);
        await requireRoleMutationAuthority(client, actorId, before.position);
        const introducesWildcard = req.body.capabilities.some(
          (c) => c.capability === CAPABILITIES.ADMIN_ALL && c.state === "allow",
        );
        const hadWildcard = await roleGrantsWildcard(client, roleId);
        if (introducesWildcard || hadWildcard) await requireWildcardRoleAuthority(client, actorId);
        await client.query(`DELETE FROM role_capabilities WHERE role_id = $1`, [roleId]);
        for (const { capability, state } of req.body.capabilities) {
          if (state === "inherit") continue; // matches the implicit default: no row needed
          await client.query(
            `INSERT INTO role_capabilities (role_id, capability, state) VALUES ($1, $2, $3)`,
            [roleId, capability, state],
          );
        }
        await audit(client, {
          actorId,
          entityType: "role",
          entityId: roleId,
          action: "set_capabilities",
          source: "admin",
          before: { capabilities: before.capabilities },
          after: { capabilities: req.body.capabilities },
        });
        if (hadWildcard && !introducesWildcard) await assertActiveWildcardHolder(client);
        return loadRole(client, roleId);
      });
      announceRoleChange();
      return result;
    },
  );

  api.delete(
    "/api/roles/:roleId",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: { params: roleIdParams, response: { 200: z.object({ deleted: z.literal(true) }) } },
    },
    async (req) => {
      const { roleId } = req.params;
      await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const before = await loadRole(client, roleId);
        if (before.isProtected) {
          throw new ConflictError("This role is protected and cannot be deleted", { roleId });
        }
        const actorId = req.userId as number;
        await requireRoleMutationAuthority(client, actorId, before.position);
        const removesWildcard = await roleGrantsWildcard(client, roleId);
        await client.query(`DELETE FROM roles WHERE id = $1`, [roleId]);
        if (removesWildcard) await assertActiveWildcardHolder(client);
        await audit(client, {
          actorId,
          entityType: "role",
          entityId: roleId,
          action: "delete",
          source: "admin",
          before,
        });
      });
      announceRoleChange();
      return { deleted: true as const };
    },
  );

  // ── user assignment ──────────────────────────────────────────────────────

  api.post(
    "/api/roles/:roleId/users/:userId",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Assign a role to a user",
        params: z.object({
          roleId: z.coerce.number().int(),
          userId: z.coerce.number().int(),
        }),
        response: { 200: roleResponse },
      },
    },
    async (req) => {
      const { roleId, userId } = req.params;
      const result = await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const actorId = req.userId as number;
        const role = await loadRole(client, roleId);
        await requireRoleMutationAuthority(client, actorId, role.position);
        const { rows: userRows } = await client.query(
          `SELECT id FROM users
            WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
            FOR UPDATE`,
          [userId],
        );
        if (userRows.length === 0) throw new NotFoundError("User not found", { userId });
        await client.query(
          `INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [userId, roleId, actorId],
        );
        // A capability holder is staff (H8); issue their permanent entrance
        // ticket in the same transaction as the role-producing assignment.
        if (await userHasAnyCapability(client, userId)) await issueTicket(client, userId);
        await audit(client, {
          actorId,
          entityType: "role",
          entityId: roleId,
          action: "assign_user",
          source: "admin",
          after: { userId },
        });
        return loadRole(client, roleId);
      });
      announceRoleChange();
      return result;
    },
  );

  api.delete(
    "/api/roles/:roleId/users/:userId",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Remove a role from a user",
        params: z.object({
          roleId: z.coerce.number().int(),
          userId: z.coerce.number().int(),
        }),
        response: { 200: roleResponse },
      },
    },
    async (req) => {
      const { roleId, userId } = req.params;
      const result = await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const actorId = req.userId as number;
        const role = await loadRole(client, roleId);
        await requireRoleMutationAuthority(client, actorId, role.position);
        const removesWildcard = await roleGrantsWildcard(client, roleId);
        await client.query(`DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`, [
          userId,
          roleId,
        ]);
        if (removesWildcard) await assertActiveWildcardHolder(client, undefined);
        await audit(client, {
          actorId,
          entityType: "role",
          entityId: roleId,
          action: "remove_user",
          source: "admin",
          before: { userId },
        });
        return loadRole(client, roleId);
      });
      announceRoleChange();
      return result;
    },
  );

  api.get(
    "/api/users/:userId/roles",
    {
      preHandler: readRoles,
      config: routeAccess({
        kind: "capability",
        anyOf: [CAPABILITIES.PERMISSIONS_MANAGE, CAPABILITIES.INVITES_MANAGE],
      }),
      schema: {
        summary: "List a user's assigned roles",
        params: z.object({ userId: z.coerce.number().int() }),
        response: {
          200: z.array(
            z.object({
              id: z.number(),
              name: z.string(),
              position: z.number(),
              isVisible: z.boolean(),
            }),
          ),
        },
      },
    },
    async (req) => {
      const { rows } = await pool.query(
        `SELECT r.id, r.name, r.position, r.is_visible
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = $1
          ORDER BY r.position DESC`,
        [req.params.userId],
      );
      return rows.map((r: Record<string, unknown>) => ({
        id: r.id as number,
        name: r.name as string,
        position: r.position as number,
        isVisible: r.is_visible as boolean,
      }));
    },
  );

  api.get(
    "/api/roles/capability-catalogue",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "List every known capability",
        description: "The full shared capability catalogue (H8), for the role capability editor.",
        response: { 200: z.array(z.string()) },
      },
    },
    async () => [...ALL_CAPABILITIES],
  );
}
