import type { Queryable } from "../../db/pool.js";
import { hasEventAccess } from "./role.js";

/**
 * Mobile is an event-day surface, not an alternate application portal. The
 * same role-derived event entitlement that issues an entrance ticket gates
 * the app, so changing roles updates both surfaces together without a second
 * eligibility policy.
 */
export async function hasMobileAccess(db: Queryable, userId: number): Promise<boolean> {
  return hasEventAccess(db, userId);
}
