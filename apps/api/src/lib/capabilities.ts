import { ALL_CAPABILITIES, CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { pool, type Queryable } from "../db/pool.js";
import { BadRequestError, ForbiddenError, UnauthorizedError } from "./errors.js";

/**
 * Capability resolution (H8). Effective capabilities of a user =
 * capabilities of every group they belong to, expanded through nested
 * group includes (groups of groups). `*` grants everything.
 *
 * Authorization always reads PostgreSQL. A request-local promise prevents
 * repeated recursive queries by stacked preHandlers without leaving a stale
 * cross-request window after revocation (H8, H53).
 */
export async function getEffectiveCapabilities(
  userId: number,
  request?: FastifyRequest,
  db: Queryable = pool,
): Promise<Set<string>> {
  if (request?.effectiveCapabilities) return request.effectiveCapabilities;
  const resolve = async (): Promise<Set<string>> => {
    const result = await db.query(
      `WITH RECURSIVE user_groups AS (
       SELECT pgm.group_id
       FROM users u
       JOIN permission_group_members pgm ON pgm.user_id = u.id
       WHERE u.id = $1 AND u.account_state = 'active' AND u.anonymized_at IS NULL
       UNION
       SELECT gi.child_group_id
       FROM permission_group_includes gi
       JOIN user_groups ug ON ug.group_id = gi.parent_group_id
     )
     SELECT DISTINCT gc.capability
     FROM group_capabilities gc
     JOIN user_groups ug ON ug.group_id = gc.group_id`,
      [userId],
    );
    return new Set(result.rows.map((r: { capability: string }) => r.capability));
  };
  const capabilities = resolve();
  if (request) request.effectiveCapabilities = capabilities;
  return capabilities;
}

export async function userHasCapability(
  userId: number,
  capability: Capability,
  request?: FastifyRequest,
): Promise<boolean> {
  const caps = await getEffectiveCapabilities(userId, request);
  return caps.has(capability) || caps.has(CAPABILITIES.ADMIN_ALL);
}

/** Reject arbitrary persisted grants before they can reach PostgreSQL. */
export function assertKnownCapabilities(
  capabilities: readonly string[],
): asserts capabilities is Capability[] {
  const unknown = capabilities.filter(
    (capability) => !ALL_CAPABILITIES.includes(capability as Capability),
  );
  if (unknown.length > 0) {
    throw new BadRequestError("Unknown capability", { unknownCapabilities: unknown });
  }
}

/**
 * Compatibility no-ops for mutation callers. PostgreSQL is the authorization
 * source on every request, so committed revocations need no cache invalidation.
 */
export async function invalidateCapabilities(_userId: number): Promise<void> {}

export async function invalidateAllCapabilities(): Promise<void> {
  return;
}

/**
 * Route guard. Requires an authenticated session (request.userId, set by the
 * auth plugin) holding `capability`.
 */
export function requireCapability(capability: Capability): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (req.userId == null) throw new UnauthorizedError();
    if (!(await userHasCapability(req.userId, capability, req))) {
      throw new ForbiddenError(`Missing capability: ${capability}`, { capability });
    }
  };
}

/**
 * Route guard that passes if the caller holds ANY of the listed capabilities.
 * Used where an action is legitimately reachable from more than one role-view
 * (e.g. a judge-view action that operators can also perform).
 */
export function requireAnyCapability(...capabilities: Capability[]): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (req.userId == null) throw new UnauthorizedError();
    for (const cap of capabilities) {
      if (await userHasCapability(req.userId, cap, req)) return;
    }
    throw new ForbiddenError(`Missing one of capabilities: ${capabilities.join(", ")}`, {
      capabilities,
    });
  };
}

/** Shared assertion for composed pre-handlers that cannot invoke Fastify's
 * overloaded hook signature directly (for example, self-removal replay).
 */
export async function assertActiveAuthenticatedUser(req: FastifyRequest): Promise<void> {
  if (req.userId == null) throw new UnauthorizedError();
  const { rows } = await pool.query(
    `SELECT 1 FROM users WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
    [req.userId],
  );
  if (!rows[0]) throw new UnauthorizedError("This account is closed or being removed");
}

/** Guard that only requires a logged-in user (any capabilities). */
export const requireAuth: preHandlerHookHandler = async (req) => {
  await assertActiveAuthenticatedUser(req);
};
