import { CAPABILITIES } from "@hackos/shared/capabilities";
import { SSE_TOPICS } from "@hackos/shared/events";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import {
  getRequestAuthorizationContext,
  requireAnyCapability,
  requireAuth,
  requireCapability,
} from "../../lib/capabilities.js";
import { registerRealtimeRoutes } from "../../lib/realtime.routes.js";
import { sharedCache } from "../../lib/shared-cache.js";
import { subscribe } from "../../lib/sse.js";
import { requireScopedRefreshAccess, scopedRefreshTopic } from "../../lib/sse-access.js";
import { sharedVisibleWinnerRows } from "../challenges/winner-publication.js";
import { logisticsTopicForFixture } from "../logistics/active-broadcast.js";
import { isSyntheticOperator } from "../logistics/review-fixture-scope.js";
import { queueTopicForFixture } from "./broadcast.js";
import {
  accessibleRoomIds,
  requireChallengeJudgeOrCapability,
  requireRepoJudgeOrCapability,
  requireRoomAssignmentsAccess,
  requireRoomJudgeOrCapability,
  requireRoomListAccess,
} from "./contextual-access.js";
import {
  challengeProgress,
  myQueueStatus,
  publicRoomViews,
  repoChallenges,
  roomAssignments,
  roomPace,
  roomView,
  roomViews,
} from "./reads.js";
import { challengeIdParam, repoIdParam, roomIdParam, tvConfigBody, tvModeBody } from "./schemas.js";
import { clearTvMode, resolveTvState, setTvLanguage, setTvMode, tvVenueConfig } from "./tv.js";

const tvControlPolicy = {
  kind: "capability" as const,
  capability: CAPABILITIES.TV_CONTROL,
};

const scopedRefreshQuery = z.object({ topic: scopedRefreshTopic });

