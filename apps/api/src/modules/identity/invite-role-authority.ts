import { NotFoundError } from "../../lib/errors.js";
import {
  assertNotSuperadminRole,
  lockRoleGraph,
  type RoleGraphClient,
  requireWildcardRoleAuthority,
  roleGrantsWildcard,
} from "./role-authority.js";

/**
 * Deferred invitation grants (H8, H10, H53) use the same role-graph lock and
 * wildcard-provenance rules whether the invitation is email-bound or
 * reusable. The invite/link `group_ids` column (kept under that name for API
 * compatibility, see 0803's migration comment) now holds `roles.id` values.
 *
 * Also enforces the system:superadmin CLI-only lockout (H8) here: without
 * this check, a wildcard ('*') holder who isn't the superadmin themselves
 * could otherwise pre-assign system:superadmin to a fresh invitee through
 * this deferred path and slip past every role-route's own
 * assertNotSuperadminRole guard.
 */
export async function inviteContainsWildcardRole(
  client: RoleGraphClient,
  roleIds: readonly number[],
  { requireExisting = false }: { requireExisting?: boolean } = {},
): Promise<boolean> {
  let containsWildcard = false;
  for (const roleId of roleIds) {
    const { rows } = await client.query(`SELECT id, name FROM roles WHERE id = $1`, [roleId]);
    if (!rows[0]) {
      if (requireExisting) throw new NotFoundError("Role not found", { roleId });
      continue;
    }
    assertNotSuperadminRole(rows[0].name as string);
    if (await roleGrantsWildcard(client, roleId)) containsWildcard = true;
  }
  return containsWildcard;
}

export async function requireWildcardInviteAuthority(
  client: RoleGraphClient,
  actorId: number,
  roleIds: readonly number[],
  options?: { requireExisting?: boolean },
): Promise<boolean> {
  const containsWildcard = await inviteContainsWildcardRole(client, roleIds, options);
  if (containsWildcard) await requireWildcardRoleAuthority(client, actorId);
  return containsWildcard;
}

/**
 * A reusable staff link must result in at least one effective capability —
 * the visible role shown by identity is derived from assigned roles; this
 * check prevents a link that claims to create staff while granting no
 * operational access. A role's OWN direct ALLOW rows are enough here (the
 * link grants exactly these roles fresh — there's no other role in the
 * chain yet to inherit from).
 */
export async function roleIdsGrantCapability(
  client: RoleGraphClient,
  roleIds: readonly number[],
): Promise<boolean> {
  if (roleIds.length === 0) return false;
  const { rows } = await client.query(
    `SELECT 1 FROM role_capabilities WHERE role_id = ANY($1::integer[]) AND state = 'allow' LIMIT 1`,
    [roleIds],
  );
  return rows.length > 0;
}

export { lockRoleGraph };
