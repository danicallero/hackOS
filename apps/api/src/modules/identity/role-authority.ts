import { CAPABILITIES } from "@hackos/shared/capabilities";
import type pg from "pg";
import { getEffectiveCapabilities } from "../../lib/capabilities.js";
import { ConflictError, ForbiddenError } from "../../lib/errors.js";

export type RoleGraphClient = pg.PoolClient;

// "HOS9" — distinct from the retired permission-graph lock key (0x484f5338)
// so an in-flight old-model transaction from before this cutover can never
// interleave with a role-graph mutation.
const ROLE_GRAPH_LOCK = 0x484f5339;

/**
 * Serializes changes that can alter role positions or role_capabilities.
 * Call this inside the surrounding transaction before reading or mutating
 * the role graph (H8; mirrors the old lockPermissionGraph, CLAUDE.md rule 6).
 */
export async function lockRoleGraph(client: RoleGraphClient): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock($1)`, [ROLE_GRAPH_LOCK]);
}

// H8: system:superadmin is provisioned and managed exclusively via server
// shell CLI scripts (scripts/grant-superadmin.mjs, scripts/create-superadmin.ts,
// scripts/revoke-superadmin.mjs) — never through the HTTP API, regardless of
// the actor's capabilities (including a '*' wildcard holder). Identified by
// NAME rather than is_protected, since is_protected may describe other
// default roles (e.g. Platform administrator) without granting them this
// same CLI-only lockout.
export const SUPERADMIN_ROLE_NAME = "system:superadmin";

/**
 * Throws if `roleName` is system:superadmin. Call this from every roles route
 * that mutates an EXISTING role by id (rename, reorder, capabilities,
 * delete, restore, assign/unassign member) before making any write, and from
 * role creation to stop an API caller from ever minting a decoy role under
 * this reserved name.
 */
export function assertNotSuperadminRole(roleName: string): void {
  if (roleName === SUPERADMIN_ROLE_NAME) {
    throw new ForbiddenError(
      "system:superadmin can only be managed via server shell CLI scripts, never the API",
      { roleName },
    );
  }
}

/** Highest role position among a user's assigned, non-deleted roles, or null if they hold none. */
export async function highestRolePosition(
  client: RoleGraphClient,
  userId: number,
): Promise<number | null> {
  const { rows } = await client.query(
    `SELECT MAX(r.position) AS position
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1 AND r.deleted_at IS NULL`,
    [userId],
  );
  const position = rows[0]?.position;
  return position === null || position === undefined ? null : Number(position);
}

/**
 * Whether an active user resolves `capability` to ALLOW through their own
 * assigned-role chain, ordered by position descending, short-circuiting on
 * the first ALLOW/DENY (H8's tri-state resolution — see lib/capabilities.ts
 * for the full-set equivalent used by ordinary request authorization).
 */
export async function userResolvesCapability(
  client: RoleGraphClient,
  userId: number,
  capability: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT COALESCE(rc.state, 'inherit') AS state
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       JOIN users u ON u.id = ur.user_id
       LEFT JOIN role_capabilities rc ON rc.role_id = r.id AND rc.capability = $2
      WHERE ur.user_id = $1 AND u.account_state = 'active' AND u.anonymized_at IS NULL
        AND r.deleted_at IS NULL
      ORDER BY r.position DESC`,
    [userId, capability],
  );
  for (const row of rows as { state: "allow" | "deny" | "inherit" }[]) {
    if (row.state === "allow") return true;
    if (row.state === "deny") return false;
  }
  return false;
}

/**
 * Like userResolvesCapability, but without the active/anonymized filter —
 * for account-removal bookkeeping that runs in the same transaction as the
 * account_state change itself (H54), where "was this user a wildcard holder
 * a moment ago" must not be masked by the state flip that just happened.
 */
export async function userResolvesCapabilityRegardlessOfState(
  client: RoleGraphClient,
  userId: number,
  capability: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT COALESCE(rc.state, 'inherit') AS state
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_capabilities rc ON rc.role_id = r.id AND rc.capability = $2
      WHERE ur.user_id = $1 AND r.deleted_at IS NULL
      ORDER BY r.position DESC`,
    [userId, capability],
  );
  for (const row of rows as { state: "allow" | "deny" | "inherit" }[]) {
    if (row.state === "allow") return true;
    if (row.state === "deny") return false;
  }
  return false;
}

export async function requireWildcardRoleAuthority(
  client: RoleGraphClient,
  actorId: number,
): Promise<void> {
  if (!(await userResolvesCapability(client, actorId, CAPABILITIES.ADMIN_ALL))) {
    throw new ForbiddenError("Only an existing wildcard holder may mutate wildcard access");
  }
}

/** Whether a role's own direct capability rows grant the wildcard. */
export async function roleGrantsWildcard(
  client: RoleGraphClient,
  roleId: number,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1
       FROM role_capabilities rc
       JOIN roles r ON r.id = rc.role_id
      WHERE rc.role_id = $1 AND rc.capability = $2 AND rc.state = 'allow' AND r.deleted_at IS NULL`,
    [roleId, CAPABILITIES.ADMIN_ALL],
  );
  return rows.length > 0;
}

/**
 * Discord-style admin-hierarchy authority guard (H8): to assign, remove,
 * edit, or reorder a role, the actor's highest assigned-role position must
 * be STRICTLY greater than the role's position (the NEW position, for a
 * reorder — validate the post-update value, never just the current one).
 * Never equal, never lower — a role at the actor's own ceiling still can't
 * be touched by that actor, which blocks self-elevation to a peer of one's
 * own top role along with any escalation above it.
 */
export async function requireRoleMutationAuthority(
  client: RoleGraphClient,
  actorId: number,
  targetPosition: number,
): Promise<void> {
  const actorHighest = await highestRolePosition(client, actorId);
  if (actorHighest === null || !(targetPosition < actorHighest)) {
    throw new ForbiddenError(
      "You may only manage roles positioned strictly below your own highest role",
      { targetPosition, actorHighest },
    );
  }
}

/**
 * Ensures a role mutation leaves at least one active user resolving the
 * wildcard capability to ALLOW (reimplements the old
 * assertActiveWildcardHolder equivalently over the role hierarchy).
 */
export async function assertActiveWildcardHolder(
  client: RoleGraphClient,
  excludedUserId?: number,
): Promise<void> {
  const { rows } = await client.query(
    `WITH candidate AS (
       SELECT ur.user_id, r.position, COALESCE(rc.state, 'inherit') AS state
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         JOIN users u ON u.id = ur.user_id
         LEFT JOIN role_capabilities rc ON rc.role_id = r.id AND rc.capability = $1
        WHERE u.account_state = 'active' AND u.anonymized_at IS NULL
          AND r.deleted_at IS NULL
          AND ($2::integer IS NULL OR ur.user_id <> $2)
     ), resolved AS (
       SELECT DISTINCT ON (user_id) user_id, state
         FROM candidate
        WHERE state <> 'inherit'
        ORDER BY user_id, position DESC
     )
     SELECT 1 FROM resolved WHERE state = 'allow' LIMIT 1`,
    [CAPABILITIES.ADMIN_ALL, excludedUserId ?? null],
  );
  if (rows.length === 0) {
    throw new ConflictError("Role changes must retain one active wildcard holder");
  }
}

/** Returns whether a user holds any effective capability at all (any ALLOW anywhere in their chain). */
export async function userHasAnyCapability(
  client: RoleGraphClient,
  userId: number,
): Promise<boolean> {
  const capabilities = await getEffectiveCapabilities(userId, undefined, client);
  return capabilities.size > 0;
}
