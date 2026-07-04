import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { pool } from "../db/pool.js";
import { ForbiddenError, UnauthorizedError } from "./errors.js";
import { valkey } from "./valkey.js";

/**
 * Capability resolution (H8). Effective capabilities of a user =
 * capabilities of every group they belong to, expanded through nested
 * group includes (groups of groups). `*` grants everything.
 *
 * Cached in Valkey for CACHE_TTL_S; permission mutations must call
 * `invalidateCapabilities(userId)` (or `invalidateAllCapabilities()` when a
 * group definition changes) so revocation takes effect immediately (plan/07:
 * permission checks live at the boundary, by capability, never by role).
 */

const CACHE_TTL_S = 30;
const cacheKey = (userId: number) => `caps:${userId}`;

export async function getEffectiveCapabilities(userId: number): Promise<Set<string>> {
  const cached = await valkey.get(cacheKey(userId));
  if (cached) return new Set(JSON.parse(cached) as string[]);

  const result = await pool.query(
    `WITH RECURSIVE user_groups AS (
       SELECT group_id FROM permission_group_members WHERE user_id = $1
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
  const caps = result.rows.map((r: { capability: string }) => r.capability);
  await valkey.set(cacheKey(userId), JSON.stringify(caps), "EX", CACHE_TTL_S);
  return new Set(caps);
}

export async function userHasCapability(userId: number, capability: Capability): Promise<boolean> {
  const caps = await getEffectiveCapabilities(userId);
  return caps.has(capability) || caps.has(CAPABILITIES.ADMIN_ALL);
}

export async function invalidateCapabilities(userId: number): Promise<void> {
  await valkey.del(cacheKey(userId));
}

/** Group definitions changed (capabilities or includes): flush every entry. */
export async function invalidateAllCapabilities(): Promise<void> {
  const keys = await valkey.keys("caps:*");
  if (keys.length) await valkey.del(...keys);
}

/**
 * Route guard. Requires an authenticated session (request.userId, set by the
 * auth plugin) holding `capability`.
 */
export function requireCapability(capability: Capability): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (req.userId == null) throw new UnauthorizedError();
    if (!(await userHasCapability(req.userId, capability))) {
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
      if (await userHasCapability(req.userId, cap)) return;
    }
    throw new ForbiddenError(`Missing one of capabilities: ${capabilities.join(", ")}`, {
      capabilities,
    });
  };
}

/** Guard that only requires a logged-in user (any capabilities). */
export const requireAuth: preHandlerHookHandler = async (req) => {
  if (req.userId == null) throw new UnauthorizedError();
};
