import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import {
  requireAnyCapability,
  requireAuth,
  requireCapability,
  userHasCapability,
} from "../../lib/capabilities.js";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import type { RouteAccessPolicy } from "../../lib/route-policy.js";
import { subscribe } from "../../lib/sse.js";
import {
  checkIn,
  checkInUser,
  lookupByTicket,
  lookupByUserId,
  removeBadge,
  rotateBadge,
} from "./accreditation.js";
import { activityScan } from "./activities.js";
import { buildGoogleSaveUrl } from "./google-wallet.js";
import { enqueueMealScanBatch } from "./offline-meals.js";
import { searchPeople } from "./people.js";
import {
  allHours,
  createPresenceSignal,
  deletePresenceActivity,
  deleteTimeLog,
  listTimeLogs,
  occupancyEstimate,
  openSessions,
  presenceLookup,
  presenceScan,
  presenceTimeline,
  updatePresenceActivity,
  updateTimeLog,
  userHours,
} from "./presence.js";
import { queryScanLog, staffScanCounts, staffScanRanking } from "./scan-log.js";
import { scannerSnapshot } from "./scanner-sync.js";
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
  lookupBody,
  lookupUserBody,
  mealScanBatchBody,
  personSearchBody,
  presenceActivityPatchBody,
  presenceLookupBody,
  presenceScanBody,
  presenceSignalBody,
  removeBadgeBody,
  rotateBody,
  scanLogQuery,
  scanLogResponse,
  scannableActivitiesQuery,
  scannerSnapshotResponse,
  scheduleBody,
  scheduleIdParam,
  schedulePatchBody,
  scheduleVisibilityBody,
  staffScanRankingResponse,
  staffScanStatsResponse,
  timeLogIdParam,
  timeLogPatchBody,
  userIdParam,
  walletAccessQuery,
  walletPurposeParam,
} from "./schemas.js";
import { accreditationCountsByRole, logisticsStats, scannableActivities } from "./stats.js";
import {
  appleChangedSerials,
  appleLog,
  buildApplePass,
  registerAppleDevice,
  requireAppleWebServiceToken,
  unregisterAppleDevice,
} from "./wallet.js";
import { resolveWalletAccessToken } from "./wallet-access.js";

function actor(userId: number | null): number {
  if (userId == null) throw new UnauthorizedError();
  return userId;
}

