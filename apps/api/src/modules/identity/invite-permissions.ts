import { NotFoundError } from "../../lib/errors.js";
import {
  groupContainsWildcard,
  lockPermissionGraph,
  type PermissionGraphClient,
  requireWildcardGraphAuthority,
} from "./permission-graph.js";

/**
 * Deferred invitation grants use the same permission-graph lock and wildcard
 * provenance rules whether the invitation is email-bound or reusable (H8,
 * H10, H53).
 */
export async function inviteContainsWildcardGroup(
  client: PermissionGraphClient,
  groupIds: readonly number[],
  { requireExisting = false }: { requireExisting?: boolean } = {},
): Promise<boolean> {
  let containsWildcard = false;
  for (const groupId of groupIds) {
    const { rows } = await client.query(`SELECT id FROM permission_groups WHERE id = $1`, [
      groupId,
    ]);
    if (!rows[0]) {
      if (requireExisting) throw new NotFoundError("Permission group not found", { groupId });
      continue;
    }
    if (await groupContainsWildcard(client, groupId)) containsWildcard = true;
  }
  return containsWildcard;
}

export async function requireWildcardInviteAuthority(
  client: PermissionGraphClient,
  actorId: number,
  groupIds: readonly number[],
  options?: { requireExisting?: boolean },
): Promise<boolean> {
  const containsWildcard = await inviteContainsWildcardGroup(client, groupIds, options);
  if (containsWildcard) await requireWildcardGraphAuthority(client, actorId);
  return containsWildcard;
}

/**
 * A reusable staff link must result in at least one effective capability. The
 * role shown by identity is derived from this graph; this check prevents a
 * link that claims to create staff while granting no operational access.
 */
export async function groupIdsGrantCapability(
  client: PermissionGraphClient,
  groupIds: readonly number[],
): Promise<boolean> {
  if (groupIds.length === 0) return false;
  const { rows } = await client.query(
    `WITH RECURSIVE effective_groups(group_id) AS (
       SELECT unnest($1::integer[])
       UNION
       SELECT pgi.child_group_id
       FROM permission_group_includes pgi
       JOIN effective_groups eg ON eg.group_id = pgi.parent_group_id
     )
     SELECT 1
     FROM effective_groups eg
     JOIN group_capabilities gc ON gc.group_id = eg.group_id
     LIMIT 1`,
    [groupIds],
  );
  return rows.length > 0;
}

export { lockPermissionGraph };