/** Read APIs (H38-H42): scoped queue data, TV snapshots and SSE isolation. */
export function registerReadsRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  registerRealtimeRoutes(app);

  typed.get(
    "/api/queue/challenges/:challengeId/progress",
    {
      preHandler: requireChallengeJudgeOrCapability(
        CAPABILITIES.JUDGE_PANEL,
        CAPABILITIES.QUEUE_OPERATE,
        CAPABILITIES.QUEUE_ADMIN,
      ),
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "challenge-read",
          resource: { source: "params", field: "challengeId" },
        },
      },
      schema: { params: challengeIdParam },
    },
    async (req) =>
      challengeProgress(req.params.challengeId, await isSyntheticOperator(pool, req.userId!)),
  );

  typed.get(
    "/api/queue/repos/:repoId/challenges",
    {
      preHandler: requireRepoJudgeOrCapability(
        CAPABILITIES.JUDGE_PANEL,
        CAPABILITIES.QUEUE_OPERATE,
        CAPABILITIES.QUEUE_ADMIN,
      ),
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "repo-read",
          resource: { source: "params", field: "repoId" },
        },
      },
      schema: {
        params: repoIdParam,
        summary: "List a team's queue memberships",
        description:
          "Every non-cancelled queue entry of the team with its waiting rank, ETA, assigned room and the rooms serving its queue. `busy_room_id`/`busy_room_name`/`busy_status` report where a team member (shared-member relation of the H30 guard, test fixtures excluded) is `called`, `in_room` or `presenting` in a separate queue entry, including in the same room; an evaluation blocks moves, any of them blocks another call (#931). Completed and disqualified rows never carry it. `eligible` is false when the project is excluded from judging (H38): it can be reordered but never called. A native projects import is excluded only by an explicit organizer override (H21).",
      },
    },
    async (req) => repoChallenges(req.params.repoId),
  );

  typed.get(
    "/api/queue/rooms/views",
    {
      preHandler: requireRoomListAccess,
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "room-list",
        },
      },
      schema: {
        summary: "Room queue views for every visible room",
        description:
          "Bulk form of `GET /api/queue/rooms/:roomId/view` for operator and judge boards: one request returns the room queue view (room, state, queue label, active, called, waiting teams with ETA and `crossRoomSkips`) of every room the caller can list through `GET /api/queue/rooms`, ordered by room id. Global queue operators and administrators receive every room in their fixture boundary; relationship-only judges and sponsor representatives receive only the rooms serving their enterprise's queues. Callers with no visible room are denied, except global operators/administrators, who receive an empty list. Each element is identical to the single-room view. The data is computed set-based across rooms rather than per room (H29, H38, H41).",
      },
    },
    async (req) => {
      const roomIds = (await accessibleRoomIds(req)) ?? [];
      return roomViews(roomIds, { includeCrossRoomSkips: true });
    },
  );

  typed.get(
    "/api/queue/rooms/:roomId/view",
    {
      preHandler: requireRoomJudgeOrCapability(
        CAPABILITIES.JUDGE_PANEL,
        CAPABILITIES.QUEUE_OPERATE,
        CAPABILITIES.QUEUE_ADMIN,
      ),
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "room-read",
          resource: { source: "params", field: "roomId" },
        },
      },
      schema: {
        params: roomIdParam,
        summary: "Room queue view",
        description:
          'The room\'s active, called and waiting teams. `crossRoomSkips` explains, read-only, why call-next passes over a waiting team without moving it: `reason: "ineligible"` when the project is not eligible for judging (H38), or `reason: "busy_member"` with the blocking room, team and status when a team member is called or being evaluated in a separate queue entry, including in this room (H30, #931).',
      },
    },
    async (req) => roomView(req.params.roomId, { includeCrossRoomSkips: true }),
  );

  typed.get(
    "/api/queue/rooms/:roomId/assignments",
    {
      preHandler: requireRoomAssignmentsAccess,
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "room-assignments",
          resource: { source: "params", field: "roomId" },
        },
      },
      schema: { params: roomIdParam },
    },
    async (req) => roomAssignments(req.params.roomId),
  );

  typed.get(
    "/api/queue/rooms/:roomId/pace",
    {
      preHandler: requireRoomJudgeOrCapability(
        CAPABILITIES.JUDGE_PANEL,
        CAPABILITIES.QUEUE_OPERATE,
        CAPABILITIES.QUEUE_ADMIN,
      ),
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "room-read",
          resource: { source: "params", field: "roomId" },
        },
      },
      schema: {
        params: roomIdParam,
        querystring: z.object({ challengeId: z.coerce.number().int().positive().optional() }),
        summary: "Read track pacing in a room",
        description:
          "A track-wide target, learned presentation/preparation cycle, scheduled judging close and realistic finish. An optional challengeId selects a served track in a multi-track room; ETA is never clipped to the advisory judge goal (H38/H39).",
      },
    },
    async (req) => roomPace(req.params.roomId, req.query.challengeId),
  );

  typed.get(
    "/api/queue/me",
    {
      preHandler: requireAuth,
      config: { routeAccessPolicy: { kind: "authenticated" } },
      schema: {
        summary: "Participant queue status",
        description:
          "Returns one current row per queue for each project the participant belongs to. Challenge entries in a shared queue are collapsed and named by the queue group. While waiting, queueTotal counts every team in that queue, judged or not; while called, calledAhead counts teams called earlier to the same room and not yet in it.",
      },
    },
    async (req) => myQueueStatus(req.userId!),
  );

  typed.get(
    "/api/tv/winners",
    {
      config: { routeAccessPolicy: { kind: "public", anonymousCategory: "public-tv" } },
      schema: {
        summary: "Read published ceremony winners",
        description:
          "Public TV uses the centralized gallery audience and published timestamp policy; no winner property is returned before reveal (H60).",
      },
    },
    async (q) => {
      const winners = await sharedVisibleWinnerRows(pool, q.userId);
      return winners.length ? { winners } : {};
    },
  );
  typed.get(
    "/api/tv/rooms",
    {
      config: { routeAccessPolicy: { kind: "public", anonymousCategory: "public-tv" } },
      schema: {
        summary: "Sanitized venue room snapshot",
        description:
          "Public TV projection containing only room, challenge and visible team-status fields. It intentionally omits team members, account identifiers, project links and operational cross-room diagnostics.",
      },
    },
    () => sharedCache("tv", "rooms", 2, publicRoomViews),
  );

  // Raw queue events contain operational room and team data. Public walls use
  // the invalidation streams below and refetch their sanitized read models.
  typed.get(
    "/api/queue/stream",
    {
      preHandler: requireAnyCapability(
        CAPABILITIES.QUEUE_OPERATE,
        CAPABILITIES.QUEUE_ADMIN,
        CAPABILITIES.JUDGE_PANEL,
      ),
      config: {
        routeAccessPolicy: {
          kind: "capability",
          anyOf: [CAPABILITIES.QUEUE_OPERATE, CAPABILITIES.QUEUE_ADMIN, CAPABILITIES.JUDGE_PANEL],
        },
      },
      schema: {
        summary: "Operational judging stream",
        description:
          "Authenticated operational SSE stream for global queue operators, judging administrators and global judging-panel holders. Assigned relationship-only judges use scoped reads; raw queue events are never public.",
      },
    },
    async (req, reply) =>
      subscribe(queueTopicForFixture(await isSyntheticOperator(pool, req.userId!)), req, reply),
  );

  typed.get(
    "/api/tv/stream",
    {
      config: { routeAccessPolicy: { kind: "public", anonymousCategory: "public-invalidation" } },
      schema: {
        summary: "Public TV invalidation stream",
        description:
          "Public, payload-free SSE invalidations for venue screens. Clients refetch the sanitized TV projection after each event; no operational queue or display payload crosses this stream.",
      },
    },
    async (req, reply) => subscribe(SSE_TOPICS.PUBLIC_TV, req, reply),
  );

  typed.get(
    "/api/content/stream",
    {
      config: { routeAccessPolicy: { kind: "public", anonymousCategory: "public-invalidation" } },
      schema: {
        summary: "Public content invalidation stream",
        description:
          "Public, payload-free SSE invalidations for TV and public content. Clients refetch their public projection after an event.",
      },
    },
    async (req, reply) => subscribe(SSE_TOPICS.PUBLIC_CONTENT, req, reply),
  );

  typed.get(
    "/api/events/stream",
    {
      preHandler: async (req) =>
        requireScopedRefreshAccess(
          req.userId,
          req.query.topic,
          getRequestAuthorizationContext(req),
        ),
      config: { routeAccessPolicy: { kind: "authenticated" } },
      schema: {
        querystring: scopedRefreshQuery,
        summary: "Authenticated domain refresh stream",
        description:
          "Payload-free, domain-scoped refresh stream for signed-in clients. The topic is required; sensitive audit, logistics and tv streams retain their capability boundary, while domain events disclose no mutation payload.",
      },
    },
    async (req, reply) => {
      const topic =
        req.query.topic === SSE_TOPICS.LOGISTICS
          ? logisticsTopicForFixture(await isSyntheticOperator(pool, req.userId!))
          : req.query.topic;
      return subscribe(topic, req, reply);
    },
  );

  typed.get(
    "/api/queue/me/stream",
    {
      preHandler: requireAuth,
      config: { routeAccessPolicy: { kind: "authenticated" } },
      schema: {
        summary: "Personal queue stream",
        description:
          "Authenticated SSE stream for the current participant's queue, inbox and session-refresh notifications only.",
      },
    },
    async (req, reply) => subscribe(`user:${req.userId}`, req, reply),
  );

  typed.get(
    "/api/tv/mode",
    {
      config: { routeAccessPolicy: { kind: "public", anonymousCategory: "public-tv" } },
      schema: {
        summary: "What the venue screens are currently showing.",
        description:
          "Public feed for the TV wall. Returns the mode selected manually by an operator, or the default rooms view when there is no selection.",
      },
    },
    () => sharedCache("tv", "mode", 2, resolveTvState),
  );

  typed.patch(
    "/api/tv/mode",
    {
      preHandler: requireCapability(CAPABILITIES.TV_CONTROL),
      config: { routeAccessPolicy: tvControlPolicy },
      schema: {
        summary: "Show a mode on every screen now.",
        description:
          "Sets the current display mode for every venue screen until an operator changes or clears it.",
        body: tvModeBody,
      },
    },
    async (req) => setTvMode(req.body.mode, req.body.payload),
  );

  typed.delete(
    "/api/tv/mode",
    {
      preHandler: requireCapability(CAPABILITIES.TV_CONTROL),
      config: { routeAccessPolicy: tvControlPolicy },
      schema: {
        summary: "Reset the screens to the default rooms view.",
        description: "Clears the manual display selection and returns every screen to rooms.",
      },
    },
    async () => clearTvMode(),
  );

  typed.get(
    "/api/tv/config",
    {
      config: { routeAccessPolicy: { kind: "public", anonymousCategory: "public-tv" } },
      schema: {
        summary: "Venue details the screens render (Wi-Fi credentials, display language).",
        description:
          "Public TV companion feed for venue Wi-Fi details and the operator-chosen display language printed/rendered on the wall. It is intentionally separate from the public event site projection.",
      },
    },
    () => sharedCache("tv", "config", 15, tvVenueConfig),
  );

  typed.patch(
    "/api/tv/config",
    {
      preHandler: requireCapability(CAPABILITIES.TV_CONTROL),
      config: { routeAccessPolicy: tvControlPolicy },
      schema: {
        summary: "Set the language every venue screen renders in.",
        description:
          "Persists the wall's display language, overriding the default. Applies regardless of who — if anyone — is signed into a kiosk browser; a null language clears the override.",
        body: tvConfigBody,
      },
    },
    async (req) => setTvLanguage(req.body.language, req.userId),
  );
}
