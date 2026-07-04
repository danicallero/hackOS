import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireCapability } from "../../lib/capabilities.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { checkIn, lookupByTicket, rotateBadge } from "./accreditation.js";
import {
  activityScan,
  bulkGrantConfirmed,
  grantEntitlement,
  revokeEntitlement,
} from "./activities.js";
import { allHours, occupancyEstimate, presenceScan, userHours } from "./presence.js";
import {
  activityIdParam,
  activityScanBody,
  checkInBody,
  entitlementUserParam,
  grantEntitlementBody,
  lookupBody,
  presenceScanBody,
  rotateBody,
  userIdParam,
} from "./schemas.js";
import { logisticsStats } from "./stats.js";

function actor(userId: number | null): number {
  if (userId == null) throw new UnauthorizedError();
  return userId;
}

/**
 * WS-C — accreditation, presence, meals/activities and logistics stats
 * (H22-H27). All scanner mutations carry `idempotencyGuard` so the
 * offline-first apps can retry safely; the server confirmation is the source
 * of truth (H22). Guards are by capability, never role (H8).
 */
export function registerLogisticsRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const accredit = requireCapability(CAPABILITIES.ACCREDIT_SCAN);
  const presence = requireCapability(CAPABILITIES.PRESENCE_SCAN);
  const activity = requireCapability(CAPABILITIES.ACTIVITY_SCAN);
  const stats = requireCapability(CAPABILITIES.LOGISTICS_STATS);
  const scheduleManage = requireCapability(CAPABILITIES.SCHEDULE_MANAGE);

  // ── H22 accreditation ────────────────────────────────────────────────────

  typed.post(
    "/api/accreditation/lookup",
    { preHandler: accredit, schema: { body: lookupBody } },
    async (req) => lookupByTicket(req.body.ticketToken),
  );

  typed.post(
    "/api/accreditation/check-in",
    { preHandler: [accredit, idempotencyGuard], schema: { body: checkInBody } },
    async (req) =>
      checkIn(actor(req.userId), {
        ticketToken: req.body.ticketToken,
        badgeId: req.body.badgeId,
        method: req.body.method,
      }),
  );

  // ── H23 badge rotation ───────────────────────────────────────────────────

  typed.post(
    "/api/accreditation/rotate",
    { preHandler: [accredit, idempotencyGuard], schema: { body: rotateBody } },
    async (req) =>
      rotateBadge(actor(req.userId), {
        userId: req.body.userId,
        currentBadgeId: req.body.currentBadgeId,
        newBadgeId: req.body.newBadgeId,
        reason: req.body.reason,
      }),
  );

  // ── H24 presence ─────────────────────────────────────────────────────────

  typed.post(
    "/api/presence/scan",
    { preHandler: [presence, idempotencyGuard], schema: { body: presenceScanBody } },
    async (req) =>
      presenceScan(actor(req.userId), {
        badgeId: req.body.badgeId,
        kind: req.body.kind,
        location: req.body.location,
        scannedAt: req.body.scannedAt,
      }),
  );

  typed.get("/api/presence/estimate", { preHandler: stats }, async () => occupancyEstimate());

  typed.get("/api/presence/hours", { preHandler: stats }, async () => allHours());

  typed.get(
    "/api/presence/hours/:userId",
    { preHandler: stats, schema: { params: userIdParam } },
    async (req) => userHours(req.params.userId),
  );

  // ── H25 meals / H26 activities ───────────────────────────────────────────

  typed.post(
    "/api/activities/:id/scan",
    {
      preHandler: [activity, idempotencyGuard],
      schema: { params: activityIdParam, body: activityScanBody },
    },
    async (req, reply) => {
      const r = await activityScan(actor(req.userId), req.params.id, {
        badgeId: req.body.badgeId,
        allowRepeat: req.body.allowRepeat,
      });
      return reply.code(r.status).send(r.body);
    },
  );

  // Entitlement admin (SCHEDULE_MANAGE — activities admin lives in the schedule WS).
  typed.post(
    "/api/activities/:id/entitlements",
    { preHandler: scheduleManage, schema: { params: activityIdParam, body: grantEntitlementBody } },
    async (req) => grantEntitlement(actor(req.userId), req.params.id, req.body.userId),
  );

  typed.delete(
    "/api/activities/:id/entitlements/:userId",
    { preHandler: scheduleManage, schema: { params: entitlementUserParam } },
    async (req) => revokeEntitlement(actor(req.userId), req.params.id, req.params.userId),
  );

  typed.post(
    "/api/activities/:id/entitlements/bulk-grant-confirmed",
    { preHandler: scheduleManage, schema: { params: activityIdParam } },
    async (req) => bulkGrantConfirmed(actor(req.userId), req.params.id),
  );

  // ── H27 stats ────────────────────────────────────────────────────────────

  typed.get("/api/logistics/stats", { preHandler: stats }, async () => logisticsStats());
}
