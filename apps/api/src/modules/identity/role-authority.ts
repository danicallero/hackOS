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
// the actor's capabilities (including a '*' wildcard holder). This name is
// used ONLY to look up/create/reserve that one specific role (the CLI
// scripts, and the create/rename routes that must refuse the name outright so
// an API caller can never mint a decoy role under it) — it is NOT how
// mutation is blocked on an EXISTING protected role. That's a separate,
// general concern: see assertNotProtectedRole below, keyed off the real
// roles.is_protected column so any future protected role gets the identical
// lockout automatically.
export const SUPERADMIN_ROLE_NAME = "system:superadmin";

/**
 * Throws if `roleName` is the reserved system:superadmin name. Call this from
 * role creation and from a rename's target name, to stop an API caller from
 * ever minting or renaming a role into this reserved identity. This is an
 * identity check, not a mutation-authority check — it says nothing about
 * whether an EXISTING role by this name (or any other) is locked from
 * mutation; that's assertNotProtectedRole.
 */
export function assertNotSuperadminRole(roleName: string): void {
  if (roleName === SUPERADMIN_ROLE_NAME) {
    throw new ForbiddenError(
      "system:superadmin is a reserved name and cannot be created or renamed to via the API",
      { roleName },
    );
  }
}

/**
 * Throws if an EXISTING role is protected (roles.is_protected = true) — the
 * real, DB-authoritative "locked out of every HTTP mutation" signal (H8).
 * Call this from every roles route that mutates an EXISTING role by id
 * (rename, reorder, capabilities, delete, restore, assign/unassign member)
 * before making any write, using the role row the handler already loaded —
 * unconditional on the actor's own capabilities, including a '*' wildcard
 * holder. Only system:superadmin carries this flag today (CLI-provisioned;
 * is_protected is never settable via POST/PATCH /api/roles), but any future
 * role an operator flags this way via direct DB/CLI action gets the
 * identical lockout without a code change.
 */
export function assertNotProtectedRole(role: { isProtected: boolean; name?: string }): void {
  if (role.isProtected) {
    throw new ForbiddenError(
      "This role is protected and can only be managed via server shell CLI scripts, never the API",
      { roleName: role.name },
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
 * Shared tri-state resolution behind userResolvesCapability and
 * userResolvesCapabilityRegardlessOfState: the user's own assigned-role
 * chain, ordered by position descending, short-circuiting on the first
 * ALLOW/DENY (H8's tri-state resolution — see lib/capabilities.ts for the
 * full-set equivalent used by ordinary request authorization). The two
 * public functions differ only in whether the active/anonymized filter
 * applies (H54's account-removal bookkeeping needs it OFF, everything else
 * needs it ON) — kept as one parameterized query so that SQL exists once.
 */
async function resolveUserCapability(
  client: RoleGraphClient,
  userId: number,
  capability: string,
  requireActive: boolean,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT COALESCE(rc.state, 'inherit') AS state
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       JOIN users u ON u.id = ur.user_id
       LEFT JOIN role_capabilities rc ON rc.role_id = r.id AND rc.capability = $2
      WHERE ur.user_id = $1
        AND ($3::boolean = false OR (u.account_state = 'active' AND u.anonymized_at IS NULL))
        AND r.deleted_at IS NULL
      ORDER BY r.position DESC`,
    [userId, capability, requireActive],
  );
  for (const row of rows as { state: "allow" | "deny" | "inherit" }[]) {
    if (row.state === "allow") return true;
    if (row.state === "deny") return false;
  }
  return false;
}

/**
 * Whether an active user resolves `capability` to ALLOW through their own
 * assigned-role chain (H8's tri-state resolution).
 */
export async function userResolvesCapability(
  client: RoleGraphClient,
  userId: number,
  capability: string,
): Promise<boolean> {
  return resolveUserCapability(client, userId, capability, true);
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
  return resolveUserCapability(client, userId, capability, false);
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
 * The multi-role hierarchy's admin-authority guard (H8): to assign, remove,
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

/**
 * Resolves the actor's full effective capability set ONCE (rather than one
 * userResolvesCapability query per candidate capability), then asserts every
 * entry in `capabilities` is a member — or that the actor holds the wildcard
 * ('*' / ADMIN_ALL), which exempts them entirely (a wildcard holder can
 * already do everything, so content-gating them would be meaningless).
 * Shared by requireCapabilityPossessionForStateChange and
 * requireCapabilityPossessionForAssignment below (H8) so the possession
 * check's actual query pattern exists in one place.
 */
export async function assertPossessesAll(
  client: RoleGraphClient,
  actorId: number,
  capabilities: readonly string[],
  message: string,
): Promise<void> {
  if (capabilities.length === 0) return;
  const effective = await getEffectiveCapabilities(actorId, undefined, client);
  if (effective.has(CAPABILITIES.ADMIN_ALL)) return;
  for (const capability of capabilities) {
    if (!effective.has(capability)) {
      throw new ForbiddenError(message, { capability, reason: "capability_possession" });
    }
  }
}

/**
 * Capability-content guard (H8): independent of, and IN ADDITION TO,
 * requireRoleMutationAuthority's position-hierarchy check — both must pass.
 * An actor may only ALLOW or DENY a capability on someone else's role if they
 * themselves currently resolve that exact capability to true, UNLESS they
 * hold the wildcard. Holding PERMISSIONS_MANAGE alone does NOT exempt an
 * actor — only an actual '*' resolution does (see assertPossessesAll).
 *
 * Reading applied for "grant/revoke capabilities they possess": ALLOW and
 * DENY both count as an actor asserting a decision about that capability on
 * someone else's role, so both require possession. INHERIT removes an
 * explicit override and defers to the role chain instead of asserting
 * anything, so it is exempt from this check.
 */
export async function requireCapabilityPossessionForStateChange(
  client: RoleGraphClient,
  actorId: number,
  capabilities: { capability: string; state: "allow" | "deny" | "inherit" }[],
): Promise<void> {
  const toCheck = capabilities.filter((c) => c.state !== "inherit").map((c) => c.capability);
  await assertPossessesAll(
    client,
    actorId,
    toCheck,
    "You may only grant or deny a capability you currently possess yourself",
  );
}

/**
 * Capability-content guard for role assignment (H8): before assigning a role
 * to a user, an actor who doesn't hold the wildcard must already possess
 * every capability that role's OWN explicit ALLOW rows would grant (its
 * role_capabilities, not the assignee's resulting effective set through
 * other roles — a role's own explicit ALLOWs are what it contributes). A
 * role with no explicit ALLOWs (a pure INHERIT scaffold) trivially passes.
 * Independent of, and in addition to, requireRoleMutationAuthority.
 */
export async function requireCapabilityPossessionForAssignment(
  client: RoleGraphClient,
  actorId: number,
  roleId: number,
): Promise<void> {
  const { rows } = await client.query(
    `SELECT capability FROM role_capabilities WHERE role_id = $1 AND state = 'allow'`,
    [roleId],
  );
  await assertPossessesAll(
    client,
    actorId,
    (rows as { capability: string }[]).map((r) => r.capability),
    "You may only assign a role that grants capabilities you already possess yourself",
  );
}
