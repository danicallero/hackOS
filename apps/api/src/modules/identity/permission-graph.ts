import { CAPABILITIES } from "@hackos/shared/capabilities";
import type pg from "pg";

import { ConflictError, ForbiddenError } from "../../lib/errors.js";

export type PermissionGraphClient = pg.PoolClient;

const PERMISSION_GRAPH_LOCK = 0x484f5338; // "HOS8"

/**
 * Serializes changes that can alter effective group capability membership.
 * Call this inside the surrounding transaction before reading or mutating
 * the permission graph.
 */
export async function lockPermissionGraph(client: PermissionGraphClient): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock($1)`, [PERMISSION_GRAPH_LOCK]);
}

/** Returns whether this group inherits the wildcard capability. */
export async function groupContainsWildcard(
  client: PermissionGraphClient,
  groupId: number,
): Promise<boolean> {
  const { rows } = await client.query(
    `WITH RECURSIVE effective_groups(group_id) AS (
       SELECT $1::integer
       UNION
       SELECT pgi.child_group_id
       FROM permission_group_includes pgi
       JOIN effective_groups eg ON eg.group_id = pgi.parent_group_id
     )
     SELECT 1
     FROM effective_groups eg
     JOIN group_capabilities gc ON gc.group_id = eg.group_id
     WHERE gc.capability = $2
     LIMIT 1`,
    [groupId, CAPABILITIES.ADMIN_ALL],
  );
  return rows.length > 0;
}

/** Returns whether a user inherits the wildcard capability from any group. */
export async function userHasWildcard(
  client: PermissionGraphClient,
  userId: number,
): Promise<boolean> {
  const { rows } = await client.query(
    `WITH RECURSIVE effective_groups(group_id) AS (
       SELECT pgm.group_id
       FROM users u
       JOIN permission_group_members pgm ON pgm.user_id = u.id
       WHERE u.id = $1 AND u.anonymized_at IS NULL
       UNION
       SELECT pgi.child_group_id
       FROM permission_group_includes pgi
       JOIN effective_groups eg ON eg.group_id = pgi.parent_group_id
     )
     SELECT 1
     FROM effective_groups eg
     JOIN group_capabilities gc ON gc.group_id = eg.group_id
     WHERE gc.capability = $2
     LIMIT 1`,
    [userId, CAPABILITIES.ADMIN_ALL],
  );
  return rows.length > 0;
}

/** Returns whether a user holds any effective capability at all. */
export async function userHasAnyCapability(
  client: PermissionGraphClient,
  userId: number,
): Promise<boolean> {
  const { rows } = await client.query(
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
  return rows.length > 0;
}

export async function requireWildcardGraphAuthority(
  client: PermissionGraphClient,
  actorId: number,
): Promise<void> {
  if (!(await userHasWildcard(client, actorId))) {
    throw new ForbiddenError("Only an existing wildcard holder may mutate wildcard access");
  }
}

export async function requireGroupMutationAuthority(
  client: PermissionGraphClient,
  actorId: number,
  groupId: number,
): Promise<void> {
  if (await groupContainsWildcard(client, groupId)) {
    await requireWildcardGraphAuthority(client, actorId);
  }
}

/** Ensures a graph mutation leaves an active user with wildcard access. */
export async function assertActiveWildcardHolder(client: PermissionGraphClient): Promise<void> {
  const { rows } = await client.query(
    `WITH RECURSIVE effective_groups(user_id, group_id) AS (
       SELECT pgm.user_id, pgm.group_id
       FROM permission_group_members pgm
       JOIN users u ON u.id = pgm.user_id
       WHERE u.anonymized_at IS NULL
       UNION
       SELECT eg.user_id, pgi.child_group_id
       FROM effective_groups eg
       JOIN permission_group_includes pgi ON pgi.parent_group_id = eg.group_id
     )
     SELECT 1
     FROM effective_groups eg
     JOIN group_capabilities gc ON gc.group_id = eg.group_id
     WHERE gc.capability = $1
     LIMIT 1`,
    [CAPABILITIES.ADMIN_ALL],
  );
  if (rows.length === 0) {
    throw new ConflictError("Permission changes must retain one active wildcard holder");
  }
}
