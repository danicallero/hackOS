import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyRequest, preHandlerHookHandler } from "fastify";
import { pool } from "../../db/pool.js";
import { userHasCapability } from "../../lib/capabilities.js";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../../lib/errors.js";
import type {
  ContextualPolicyResolver,
  ContextualResourceLocator,
} from "../../lib/route-policy.js";

/** How a user was allowed to touch an enterprise. */
export type EnterpriseAccess = "admin" | "owner";

export interface EnterpriseResource {
  id: number;
}

const enterpriseAccesses = new WeakMap<FastifyRequest, EnterpriseAccess>();

function enterpriseIdFrom(request: FastifyRequest, locator: ContextualResourceLocator): number {
  const source = request[locator.source] as Record<string, unknown> | undefined;
  const value = source?.[locator.field];
  return Number(value);
}

/** True when `userId` holds a sponsor row on `enterpriseId`. */
export async function ownsEnterprise(userId: number, enterpriseId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM sponsors WHERE user_id = $1 AND enterprise_id = $2`,
    [userId, enterpriseId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * H43-H44: org admins (SPONSORS_MANAGE) manage every enterprise; linked sponsor
 * reps may edit the profile of the enterprise they belong to. The sponsor row
 * is the access grant; SPONSOR_PORTAL is not required for the rep themselves.
 * Returns how access was granted so the caller can restrict which fields an
 * owner (vs. an admin) is allowed to change.
 */
export async function assertCanEditEnterprise(
  userId: number | null,
  enterpriseId: number,
): Promise<EnterpriseAccess> {
  if (userId == null) throw new UnauthorizedError();
  const { rowCount: activeCount } = await pool.query(
    `SELECT 1 FROM users WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
    [userId],
  );
  if (!activeCount) throw new UnauthorizedError("This account is closed or being removed");
  const { rowCount } = await pool.query(`SELECT 1 FROM enterprises WHERE id = $1`, [enterpriseId]);
  if (rowCount === 0) throw new NotFoundError("Enterprise not found", { enterpriseId });

  if (await userHasCapability(userId, CAPABILITIES.SPONSORS_MANAGE)) return "admin";
  if (await ownsEnterprise(userId, enterpriseId)) return "owner";
  throw new ForbiddenError("Not allowed to edit this enterprise", { enterpriseId });
}

/**
 * DELTA(Hxx): the judge roster is enterprise-scoped, so managing it belongs to
 * a global queue/sponsor administrator or to the enterprise's own
 * representatives — never a room-level grant, and deliberately NOT open to the
 * roster judges themselves (a judge cannot recruit further judges).
 */
export function requireEnterpriseJudgeManager(
  locator: ContextualResourceLocator,
): preHandlerHookHandler {
  return async (request) => {
    const enterpriseId = enterpriseIdFrom(request, locator);
    const { rowCount } = await pool.query(`SELECT 1 FROM enterprises WHERE id = $1`, [
      enterpriseId,
    ]);
    if (rowCount === 0) throw new NotFoundError("Enterprise not found", { enterpriseId });
    await assertCanManageEnterpriseJudging(request, enterpriseId);
  };
}

/**
 * The grant behind {@link requireEnterpriseJudgeManager}, callable directly by
 * routes whose enterprise is derived from the row being written (a room's
 * queue_group) rather than named in params or body. Same rule, one place:
 * global queue/sponsor administrators, or the enterprise's own reps.
 */
export async function assertCanManageEnterpriseJudging(
  request: FastifyRequest,
  enterpriseId: number,
): Promise<void> {
  if (request.userId == null) throw new UnauthorizedError();
  const { rowCount: activeCount } = await pool.query(
    `SELECT 1 FROM users WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
    [request.userId],
  );
  if (!activeCount) throw new UnauthorizedError("This account is closed or being removed");
  if (await userHasCapability(request.userId, CAPABILITIES.QUEUE_ADMIN, request)) return;
  if (await userHasCapability(request.userId, CAPABILITIES.SPONSORS_MANAGE, request)) return;
  if (await ownsEnterprise(request.userId, enterpriseId)) return;
  throw new ForbiddenError("Not allowed to manage this enterprise's judging", { enterpriseId });
}

/** Shared H43/H44 enterprise resolver used by sponsor and challenge routes. */
export const enterpriseAccessPolicy: ContextualPolicyResolver<EnterpriseResource> = {
  name: "enterprise-access",
  async resolve(request, locator) {
    const id = enterpriseIdFrom(request, locator);
    const { rows } = await pool.query(`SELECT id FROM enterprises WHERE id = $1`, [id]);
    if (!rows[0]) throw new NotFoundError("Enterprise not found", { enterpriseId: id });
    return { id: Number(rows[0].id) };
  },
  async authorize(request, enterprise) {
    await assertCanEditEnterprise(request.userId, enterprise.id);
  },
};

/** Named reusable preHandler; route metadata names the matching policy. */
export function requireEnterpriseAccess(locator: ContextualResourceLocator): preHandlerHookHandler {
  return async (request) => {
    const enterprise = await enterpriseAccessPolicy.resolve(request, locator);
    enterpriseAccesses.set(request, await assertCanEditEnterprise(request.userId, enterprise.id));
  };
}

export function enterpriseAccessFor(request: FastifyRequest): EnterpriseAccess {
  const result = enterpriseAccesses.get(request);
  if (!result) throw new Error("Enterprise access missing: requireEnterpriseAccess must run first");
  return result;
}

/**
 * H58: the sponsor FAQ is sponsor-only, not public and not everyone with
 * SPONSORS_MANAGE-adjacent access (unlike challenge-directory in the
 * challenges module, judges are deliberately excluded here — this is
 * logistics for companies attending as sponsors, not for the judging pool).
 * Org admins (SPONSORS_MANAGE) can always read it too, since they're the ones
 * writing it.
 */
export const requireSponsorPortalAccess: preHandlerHookHandler = async (request) => {
  if (request.userId == null) throw new UnauthorizedError();
  const { rowCount: activeCount } = await pool.query(
    `SELECT 1 FROM users WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
    [request.userId],
  );
  if (!activeCount) throw new UnauthorizedError("This account is closed or being removed");
  if (await userHasCapability(request.userId, CAPABILITIES.SPONSORS_MANAGE)) return;
  const { rowCount } = await pool.query(`SELECT 1 FROM sponsors WHERE user_id = $1 LIMIT 1`, [
    request.userId,
  ]);
  if (!rowCount) throw new ForbiddenError("Not a sponsor representative");
};
