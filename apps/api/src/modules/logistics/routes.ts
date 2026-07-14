import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAnyCapability, requireAuth, requireCapability } from "../../lib/capabilities.js";
import { NotFoundError, UnauthorizedError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { subscribe } from "../../lib/sse.js";
import {
  checkIn,
  checkInUser,
  lookupByTicket,
  lookupByUserId,
  rotateBadge,
} from "./accreditation.js";
import {
  activityScan,
  bulkGrantConfirmed,
  grantEntitlement,
  revokeEntitlement,
} from "./activities.js";
import { buildGoogleSaveUrl } from "./google-wallet.js";
import { enqueueMealScanBatch } from "./offline-meals.js";
import { searchPeople } from "./people.js";
import {
  allHours,
  deleteTimeLog,
  listTimeLogs,
  occupancyEstimate,
  openSessions,
  presenceLookup,
  presenceScan,
  updateTimeLog,
  userHours,
} from "./presence.js";
import {
  createScheduleItem,
  deleteScheduleItem,
  listSchedule,
  setScheduleVisibility,
  updateScheduleItem,
} from "./schedule.js";
import {
  activityIdParam,
  activityScanBody,
  appleDeviceParams,
  appleLogBody,
  applePassParams,
  appleRegistrationBody,
  appleRegistrationsQuery,
  checkInBody,
  checkInUserBody,
  entitlementUserParam,
  grantEntitlementBody,
  lookupBody,
  lookupUserBody,
  mealScanBatchBody,
  personSearchBody,
  presenceLookupBody,
  presenceScanBody,
  rotateBody,
  scannableActivitiesQuery,
  scheduleBody,
  scheduleIdParam,
  schedulePatchBody,
  scheduleVisibilityBody,
  timeLogIdParam,
  timeLogPatchBody,
  userIdParam,
  walletPurposeParam,
} from "./schemas.js";
import { logisticsStats, scannableActivities } from "./stats.js";
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
  // Read guards let a station load its own data without the stats capability:
  // a door operator (PRESENCE_SCAN) sees occupancy/hours; a meal/activity
  // operator (ACTIVITY_SCAN) can list scannable activities with live counts.
  const presenceRead = requireAnyCapability(
    CAPABILITIES.PRESENCE_SCAN,
    CAPABILITIES.LOGISTICS_STATS,
  );
  const scanRead = requireAnyCapability(CAPABILITIES.ACTIVITY_SCAN, CAPABILITIES.LOGISTICS_STATS);
  const ticketRead = requireAnyCapability(CAPABILITIES.USERS_READ, CAPABILITIES.ACCREDIT_SCAN);
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

  // ── unified person lookup (any logistics station) ────────────────────────

  typed.post(
    "/api/logistics/people/search",
    {
      preHandler: logisticsRead,
      schema: {
        body: personSearchBody,
        description:
          "Unified person lookup for logistics stations (H22-H27). Every comparison is case-insensitive, and the fuzzy tier is also accent-insensitive ('perez' finds 'Pérez'). `q` is resolved as: an exact ticket token, then someone's CURRENT badge id (a rotated-away badge never shadows the current holder), then a rotated-away badge (matchedBy `badge_history`), then a name / surname / 'name surname' / 'surname name' / email substring. Exact identifier hits return exactly one person; the fuzzy fallback returns up to 10. `fields` whitelists which extra user fields come back (email, badgeId, dni, phone, shirtSize, notes, confirmed); defaults to email + badgeId + confirmed. Read-only; any logistics capability grants access.",
      },
    },
    async (req) => ({ results: await searchPeople(req.body.q, req.body.fields) }),
  );

  // ── H22 accreditation ────────────────────────────────────────────────────

  typed.post(
    "/api/accreditation/lookup",
    {
      preHandler: accredit,
      schema: {
        body: lookupBody,
        description:
          "Resolve an entrance-ticket QR token to the full person card staff needs to accredit (H22): identity fields (name, DNI, email, shirt size), intolerances, notes, confirmed-spot flag and current badge if already accredited. Read-only.",
      },
    },
    async (req) => lookupByTicket(req.body.ticketToken),
  );

  typed.post(
    "/api/accreditation/lookup-user",
    {
      preHandler: accredit,
      schema: {
        body: lookupUserBody,
        description:
          "Same person card as /api/accreditation/lookup but keyed by user id — used after a search hit or a deep link from the user profile (H22). Read-only.",
      },
    },
    async (req) => lookupByUserId(req.body.userId),
  );

  typed.post(
    "/api/accreditation/check-in",
    {
      preHandler: [accredit, idempotencyGuard],
      schema: {
        body: checkInBody,
        description:
          "Assign a badge to the ticket's owner and log the check-in (H22). Idempotency-key replays are safe; 409 if the badge belongs to someone else or the person is already accredited (use /api/accreditation/rotate to replace a badge).",
      },
    },
    async (req) =>
      checkIn(actor(req.userId), {
        ticketToken: req.body.ticketToken,
        badgeId: req.body.badgeId,
        method: req.body.method,
      }),
  );

  typed.post(
    "/api/accreditation/check-in-user",
    {
      preHandler: [accredit, idempotencyGuard],
      schema: {
        body: checkInUserBody,
        description:
          "Same as /api/accreditation/check-in but keyed by user id instead of ticket token (H22) — the person-centric flow after a search hit. Same conflict rules.",
      },
    },
    async (req) =>
      checkInUser(actor(req.userId), {
        userId: req.body.userId,
        badgeId: req.body.badgeId,
        method: req.body.method,
      }),
  );

  // ── H23 badge rotation ───────────────────────────────────────────────────

  typed.post(
    "/api/accreditation/rotate",
    {
      preHandler: [accredit, idempotencyGuard],
      schema: {
        body: rotateBody,
        description:
          "Replace someone's badge (H23): identify the person by userId (preferred) or by their current badge id. The old badge is revoked everywhere, wallet badge passes are voided, and the change is audited with the given reason. 409 if the new badge is already assigned.",
      },
    },
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
    "/api/presence/lookup",
    { preHandler: presence, schema: { body: presenceLookupBody } },
    async (req) => presenceLookup(req.body.badgeId),
  );

  typed.post(
    "/api/presence/scan",
    { preHandler: [presence, idempotencyGuard], schema: { body: presenceScanBody } },
    async (req) =>
      presenceScan(actor(req.userId), {
        badgeId: req.body.badgeId,
        kind: req.body.kind,
        scannedAt: req.body.scannedAt,
      }),
  );

  typed.get("/api/presence/estimate", { preHandler: presenceRead }, async () =>
    occupancyEstimate(),
  );

  typed.get("/api/presence/hours", { preHandler: presenceRead }, async () => allHours());

  // Staff reconciliation queue: open sessions, stale ones flagged (H24).
  typed.get("/api/presence/open", { preHandler: presenceRead }, async () => ({
    items: await openSessions(),
  }));

  typed.get(
    "/api/presence/hours/:userId",
    { preHandler: presenceRead, schema: { params: userIdParam } },
    async (req) => userHours(req.params.userId),
  );

  // Raw scan admin — view/correct individual door scans (H24 usability).
  typed.get(
    "/api/presence/logs/:userId",
    { preHandler: presenceRead, schema: { params: userIdParam } },
    async (req) => ({ items: await listTimeLogs(req.params.userId) }),
  );

  typed.patch(
    "/api/presence/logs/:id",
    { preHandler: presence, schema: { params: timeLogIdParam, body: timeLogPatchBody } },
    async (req) =>
      updateTimeLog(actor(req.userId), req.params.id, {
        kind: req.body.kind,
        scannedAt: req.body.scannedAt,
      }),
  );

  typed.delete(
    "/api/presence/logs/:id",
    { preHandler: presence, schema: { params: timeLogIdParam } },
    async (req) => deleteTimeLog(actor(req.userId), req.params.id),
  );

  // ── H25 meals / H26 activities ───────────────────────────────────────────

  // Scannable activities with live counts — powers the meal/activity station
  // pickers and their inline stats (available to scan operators, not just
  // LOGISTICS_STATS). Fixes the scanner that used to require the stats panel.
  typed.get(
    "/api/activities/scannable",
    { preHandler: scanRead, schema: { querystring: scannableActivitiesQuery } },
    async (req) => ({ items: await scannableActivities(req.query.category) }),
  );

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

  // ── Schedule CRUD ───────────────────────────────────────────────────────

  typed.get("/api/schedule", { preHandler: scheduleManage }, async () => listSchedule());

  typed.post(
    "/api/schedule",
    { preHandler: scheduleManage, schema: { body: scheduleBody } },
    async (req, reply) =>
      reply.code(201).send(
        await createScheduleItem(actor(req.userId), {
          title: req.body.title,
          description: req.body.description ?? null,
          location: req.body.location ?? null,
          type: req.body.type ?? null,
          requiresScan: req.body.requiresScan,
          startsAt: req.body.startsAt,
          endsAt: req.body.endsAt,
          visibility: req.body.visibility,
          publishAt: req.body.publishAt ?? null,
        }),
      ),
  );

  typed.patch(
    "/api/schedule/:id",
    { preHandler: scheduleManage, schema: { params: scheduleIdParam, body: schedulePatchBody } },
    async (req) =>
      updateScheduleItem(actor(req.userId), req.params.id, {
        title: req.body.title,
        description: req.body.description,
        location: req.body.location,
        type: req.body.type,
        requiresScan: req.body.requiresScan,
        startsAt: req.body.startsAt,
        endsAt: req.body.endsAt,
        visibility: req.body.visibility,
        publishAt: req.body.publishAt,
      }),
  );

  typed.delete(
    "/api/schedule/:id",
    { preHandler: scheduleManage, schema: { params: scheduleIdParam } },
    async (req) => deleteScheduleItem(actor(req.userId), req.params.id),
  );

  typed.post(
    "/api/schedule/visibility",
    { preHandler: scheduleManage, schema: { body: scheduleVisibilityBody } },
    async (req) => setScheduleVisibility(actor(req.userId), req.body.ids, req.body.visibility),
  );

  typed.get("/api/me/ticket", { preHandler: requireAuth }, async (req) =>
    ticketQrPayload(actor(req.userId)),
  );

  typed.get(
    "/api/users/:userId/ticket",
    { preHandler: ticketRead, schema: { params: userIdParam } },
    async (req) => ticketQrPayload(req.params.userId),
  );

  // ── H28 Apple Wallet / PassKit ──────────────────────────────────────────

  typed.get(
    "/api/me/wallet/apple/:purpose.pkpass",
    { schema: { params: walletPurposeParam } },
    async (req, reply) => {
      const { pkpass } = await buildApplePass(actor(req.userId), req.params.purpose);
      return reply
        .type("application/vnd.apple.pkpass")
        .header("content-disposition", `attachment; filename="${req.params.purpose}.pkpass"`)
        .send(pkpass);
    },
  );

  typed.get(
    "/api/wallet/apple/v1/passes/:passTypeIdentifier/:serialNumber",
    { schema: { params: applePassParams } },
    async (req, reply) => {
      const { pkpass, modifiedAt } = await buildApplePass(null, null, {
        passTypeIdentifier: req.params.passTypeIdentifier,
        serialNumber: req.params.serialNumber,
        authorization: req.headers.authorization,
      });
      // PassKit's update protocol: echo back Last-Modified and answer 304
      // when the pass hasn't changed since the device's copy (HTTP dates
      // have second precision, hence the flooring).
      const ifModifiedSince = Date.parse(String(req.headers["if-modified-since"] ?? ""));
      if (
        Number.isFinite(ifModifiedSince) &&
        Math.floor(modifiedAt.getTime() / 1000) <= Math.floor(ifModifiedSince / 1000)
      ) {
        return reply.code(304).send();
      }
      return reply
        .type("application/vnd.apple.pkpass")
        .header("last-modified", modifiedAt.toUTCString())
        .send(pkpass);
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

  // ── H28 Google Wallet ────────────────────────────────────────────────────

  typed.get(
    "/api/me/wallet/google/:purpose",
    { schema: { params: walletPurposeParam } },
    async (req) => ({ saveUrl: await buildGoogleSaveUrl(actor(req.userId), req.params.purpose) }),
  );
}

async function ticketQrPayload(userId: number) {
  const { rows } = await pool.query(
    `SELECT u.id, u.badge_id, t.token
       FROM users u
       LEFT JOIN tickets t ON t.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw new NotFoundError("User not found");
  return {
    userId: row.id as number,
    ticketToken: (row.token as string | null) ?? null,
    badgeId: (row.badge_id as string | null) ?? null,
  };
}
