import {
  ALL_CAPABILITIES,
  CAPABILITIES,
  type Capability,
  closedEditionCapabilities,
} from "@hackos/shared/capabilities";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { pool, type Queryable } from "../db/pool.js";
import { GLOBAL_ADMIN_SQL } from "./edition.js";
import { BadRequestError, ForbiddenError, UnauthorizedError } from "./errors.js";
import { isSyntheticOperator } from "./fixture-subject-scope.js";
import { liveUserSql } from "./sql-predicates.js";

/**
 * The one authorization snapshot used by a request or transaction (H8, #714).
 * `db` is explicit so transaction-local authorization cannot accidentally read
 * through the pool, and the lazy promise avoids a capability query on public
 * routes that never make a capability decision.
 */
export interface AuthorizationContext {
  readonly userId: number | null;
  readonly db: Queryable;
  readonly effectiveCapabilities: Promise<ReadonlySet<string>>;
  /**
   * The actor's synthetic-operator marker (`users.is_test_account`), read at
   * most once per context. Request-scoped like `effectiveCapabilities`, so
   * stacked guards and the handler share one read instead of one per assert.
   */
  readonly actorIsSyntheticOperator: Promise<boolean>;
}

/**
 * Capabilities come from the user's roles in the scoped edition
 * (`current_edition()`: the X-Edition header or the current edition) plus
 * protected global roles (system:superadmin). In a closed edition the edition
 * roles keep only their read capabilities; a global superadmin keeps all.
 */
function resolveCapabilities(userId: number | null, db: Queryable): Promise<ReadonlySet<string>> {
  if (userId == null) return Promise.resolve(new Set<string>());
  return db
    .query<{ capabilities: string[]; edition_status: string | null; global_admin: boolean }>(
      `SELECT ARRAY(SELECT uec.capability FROM user_effective_capabilities uec
                     WHERE uec.user_id = u.id) AS capabilities,
              (SELECT status FROM editions WHERE event_key = current_edition()) AS edition_status,
              ${GLOBAL_ADMIN_SQL} AS global_admin
         FROM users u
        WHERE u.id = $1 AND ${liveUserSql("u")}`,
      [userId],
    )
    .then((result) => {
      const row = result.rows[0];
      if (!row) return new Set<string>();
      if (row.edition_status === "closed" && !row.global_admin) {
        return closedEditionCapabilities(row.capabilities);
      }
      return new Set(row.capabilities);
    });
}

function resolveSyntheticOperator(userId: number | null, db: Queryable): Promise<boolean> {
  if (userId == null) return Promise.resolve(false);
  return isSyntheticOperator(db, userId);
}

/** Create an explicit request or transaction authorization context (H8, #714). */
export function createAuthorizationContext(
  userId: number | null,
  db: Queryable = pool,
): AuthorizationContext {
  let effectiveCapabilities: Promise<ReadonlySet<string>> | undefined;
  let actorIsSyntheticOperator: Promise<boolean> | undefined;
  return {
    userId,
    db,
    get effectiveCapabilities() {
      effectiveCapabilities ??= resolveCapabilities(userId, db);
      return effectiveCapabilities;
    },
    get actorIsSyntheticOperator() {
      actorIsSyntheticOperator ??= resolveSyntheticOperator(userId, db);
      return actorIsSyntheticOperator;
    },
  };
}

/** Return the context installed by auth-context.ts; never invent a pool-backed one mid-request. */
export function getRequestAuthorizationContext(req: FastifyRequest): AuthorizationContext {
  const context = req.authorizationContext;
  if (!context) throw new Error("Request authorization context is not initialized");
  return context;
}

/**
 * Effective capabilities for a context (H8). The resolution rule (position-ordered
 * ALLOW/DENY/INHERIT chain over the user's own roles, deny-by-default, `*` meaning
 * every capability) lives in the `user_effective_capabilities` view. Always read
 * from PostgreSQL; the context's lazy promise only dedupes stacked preHandlers (#714).
 */
export async function getEffectiveCapabilities(
  context: AuthorizationContext,
): Promise<ReadonlySet<string>> {
  return context.effectiveCapabilities;
}

export async function userHasCapability(
  context: AuthorizationContext,
  capability: Capability,
): Promise<boolean> {
  const caps = await getEffectiveCapabilities(context);
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
 * Route guard. Requires an authenticated session (request.userId, set by the
 * auth plugin) holding `capability`.
 */
export function requireCapability(capability: Capability): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (req.userId == null) throw new UnauthorizedError();
    if (!(await userHasCapability(getRequestAuthorizationContext(req), capability))) {
      throw new ForbiddenError(`Missing capability: ${capability}`, { capability });
    }
  };
}

export async function userHasAnyCapability(
  context: Parameters<typeof userHasCapability>[0],
  capabilities: readonly Capability[],
): Promise<boolean> {
  for (const capability of capabilities) {
    if (await userHasCapability(context, capability)) return true;
  }
  return false;
}

/**
 * Route guard that passes if the caller holds ANY of the listed capabilities.
 * Used where an action is legitimately reachable from more than one role-view
 * (e.g. a judge-view action that operators can also perform).
 */
export function requireAnyCapability(...capabilities: Capability[]): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (req.userId == null) throw new UnauthorizedError();
    if (await userHasAnyCapability(getRequestAuthorizationContext(req), capabilities)) return;
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
    `SELECT 1 FROM users u WHERE u.id = $1 AND ${liveUserSql("u")}`,
    [req.userId],
  );
  if (!rows[0]) throw new UnauthorizedError("This account is closed or being removed");
}

/**
 * Profile recovery guard: the pending-exit screen is the only authenticated
 * surface a removal-pending account can use before the finalizer deletes it.
 * Every event operation continues to use assertActiveAuthenticatedUser or a
 * capability guard, so this intentionally does not grant event access.
 */
export async function assertAuthenticatedProfileUser(req: FastifyRequest): Promise<void> {
  if (req.userId == null) throw new UnauthorizedError();
  const { rows } = await pool.query(
    `SELECT 1
       FROM users
      WHERE id = $1
        AND account_state IN ('active', 'removal_pending')
        AND anonymized_at IS NULL`,
    [req.userId],
  );
  if (!rows[0]) throw new UnauthorizedError("This account is closed or being removed");
}

/** Guard that only requires a logged-in user (any capabilities). */
export const requireAuth: preHandlerHookHandler = async (req) => {
  await assertActiveAuthenticatedUser(req);
};
