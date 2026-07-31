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
  const { rowCount } = await pool.query(`SELECT 1 FROM enterprises WHERE id = $1`, [enterpriseId]);
  if (rowCount === 0) throw new NotFoundError("Enterprise not found", { enterpriseId });

  if (await userHasCapability(userId, CAPABILITIES.SPONSORS_MANAGE)) return "admin";
  if (await ownsEnterprise(userId, enterpriseId)) return "owner";
  throw new ForbiddenError("Not allowed to edit this enterprise", { enterpriseId });
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
