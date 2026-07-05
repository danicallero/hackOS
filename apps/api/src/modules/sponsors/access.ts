import { CAPABILITIES } from "@hackos/shared/capabilities";
import { pool } from "../../db/pool.js";
import { userHasCapability } from "../../lib/capabilities.js";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../../lib/errors.js";

/** How a user was allowed to touch an enterprise. */
export type EnterpriseAccess = "admin" | "owner";

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
