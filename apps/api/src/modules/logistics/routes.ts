import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAnyCapability, requireCapability } from "../../lib/capabilities.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { subscribe } from "../../lib/sse.js";
import { checkIn, lookupByTicket, rotateBadge } from "./accreditation.js";
import {
  activityScan,
  bulkGrantConfirmed,
  grantEntitlement,
  revokeEntitlement,
} from "./activities.js";
import { enqueueMealScanBatch } from "./offline-meals.js";
import { allHours, occupancyEstimate, presenceScan, userHours } from "./presence.js";
import {
  activityIdParam,
  activityScanBody,
  appleDeviceParams,
  appleLogBody,
  applePassParams,
  appleRegistrationBody,
  appleRegistrationsQuery,
  checkInBody,
  entitlementUserParam,
  grantEntitlementBody,
  lookupBody,
  mealScanBatchBody,
  presenceScanBody,
  rotateBody,
  userIdParam,
  walletPurposeParam,
} from "./schemas.js";
import { logisticsStats } from "./stats.js";
import {
  appleChangedSerials,
  appleLog,
  buildApplePass,
  registerAppleDevice,
  unregisterAppleDevice,
} from "./wallet.js";

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
  const publicActivitySchema = z.object({
    id: z.number().int(),
    title: z.string(),
    description: z.string().nullable(),
    location: z.string().nullable(),
    type: z.string().nullable(),
    startsAt: z.string(),
    endsAt: z.string(),
    publishAt: z.string().nullable(),
  });

  const accredit = requireCapability(CAPABILITIES.ACCREDIT_SCAN);
  const presence = requireCapability(CAPABILITIES.PRESENCE_SCAN);
  const activity = requireCapability(CAPABILITIES.ACTIVITY_SCAN);
  const stats = requireCapability(CAPABILITIES.LOGISTICS_STATS);
  const scheduleManage = requireCapability(CAPABILITIES.SCHEDULE_MANAGE);
  const logisticsRead = requireAnyCapability(
    CAPABILITIES.ACCREDIT_SCAN,
    CAPABILITIES.PRESENCE_SCAN,
    CAPABILITIES.ACTIVITY_SCAN,
    CAPABILITIES.LOGISTICS_STATS,
    CAPABILITIES.SCHEDULE_MANAGE,
  );

  typed.get(
    "/api/public/activities",
    { schema: { response: { 200: z.object({ items: z.array(publicActivitySchema) }) } } },
    async () => {
      const { rows } = await pool.query(
        `SELECT id, title, description, location, type, starts_at, ends_at, publish_at
           FROM schedule
          WHERE visibility = 'shown'
            AND (publish_at IS NULL OR publish_at <= now())
          ORDER BY starts_at ASC, id ASC`,
      );
      return {
        items: rows.map((r: Record<string, unknown>) => ({
          id: Number(r.id),
          title: String(r.title),
          description: (r.description as string | null) ?? null,
          location: (r.location as string | null) ?? null,
          type: (r.type as string | null) ?? null,
          startsAt: (r.starts_at as Date).toISOString(),
          endsAt: (r.ends_at as Date).toISOString(),
          publishAt: r.publish_at instanceof Date ? r.publish_at.toISOString() : null,
        })),
      };
    },
  );

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
        scannedAt: req.body.scannedAt,
      });
      return reply.code(r.status).send(r.body);
    },
  );

  typed.post(
    "/api/activities/:id/meal-scans/batch",
    {
      preHandler: [activity, idempotencyGuard],
      schema: { params: activityIdParam, body: mealScanBatchBody },
    },
    async (req) =>
      enqueueMealScanBatch(actor(req.userId), req.params.id, {
        deviceId: req.body.deviceId,
        scans: req.body.scans,
      }),
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

  typed.get("/api/logistics/stream", { preHandler: logisticsRead }, async (_req, reply) => {
    await subscribe("logistics", reply);
  });

  // ── H28 Apple Wallet / PassKit ──────────────────────────────────────────

  typed.get(
    "/api/me/wallet/apple/:purpose.pkpass",
    { schema: { params: walletPurposeParam } },
    async (req, reply) => {
      const pass = await buildApplePass(actor(req.userId), req.params.purpose);
      return reply
        .type("application/vnd.apple.pkpass")
        .header("content-disposition", `attachment; filename="${req.params.purpose}.pkpass"`)
        .send(pass);
    },
  );

  typed.get(
    "/api/wallet/apple/v1/passes/:passTypeIdentifier/:serialNumber",
    { schema: { params: applePassParams } },
    async (req, reply) => {
      const pass = await buildApplePass(null, null, {
        passTypeIdentifier: req.params.passTypeIdentifier,
        serialNumber: req.params.serialNumber,
        authorization: req.headers.authorization,
      });
      return reply.type("application/vnd.apple.pkpass").send(pass);
    },
  );

  typed.post(
    "/api/wallet/apple/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber",
    { schema: { params: appleDeviceParams, body: appleRegistrationBody } },
    async (req, reply) => {
      const registered = await registerAppleDevice({
        ...req.params,
        authorization: req.headers.authorization,
        pushToken: req.body.pushToken,
      });
      return reply.code(registered ? 201 : 200).send({});
    },
  );

  typed.delete(
    "/api/wallet/apple/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber",
    { schema: { params: appleDeviceParams } },
    async (req, reply) => {
      await unregisterAppleDevice({ ...req.params, authorization: req.headers.authorization });
      return reply.code(200).send({});
    },
  );

  typed.get(
    "/api/wallet/apple/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier",
    {
      schema: {
        params: appleDeviceParams.omit({ serialNumber: true }),
        querystring: appleRegistrationsQuery,
      },
    },
    async (req, reply) => {
      const r = await appleChangedSerials({
        ...req.params,
        passesUpdatedSince: req.query.passesUpdatedSince,
      });
      if (r.serialNumbers.length === 0) return reply.code(204).send();
      return r;
    },
  );

  typed.post("/api/wallet/apple/v1/log", { schema: { body: appleLogBody } }, async (req) =>
    appleLog(req.body.logs),
  );
}
