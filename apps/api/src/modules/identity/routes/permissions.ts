import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import { z } from "zod";
import { pool, withTransaction } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import {
  invalidateAllCapabilities,
  invalidateCapabilities,
  requireCapability,
} from "../../../lib/capabilities.js";
import { ConflictError, NotFoundError } from "../../../lib/errors.js";
import { issueTicket } from "../../logistics/tickets.js";

/**
 * Permission-group management (H8): groups of capabilities, groups of groups
 * (cycles rejected with 409), member assignment. Everything guarded by
 * PERMISSIONS_MANAGE, everything audited (H53) in the same transaction, and
 * every mutation invalidates the Valkey capability cache so revocation takes
 * effect immediately.
 */

const manage = requireCapability(CAPABILITIES.PERMISSIONS_MANAGE);

const groupIdParams = z.object({ groupId: z.coerce.number().int() });

const groupResponse = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  capabilities: z.array(z.string()),
  includes: z.array(z.number()),
  members: z.array(z.number()),
});

async function loadGroup(db: pg.Pool | pg.PoolClient, groupId: number) {
  const { rows } = await db.query(`SELECT * FROM permission_groups WHERE id = $1`, [groupId]);
  if (!rows[0]) throw new NotFoundError("Permission group not found", { groupId });
  // Sequential on purpose: `db` may be a single PoolClient inside a
  // transaction, which cannot run queries concurrently.
  const caps = await db.query(
    `SELECT capability FROM group_capabilities WHERE group_id = $1 ORDER BY capability`,
    [groupId],
  );
  const includes = await db.query(
    `SELECT child_group_id FROM permission_group_includes WHERE parent_group_id = $1 ORDER BY child_group_id`,
    [groupId],
  );
  const members = await db.query(
    `SELECT user_id FROM permission_group_members WHERE group_id = $1 ORDER BY user_id`,
    [groupId],
  );
  return {
    id: rows[0].id as number,
    name: rows[0].name as string,
    description: rows[0].description as string | null,
    capabilities: caps.rows.map((r: { capability: string }) => r.capability),
    includes: includes.rows.map((r: { child_group_id: number }) => r.child_group_id),
    members: members.rows.map((r: { user_id: number }) => r.user_id),
  };
}

/**
 * Would adding parent -> child create a cycle? True when `parent` is
 * reachable FROM `child` through existing includes (or parent === child).
 * Runs inside the same transaction as the insert so a concurrent edit can't
 * sneak a cycle past the check.
 */
async function wouldCreateCycle(
  db: pg.Pool | pg.PoolClient,
  parentId: number,
  childId: number,
): Promise<boolean> {
  if (parentId === childId) return true;
  const { rows } = await db.query(
    `WITH RECURSIVE reachable AS (
       SELECT child_group_id FROM permission_group_includes WHERE parent_group_id = $1
       UNION
       SELECT gi.child_group_id
       FROM permission_group_includes gi
       JOIN reachable r ON r.child_group_id = gi.parent_group_id
     )
     SELECT 1 FROM reachable WHERE child_group_id = $2 LIMIT 1`,
    [childId, parentId],
  );
  return rows.length > 0;
}

/** Ticket every existing member who becomes a capability holder through this group. */
async function issueTicketsForGroupMembers(client: pg.PoolClient, groupId: number): Promise<void> {
  const { rows } = await client.query(
    `WITH RECURSIVE ancestor_groups(group_id) AS (
       SELECT $1::integer
       UNION
       SELECT pgi.parent_group_id
         FROM permission_group_includes pgi
         JOIN ancestor_groups ag ON ag.group_id = pgi.child_group_id
     ), affected_users AS (
       SELECT DISTINCT pgm.user_id
         FROM permission_group_members pgm
         JOIN ancestor_groups ag ON ag.group_id = pgm.group_id
     ), effective_groups(user_id, group_id) AS (
       SELECT user_id, group_id FROM permission_group_members
       UNION
       SELECT eg.user_id, pgi.child_group_id
         FROM effective_groups eg
         JOIN permission_group_includes pgi ON pgi.parent_group_id = eg.group_id
     )
     SELECT au.user_id
       FROM affected_users au
      WHERE EXISTS (
        SELECT 1 FROM effective_groups eg
        JOIN group_capabilities gc ON gc.group_id = eg.group_id
        WHERE eg.user_id = au.user_id
      )`,
    [groupId],
  );
  for (const row of rows) await issueTicket(client, row.user_id as number);
}