function routeAccess(routeAccessPolicy: RouteAccessPolicy) {
  return { config: { routeAccessPolicy } };
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
  const access = {
    authenticated: { kind: "authenticated" } as const,
    publicContent: { kind: "public", anonymousCategory: "public-content" } as const,
    applePasskit: { kind: "token", policy: "apple-passkit-web-service" } as const,
    scopedWallet: { kind: "token", policy: "scoped-wallet-access" } as const,
    accredit: { kind: "capability", capability: CAPABILITIES.ACCREDIT_SCAN } as const,
    presence: { kind: "capability", capability: CAPABILITIES.PRESENCE_SCAN } as const,
    activity: { kind: "capability", capability: CAPABILITIES.ACTIVITY_SCAN } as const,
    stats: { kind: "capability", capability: CAPABILITIES.LOGISTICS_STATS } as const,
    scheduleManage: { kind: "capability", capability: CAPABILITIES.SCHEDULE_MANAGE } as const,
    presenceRead: {
      kind: "capability",
      anyOf: [CAPABILITIES.PRESENCE_SCAN, CAPABILITIES.LOGISTICS_STATS],
    } as const,
    scanRead: {
      kind: "capability",
      anyOf: [CAPABILITIES.ACTIVITY_SCAN, CAPABILITIES.LOGISTICS_STATS],
    } as const,
    ticketRead: {
      kind: "capability",
      anyOf: [CAPABILITIES.USERS_READ, CAPABILITIES.ACCREDIT_SCAN],
    } as const,
    logisticsRead: {
      kind: "capability",
      anyOf: [
        CAPABILITIES.ACCREDIT_SCAN,
        CAPABILITIES.PRESENCE_SCAN,
        CAPABILITIES.ACTIVITY_SCAN,
        CAPABILITIES.LOGISTICS_STATS,
        CAPABILITIES.SCHEDULE_MANAGE,
      ],
    } as const,
  } satisfies Record<string, RouteAccessPolicy>;

  // Full replace-all seed for the native SQLite scanners. Each successful
  // refresh also distributes the complete revoked-badge set (H23).
  typed.get(
    "/api/scanner/snapshot",
    {
      ...routeAccess(access.logisticsRead),
      preHandler: logisticsRead,
      schema: {
        summary: "Synchronize native scanner data",
        description:
          "Returns the lightweight people, current/revoked badge, activity, and scan-count snapshot used by offline native scanners. A successful response replaces the local snapshot; queued mutations remain separate and replay with idempotency keys. Anonymized accounts (H54) are excluded from `people`.",
        response: { 200: scannerSnapshotResponse },
      },
    },
    scannerSnapshot,
  );

  typed.get(
    "/api/public/activities",
    {
      ...routeAccess(access.publicContent),
      schema: {
        summary: "Published public schedule",
        description:
          "Anonymous H47/H48 schedule feed. It contains only items currently visible in the public programme; drafts and scheduled future items are omitted.",
        response: { 200: z.object({ items: z.array(publicActivitySchema) }) },
      },
    },
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

  typed.get(
    "/api/accreditation/stats",
    { ...routeAccess(access.accredit), preHandler: accredit },
    async () => ({
      byRole: await accreditationCountsByRole(),
    }),
  );

  typed.post(
    "/api/logistics/people/search",
    {
      ...routeAccess(access.logisticsRead),
      preHandler: logisticsRead,
      schema: {
        body: personSearchBody,
        description:
          "Unified person lookup for logistics stations (H22-H27). Every comparison is case-insensitive, and the fuzzy tier is also accent-insensitive ('perez' finds 'Pérez'). `q` is resolved as: an exact ticket token, then someone's CURRENT badge id (a rotated-away badge never shadows the current holder), then a rotated-away badge (matchedBy `badge_history`), then a name / surname / 'name surname' / 'surname name' / email substring. Exact identifier hits return exactly one person; the fuzzy fallback returns up to 10. `fields` whitelists which extra user fields come back (email, badgeId, dni, phone, shirtSize, notes, confirmed); defaults to email + badgeId + confirmed. Anonymized accounts (H54) never match, on any tier. Read-only; any logistics capability grants access.",
      },
    },
    async (req) => ({ results: await searchPeople(req.body.q, req.body.fields) }),
  );

  // ── H22 accreditation ────────────────────────────────────────────────────

  typed.post(
    "/api/accreditation/lookup",
    {
      ...routeAccess(access.accredit),
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
      ...routeAccess(access.accredit),
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
      ...routeAccess(access.accredit),
      preHandler: [accredit, idempotencyGuard],
      schema: {
        body: checkInBody,
        description:
          "Assign a badge to the ticket's owner and log the check-in (H22). Idempotency-key replays are safe; 409 if the badge belongs to someone else, the badge id is actually a ticket token, or the person is already accredited (use /api/accreditation/rotate to replace a badge).",
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
      ...routeAccess(access.accredit),
      preHandler: [accredit, idempotencyGuard],
      schema: {
        body: checkInUserBody,
        description:
          "Same as /api/accreditation/check-in but keyed by user id instead of ticket token (H22). For an unassigned person, attendeeRole atomically creates the participant/mentor relationship and ticket before badge assignment.",
      },
    },
    async (req) =>
      checkInUser(actor(req.userId), {
        userId: req.body.userId,
        badgeId: req.body.badgeId,
        method: req.body.method,
        attendeeRole: req.body.attendeeRole,
      }),
  );

  // ── H23 badge rotation ───────────────────────────────────────────────────

  typed.post(
    "/api/accreditation/rotate",
    {
      ...routeAccess(access.accredit),
      preHandler: [accredit, idempotencyGuard],
      schema: {
        body: rotateBody,
        description:
          "Replace someone's badge (H23): identify the person by userId (preferred) or by their current badge id. The old badge is revoked everywhere, wallet badge passes are voided, and the change is audited with the given reason. 409 if the new badge is already assigned or is actually a ticket token.",
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

  typed.post(
    "/api/accreditation/remove",
    {
      ...routeAccess(access.accredit),
      preHandler: [accredit, idempotencyGuard],
      schema: { body: removeBadgeBody },
    },
    async (req) => removeBadge(actor(req.userId), req.body),
  );

  // ── H24 presence ─────────────────────────────────────────────────────────

  typed.post(
    "/api/presence/lookup",
    { ...routeAccess(access.presence), preHandler: presence, schema: { body: presenceLookupBody } },
    async (req) => presenceLookup(req.body.badgeId),
  );

  typed.post(
    "/api/presence/scan",
    {
      ...routeAccess(access.presence),
      preHandler: [presence, idempotencyGuard],
      schema: { body: presenceScanBody },
    },
    async (req) =>
      presenceScan(actor(req.userId), {
        badgeId: req.body.badgeId,
        kind: req.body.kind,
        scannedAt: req.body.scannedAt,
      }),
  );

  typed.get(
    "/api/presence/estimate",
    { ...routeAccess(access.presenceRead), preHandler: presenceRead },
    async () => occupancyEstimate(),
  );

  typed.get(
    "/api/presence/hours",
    { ...routeAccess(access.presenceRead), preHandler: presenceRead },
    async () => allHours(),
  );

  // Staff reconciliation queue: open sessions, stale ones flagged (H24).
  typed.get(
    "/api/presence/open",
    { ...routeAccess(access.presenceRead), preHandler: presenceRead },
    async () => ({
      items: await openSessions(),
    }),
  );

  typed.get(
    "/api/presence/hours/:userId",
    {
      ...routeAccess(access.presenceRead),
      preHandler: presenceRead,
      schema: { params: userIdParam },
    },
    async (req) => userHours(req.params.userId),
  );

  // Raw scan admin — view/correct individual door scans (H24 usability).
  typed.get(
    "/api/presence/logs/:userId",
    {
      ...routeAccess(access.presenceRead),
      preHandler: presenceRead,
      schema: { params: userIdParam },
    },
    async (req) => ({ items: await listTimeLogs(req.params.userId) }),
  );

  typed.get(
    "/api/presence/timeline/:userId",
    {
      ...routeAccess(access.presenceRead),
      preHandler: presenceRead,
      schema: {
        params: userIdParam,
        summary: "Presence timeline for one person",
        description:
          "Unified presence view (H24): every door/activity signal in order, the derived " +
          "certainty windows (secured/provisional/invalid, plus a `conflict` flag on windows " +
          "invalidated by an illegal in→in sequence), the effective certainty-window duration, " +
          "and `conflicts[]` — pairs of consecutive door entries with no exit/activity between " +
          "them, with the log ids and time bounds needed to insert the missing signal.",
      },
    },
    async (req) => presenceTimeline(req.params.userId),
  );

  typed.post(
    "/api/presence/signals/:userId",
    {
      ...routeAccess(access.presence),
      preHandler: presence,
      schema: { params: userIdParam, body: presenceSignalBody },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await createPresenceSignal(actor(req.userId), req.params.userId, req.body)),
  );

  typed.patch(
    "/api/presence/logs/:id",
    {
      ...routeAccess(access.presence),
      preHandler: presence,
      schema: { params: timeLogIdParam, body: timeLogPatchBody },
    },
    async (req) =>
      updateTimeLog(actor(req.userId), req.params.id, {
        kind: req.body.kind,
        scannedAt: req.body.scannedAt,
        notes: req.body.notes,
      }),
  );

  typed.patch(
    "/api/presence/activity-logs/:id",
    {
      ...routeAccess(access.presence),
      preHandler: presence,
      schema: { params: timeLogIdParam, body: presenceActivityPatchBody },
    },
    async (req) => updatePresenceActivity(actor(req.userId), req.params.id, req.body),
  );

  typed.delete(
    "/api/presence/activity-logs/:id",
    { ...routeAccess(access.presence), preHandler: presence, schema: { params: timeLogIdParam } },
    async (req) => deletePresenceActivity(actor(req.userId), req.params.id),
  );

  typed.delete(
    "/api/presence/logs/:id",
    { ...routeAccess(access.presence), preHandler: presence, schema: { params: timeLogIdParam } },
    async (req) => deleteTimeLog(actor(req.userId), req.params.id),
  );

  // ── H25 meals / H26 activities ───────────────────────────────────────────

  // Scannable activities with live counts — powers the meal/activity station
  // pickers and their inline stats (available to scan operators, not just
  // LOGISTICS_STATS). Fixes the scanner that used to require the stats panel.
  typed.get(
    "/api/activities/scannable",
    {
      ...routeAccess(access.scanRead),
      preHandler: scanRead,
      schema: { querystring: scannableActivitiesQuery },
    },
    async (req) => ({ items: await scannableActivities(req.query.category) }),
  );

  typed.post(
    "/api/activities/:id/scan",
    {
      ...routeAccess(access.activity),
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
      ...routeAccess(access.activity),
      preHandler: [activity, idempotencyGuard],
      schema: { params: activityIdParam, body: mealScanBatchBody },
    },
    async (req) =>
      enqueueMealScanBatch(actor(req.userId), req.params.id, {
        deviceId: req.body.deviceId,
        scans: req.body.scans,
      }),
  );

  // ── H27 stats ────────────────────────────────────────────────────────────

  typed.get("/api/logistics/stats", { ...routeAccess(access.stats), preHandler: stats }, async () =>
    logisticsStats(),
  );

  typed.get(
    "/api/logistics/stream",
    { ...routeAccess(access.logisticsRead), preHandler: logisticsRead },
    async (_req, reply) => {
      await subscribe("logistics", reply);
    },
  );

  // ── staff scan history/stats (extends H22-H27) ──────────────────────────

  typed.get(
    "/api/me/logistics/stats",
    {
      ...routeAccess(access.logisticsRead),
      preHandler: logisticsRead,
      schema: {
        summary: "My scan counts",
        description:
          "Counts of scans the calling operator personally performed, by domain: accreditation check-ins, presence door-scans, activity/meal scans. Any scan-capable operator can read their own counts.",
        response: { 200: staffScanStatsResponse },
      },
    },
    async (req) => staffScanCounts(actor(req.userId)),
  );

  typed.get(
    "/api/logistics/stats/by-staff",
    {
      ...routeAccess(access.stats),
      preHandler: stats,
      schema: {
        summary: "Scan ranking across all staff",
        description:
          "Every staff member who performed at least one scan, with their accreditation/presence/activity counts and a total, busiest first. Admin-facing (LOGISTICS_STATS) — this is the cross-staff view, unlike /api/me/logistics/stats.",
        response: { 200: staffScanRankingResponse },
      },
    },
    async () => ({ items: await staffScanRanking() }),
  );

  typed.get(
    "/api/logistics/scan-log",
    {
      ...routeAccess(access.logisticsRead),
      preHandler: logisticsRead,
      schema: {
        summary: "Team-wide scan-log feed",
        description:
          "Paginated history of scans, most recent first, unioning accreditation check-ins, presence door-scans, and activity/meal scans. Defaults to the caller's own scans; a scan-capable operator without LOGISTICS_STATS may only request their own staffId.",
        querystring: scanLogQuery,
        response: { 200: scanLogResponse },
      },
    },
    async (req) => {
      const callerId = actor(req.userId);
      const staffId = req.query.staffId ?? callerId;
      if (
        staffId !== callerId &&
        !(await userHasCapability(callerId, CAPABILITIES.LOGISTICS_STATS))
      ) {
        throw new ForbiddenError("Cannot view another staff member's scan log");
      }
      return queryScanLog(staffId, req.query.limit, req.query.offset);
    },
  );

  // ── Schedule CRUD ───────────────────────────────────────────────────────

  typed.get(
    "/api/schedule",
    { ...routeAccess(access.scheduleManage), preHandler: scheduleManage },
    async () => listSchedule(),
  );

  typed.post(
    "/api/schedule",
    {
      ...routeAccess(access.scheduleManage),
      preHandler: scheduleManage,
      schema: { body: scheduleBody },
    },
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
    {
      ...routeAccess(access.scheduleManage),
      preHandler: scheduleManage,
      schema: { params: scheduleIdParam, body: schedulePatchBody },
    },
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
    {
      ...routeAccess(access.scheduleManage),
      preHandler: scheduleManage,
      schema: { params: scheduleIdParam },
    },
    async (req) => deleteScheduleItem(actor(req.userId), req.params.id),
  );

  typed.post(
    "/api/schedule/visibility",
    {
      ...routeAccess(access.scheduleManage),
      preHandler: scheduleManage,
      schema: { body: scheduleVisibilityBody },
    },
    async (req) => setScheduleVisibility(actor(req.userId), req.body.ids, req.body.visibility),
  );

  typed.get(
    "/api/me/ticket",
    { ...routeAccess(access.authenticated), preHandler: requireAuth },
    async (req) => ticketQrPayload(actor(req.userId)),
  );

  typed.get(
    "/api/users/:userId/ticket",
    { ...routeAccess(access.ticketRead), preHandler: ticketRead, schema: { params: userIdParam } },
    async (req) => ticketQrPayload(req.params.userId),
  );

  // ── H28 Apple Wallet / PassKit ──────────────────────────────────────────

  typed.get(
    "/api/me/wallet/apple/:purpose.pkpass",
    {
      ...routeAccess(access.authenticated),
      preHandler: requireAuth,
      schema: {
        summary: "Download my Apple Wallet pass",
        description:
          "Authenticated self-service H28 pass issuance. The pass belongs only to the current session's user and is then refreshed by the separate ApplePass web-service token protocol.",
        params: walletPurposeParam,
      },
    },
    async (req, reply) => {
      const { pkpass, passTypeIdentifier, serialNumber } = await buildApplePass(
        actor(req.userId),
        req.params.purpose,
      );
      return reply
        .type("application/vnd.apple.pkpass")
        .header("content-disposition", `attachment; filename="${req.params.purpose}.pkpass"`)
        .header("x-apple-pass-type-identifier", passTypeIdentifier)
        .header("x-apple-pass-serial-number", serialNumber)
        .send(pkpass);
    },
  );

  typed.get(
    "/api/wallet/apple/v1/passes/:passTypeIdentifier/:serialNumber",
    {
      ...routeAccess(access.applePasskit),
      preHandler: requireAppleWebServiceToken,
      schema: {
        summary: "PassKit pass refresh",
        description:
          "Apple Wallet web-service endpoint. It requires the pass's `Authorization: ApplePass <authenticationToken>` credential; a session cookie is neither accepted nor needed.",
        params: applePassParams,
      },
    },
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
    {
      ...routeAccess(access.applePasskit),
      preHandler: requireAppleWebServiceToken,
      schema: { params: appleDeviceParams, body: appleRegistrationBody },
    },
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
    {
      ...routeAccess(access.applePasskit),
      preHandler: requireAppleWebServiceToken,
      schema: { params: appleDeviceParams },
    },
    async (req, reply) => {
      await unregisterAppleDevice({ ...req.params, authorization: req.headers.authorization });
      return reply.code(200).send({});
    },
  );

  typed.get(
    "/api/wallet/apple/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier",
    {
      ...routeAccess(access.applePasskit),
      preHandler: requireAppleWebServiceToken,
      schema: {
        params: appleDeviceParams.omit({ serialNumber: true }),
        querystring: appleRegistrationsQuery,
      },
    },
    async (req, reply) => {
      const r = await appleChangedSerials({
        ...req.params,
        authorization: req.headers.authorization,
        passesUpdatedSince: req.query.passesUpdatedSince,
      });
      if (r.serialNumbers.length === 0) return reply.code(204).send();
      return r;
    },
  );

  typed.post(
    "/api/wallet/apple/v1/log",
    {
      ...routeAccess(access.applePasskit),
      preHandler: requireAppleWebServiceToken,
      schema: {
        summary: "PassKit device diagnostics",
        description:
          "Apple Wallet device diagnostics authenticated with an ApplePass web-service token. The API records only the device-supplied diagnostic lines.",
        body: appleLogBody,
      },
    },
    async (req) => appleLog(req.body.logs),
  );

  // ── H28 Google Wallet ────────────────────────────────────────────────────

  typed.get(
    "/api/me/wallet/google/:purpose",
    {
      ...routeAccess(access.authenticated),
      preHandler: requireAuth,
      schema: {
        summary: "Create my Google Wallet save URL",
        description:
          "Authenticated self-service H28 endpoint returning a signed Google Wallet save URL for the caller's own ticket or badge.",
        params: walletPurposeParam,
      },
    },
    async (req) => ({ saveUrl: await buildGoogleSaveUrl(actor(req.userId), req.params.purpose) }),
  );

  // ── scoped, session-less wallet access (issue #369) ──────────────────────
  // Someone who just confirmed their spot from the acceptance email holds a
  // scoped token, not a session. These two routes are the entire surface that
  // token can reach: the pass it was minted for, for the user it names.
  // `req.userId` is deliberately ignored — a signed-in visitor gets the
  // token's pass, never their own.

  typed.get(
    "/api/wallet/scoped/apple/:purpose.pkpass",
    {
      ...routeAccess(access.scopedWallet),
      schema: {
        params: walletPurposeParam,
        querystring: walletAccessQuery,
        summary: "Apple Wallet pass via a scoped token",
        description:
          "Downloads the .pkpass for the user named by a scoped wallet token (issue #369) — the credential handed out when a spot is confirmed from the acceptance email (H28). No session is required, created or read: the token alone decides whose pass this is, must match `purpose`, and expires after an hour. 401 if it is unknown, expired, or minted for a different purpose.",
      },
    },
    async (req, reply) => {
      const { userId } = await resolveWalletAccessToken(req.query.token, req.params.purpose);
      const { pkpass, passTypeIdentifier, serialNumber } = await buildApplePass(
        userId,
        req.params.purpose,
      );
      return reply
        .type("application/vnd.apple.pkpass")
        .header("content-disposition", `attachment; filename="${req.params.purpose}.pkpass"`)
        .header("x-apple-pass-type-identifier", passTypeIdentifier)
        .header("x-apple-pass-serial-number", serialNumber)
        .send(pkpass);
    },
  );

  typed.get(
    "/api/wallet/scoped/google/:purpose",
    {
      ...routeAccess(access.scopedWallet),
      schema: {
        params: walletPurposeParam,
        querystring: walletAccessQuery,
        summary: "Google Wallet save URL via a scoped token",
        description:
          "Returns the 'Save to Google Wallet' URL for the user named by a scoped wallet token (issue #369), the session-less counterpart of /api/me/wallet/google/:purpose (H28). Same scoping rules as the Apple route: token decides the user, must match `purpose`, expires after an hour, 401 otherwise.",
      },
    },
    async (req) => {
      const { userId } = await resolveWalletAccessToken(req.query.token, req.params.purpose);
      return { saveUrl: await buildGoogleSaveUrl(userId, req.params.purpose) };
    },
  );
}

async function ticketQrPayload(userId: number) {
  const [{ rows }, { rows: acceptedRows }] = await Promise.all([
    pool.query(
      `SELECT u.id, u.badge_id, t.token
       FROM users u
       LEFT JOIN tickets t ON t.user_id = u.id
      WHERE u.id = $1`,
      [userId],
    ),
    pool.query(
      `SELECT r.id AS response_id, a.name AS application_name, a.type AS application_type,
              evt.expires_at
         FROM application_responses r
         JOIN applications a ON a.id = r.application_id
         LEFT JOIN email_verification_tokens evt ON evt.id = r.confirmation_token_id
        WHERE r.user_id = $1
          AND r.status = 'accepted'
          AND r.decision_sent_at IS NOT NULL
        ORDER BY r.id DESC`,
      [userId],
    ),
  ]);
  const row = rows[0];
  if (!row) throw new NotFoundError("User not found");
  return {
    userId: row.id as number,
    ticketToken: (row.token as string | null) ?? null,
    badgeId: (row.badge_id as string | null) ?? null,
    acceptedSpots: acceptedRows.map((accepted) => ({
      responseId: accepted.response_id as number,
      applicationName: accepted.application_name as string,
      applicationType: accepted.application_type as string,
      expiresAt: accepted.expires_at ? (accepted.expires_at as Date).toISOString() : null,
    })),
  };
}
