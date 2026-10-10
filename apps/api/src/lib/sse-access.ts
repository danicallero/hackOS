import { CAPABILITIES } from "@hackos/shared/capabilities";
import { SSE_TOPICS } from "@hackos/shared/events";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { hasEventAccess } from "../modules/identity/role.js";
import { type AuthorizationContext, userHasCapability } from "./capabilities.js";
import { ForbiddenError, UnauthorizedError } from "./errors.js";

export const scopedRefreshTopic = z.enum([
  SSE_TOPICS.APPLICATIONS,
  SSE_TOPICS.PROJECTS,
  SSE_TOPICS.IDENTITY,
  SSE_TOPICS.SPONSORS,
  SSE_TOPICS.LOGISTICS,
  SSE_TOPICS.AUDIT,
  SSE_TOPICS.TV,
  SSE_TOPICS.DIRECTORY,
]);

const logisticsRefreshCapabilities = [
  CAPABILITIES.ACCREDIT_SCAN,
  CAPABILITIES.PRESENCE_SCAN,
  CAPABILITIES.ACTIVITY_SCAN,
  CAPABILITIES.LOGISTICS_STATS,
  CAPABILITIES.INTOLERANCES_MANAGE,
  CAPABILITIES.SCHEDULE_MANAGE,
] as const;

export async function requireScopedRefreshAccess(
  userId: number | null,
  topic: z.infer<typeof scopedRefreshTopic>,
  context: AuthorizationContext,
): Promise<void> {
  if (userId == null) throw new UnauthorizedError();
  if (topic === SSE_TOPICS.AUDIT) {
    if (!(await userHasCapability(context, CAPABILITIES.AUDIT_READ))) {
      throw new ForbiddenError(`Missing capability: ${CAPABILITIES.AUDIT_READ}`, {
        capability: CAPABILITIES.AUDIT_READ,
      });
    }
    return;
  }
  if (topic === SSE_TOPICS.TV) {
    if (!(await userHasCapability(context, CAPABILITIES.TV_CONTROL))) {
      throw new ForbiddenError(`Missing capability: ${CAPABILITIES.TV_CONTROL}`, {
        capability: CAPABILITIES.TV_CONTROL,
      });
    }
    return;
  }
  if (topic === SSE_TOPICS.DIRECTORY) {
    // The signal is payload-free. Event attendees without directory:read
    // (Sponsor, Judging Team) still own a public profile and its preview
    // (#934), so event access is enough to subscribe.
    if (
      !(await userHasCapability(context, CAPABILITIES.DIRECTORY_READ)) &&
      !(await hasEventAccess(pool, userId))
    ) {
      throw new ForbiddenError(`Missing capability: ${CAPABILITIES.DIRECTORY_READ}`, {
        capability: CAPABILITIES.DIRECTORY_READ,
      });
    }
    return;
  }
  if (topic !== SSE_TOPICS.LOGISTICS) return;
  for (const capability of logisticsRefreshCapabilities) {
    if (await userHasCapability(context, capability)) return;
  }
  throw new ForbiddenError("Missing logistics read capability", {
    capabilities: logisticsRefreshCapabilities,
  });
}