export function registerPermissionGroupRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    "/api/permission-groups",
    {
      preHandler: manage,
      schema: {
        response: {
          200: z.array(
            z.object({ id: z.number(), name: z.string(), description: z.string().nullable() }),
          ),
        },
      },
    },
    async () => {
      const { rows } = await pool.query(
        `SELECT id, name, description FROM permission_groups ORDER BY name`,
      );
      return rows;
    },
  );

  api.get(
    "/api/permission-groups/:groupId",
    { preHandler: manage, schema: { params: groupIdParams, response: { 200: groupResponse } } },
    async (req) => loadGroup(pool, req.params.groupId),
  );

  api.post(
    "/api/permission-groups",
    {
      preHandler: manage,
      schema: {
        body: z.object({
          name: z.string().min(1).max(200),
          description: z.string().max(2000).optional(),
          capabilities: z.array(z.string().min(1)).default([]),
        }),
        response: { 201: groupResponse },
      },
    },
    async (req, reply) => {
      const { name, description, capabilities } = req.body;
      const group = await withTransaction(async (client) => {
        const { rows: existing } = await client.query(
          `SELECT id FROM permission_groups WHERE name = $1`,
          [name],
        );
        if (existing.length > 0)
          throw new ConflictError("A group with this name already exists", { name });
        const { rows } = await client.query(
          `INSERT INTO permission_groups (name, description) VALUES ($1, $2) RETURNING id`,
          [name, description ?? null],
        );
        const groupId = rows[0].id as number;
        for (const capability of capabilities) {
          await client.query(
            `INSERT INTO group_capabilities (group_id, capability) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [groupId, capability],
          );
        }
        await audit(client, {
          actorId: req.userId,
          entityType: "permission_group",
          entityId: groupId,
          action: "create",
          source: "admin",
          after: { name, description: description ?? null, capabilities },
        });
        return loadGroup(client, groupId);
      });
      return reply.code(201).send(group);
    },
  );

  api.patch(
    "/api/permission-groups/:groupId",
    {
      preHandler: manage,
      schema: {
        params: groupIdParams,
        body: z.object({
          name: z.string().min(1).max(200).optional(),
          description: z.string().max(2000).nullable().optional(),
        }),
        response: { 200: groupResponse },
      },
    },
    async (req) => {
      const { groupId } = req.params;
      return withTransaction(async (client) => {
        const before = await loadGroup(client, groupId);
        const name = req.body.name ?? before.name;
        const description =
          req.body.description === undefined ? before.description : req.body.description;
        await client.query(
          `UPDATE permission_groups SET name = $2, description = $3 WHERE id = $1`,
          [groupId, name, description],
        );
        await audit(client, {
          actorId: req.userId,
          entityType: "permission_group",
          entityId: groupId,
          action: "update",
          source: "admin",
          before: { name: before.name, description: before.description },
          after: { name, description },
        });
        return loadGroup(client, groupId);
      });
    },
  );

  api.delete(
    "/api/permission-groups/:groupId",
    {
      preHandler: manage,
      schema: { params: groupIdParams, response: { 200: z.object({ deleted: z.literal(true) }) } },
    },
    async (req) => {
      const { groupId } = req.params;
      await withTransaction(async (client) => {
        const before = await loadGroup(client, groupId);
        await client.query(`DELETE FROM permission_groups WHERE id = $1`, [groupId]);
        await audit(client, {
          actorId: req.userId,
          entityType: "permission_group",
          entityId: groupId,
          action: "delete",
          source: "admin",
          before,
        });
      });
      await invalidateAllCapabilities();
      return { deleted: true as const };
    },
  );

  // ── capabilities ─────────────────────────────────────────────────────────

  api.put(
    "/api/permission-groups/:groupId/capabilities",
    {
      preHandler: manage,
      schema: {
        params: groupIdParams,
        body: z.object({ capabilities: z.array(z.string().min(1)) }),
        response: { 200: groupResponse },
      },
    },
    async (req) => {
      const { groupId } = req.params;
      const result = await withTransaction(async (client) => {
        const before = await loadGroup(client, groupId);
        await client.query(`DELETE FROM group_capabilities WHERE group_id = $1`, [groupId]);
        for (const capability of req.body.capabilities) {
          await client.query(
            `INSERT INTO group_capabilities (group_id, capability) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [groupId, capability],
          );
        }
        await issueTicketsForGroupMembers(client, groupId);
        await audit(client, {
          actorId: req.userId,
          entityType: "permission_group",
          entityId: groupId,
          action: "set_capabilities",
          source: "admin",
          before: { capabilities: before.capabilities },
          after: { capabilities: req.body.capabilities },
        });
        return loadGroup(client, groupId);
      });
      await invalidateAllCapabilities();
      return result;
    },
  );

  // ── includes (groups of groups) ──────────────────────────────────────────

  api.post(
    "/api/permission-groups/:groupId/includes",
    {
      preHandler: manage,
      schema: {
        params: groupIdParams,
        body: z.object({ childGroupId: z.number().int() }),
        response: { 200: groupResponse },
      },
    },
    async (req) => {
      const { groupId } = req.params;
      const { childGroupId } = req.body;
      const result = await withTransaction(async (client) => {
        await loadGroup(client, groupId);
        await loadGroup(client, childGroupId);
        if (await wouldCreateCycle(client, groupId, childGroupId)) {
          throw new ConflictError("Including this group would create a cycle", {
            parentGroupId: groupId,
            childGroupId,
          });
        }
        await client.query(
          `INSERT INTO permission_group_includes (parent_group_id, child_group_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [groupId, childGroupId],
        );
        await issueTicketsForGroupMembers(client, groupId);
        await audit(client, {
          actorId: req.userId,
          entityType: "permission_group",
          entityId: groupId,
          action: "add_include",
          source: "admin",
          after: { childGroupId },
        });
        return loadGroup(client, groupId);
      });
      await invalidateAllCapabilities();
      return result;
    },
  );

  api.delete(
    "/api/permission-groups/:groupId/includes/:childGroupId",
    {
      preHandler: manage,
      schema: {
        params: z.object({
          groupId: z.coerce.number().int(),
          childGroupId: z.coerce.number().int(),
        }),
        response: { 200: groupResponse },
      },
    },
    async (req) => {
      const { groupId, childGroupId } = req.params;
      const result = await withTransaction(async (client) => {
        await loadGroup(client, groupId);
        await client.query(
          `DELETE FROM permission_group_includes WHERE parent_group_id = $1 AND child_group_id = $2`,
          [groupId, childGroupId],
        );
        await audit(client, {
          actorId: req.userId,
          entityType: "permission_group",
          entityId: groupId,
          action: "remove_include",
          source: "admin",
          before: { childGroupId },
        });
        return loadGroup(client, groupId);
      });
      await invalidateAllCapabilities();
      return result;
    },
  );

  // ── members ──────────────────────────────────────────────────────────────

  api.post(
    "/api/permission-groups/:groupId/members",
    {
      preHandler: manage,
      schema: {
        params: groupIdParams,
        body: z.object({ userId: z.number().int() }),
        response: { 200: groupResponse },
      },
    },
    async (req) => {
      const { groupId } = req.params;
      const { userId } = req.body;
      const result = await withTransaction(async (client) => {
        await loadGroup(client, groupId);
        const { rows: userRows } = await client.query(`SELECT id FROM users WHERE id = $1`, [
          userId,
        ]);
        if (userRows.length === 0) throw new NotFoundError("User not found", { userId });
        await client.query(
          `INSERT INTO permission_group_members (user_id, group_id, assigned_by)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [userId, groupId, req.userId],
        );
        // A capability holder is staff (H8); issue their permanent entrance
        // ticket in the same transaction as the role-producing assignment.
        const { rows: capabilities } = await client.query(
          `WITH RECURSIVE effective_groups(group_id) AS (
             SELECT group_id FROM permission_group_members WHERE user_id = $1
             UNION
             SELECT pgi.child_group_id
               FROM effective_groups eg
               JOIN permission_group_includes pgi ON pgi.parent_group_id = eg.group_id
           )
           SELECT 1 FROM effective_groups eg
            JOIN group_capabilities gc ON gc.group_id = eg.group_id
           LIMIT 1`,
          [userId],
        );
        if (capabilities.length > 0) await issueTicket(client, userId);
        await audit(client, {
          actorId: req.userId,
          entityType: "permission_group",
          entityId: groupId,
          action: "add_member",
          source: "admin",
          after: { userId },
        });
        return loadGroup(client, groupId);
      });
      await invalidateCapabilities(userId);
      return result;
    },
  );

  api.delete(
    "/api/permission-groups/:groupId/members/:userId",
    {
      preHandler: manage,
      schema: {
        params: z.object({
          groupId: z.coerce.number().int(),
          userId: z.coerce.number().int(),
        }),
        response: { 200: groupResponse },
      },
    },
    async (req) => {
      const { groupId, userId } = req.params;
      const result = await withTransaction(async (client) => {
        await loadGroup(client, groupId);
        await client.query(
          `DELETE FROM permission_group_members WHERE user_id = $1 AND group_id = $2`,
          [userId, groupId],
        );
        await audit(client, {
          actorId: req.userId,
          entityType: "permission_group",
          entityId: groupId,
          action: "remove_member",
          source: "admin",
          before: { userId },
        });
        return loadGroup(client, groupId);
      });
      await invalidateCapabilities(userId);
      return result;
    },
  );
}
