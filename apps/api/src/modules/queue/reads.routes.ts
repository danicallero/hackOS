import { CAPABILITIES } from "@hackos/shared/capabilities";
import { SSE_TOPICS } from "@hackos/shared/events";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireAnyCapability, requireAuth, requireCapability } from "../../lib/capabilities.js";
import { subscribe } from "../../lib/sse.js";
import {
  requireChallengeJudgeOrCapability,
  requireRepoJudgeOrCapability,
  requireRoomAssignmentsAccess,
  requireRoomJudgeOrCapability,
} from "./contextual-access.js";
import {
  challengeProgress,
  myQueueStatus,
  publicRoomViews,
  repoChallenges,
  roomAssignments,
  roomPace,
  roomView,
} from "./reads.js";
import {
  challengeIdParam,
  idParam,
  repoIdParam,
  roomIdParam,
  tvModeBody,
  tvSlotBody,
  tvSlotPatchBody,
} from "./schemas.js";
import { clearTvOverride, listTvSlots, resolveTvState, setTvMode, tvVenueConfig } from "./tv.js";
import { createTvSlot, deleteTvSlot, updateTvSlot } from "./tv-slots.js";

const tvControlPolicy = {
  kind: "capability" as const,
  capability: CAPABILITIES.TV_CONTROL,
};

/** Read APIs (H38-H42): scoped queue data, TV snapshots and SSE isolation. */
export function registerReadsRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

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
    async (req) => challengeProgress(req.params.challengeId),
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
      schema: { params: repoIdParam },
    },
    async (req) => repoChallenges(req.params.repoId),
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
      schema: { params: roomIdParam },
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
      schema: { params: roomIdParam },
    },
    async (req) => roomPace(req.params.roomId),
  );

  typed.get(
    "/api/queue/me",
    { preHandler: requireAuth, config: { routeAccessPolicy: { kind: "authenticated" } } },
    async (req) => myQueueStatus(req.userId!),
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
    async () => publicRoomViews(),
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
    async (_req, reply) => subscribe("queue", reply),
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
    async (_req, reply) => subscribe(SSE_TOPICS.PUBLIC_TV, reply),
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
    async (_req, reply) => subscribe(SSE_TOPICS.PUBLIC_CONTENT, reply),
  );

  typed.get(
    "/api/events/stream",
    {
      preHandler: requireAuth,
      config: { routeAccessPolicy: { kind: "authenticated" } },
      schema: {
        summary: "Authenticated global invalidation stream",
        description:
          "Authenticated, payload-free refresh stream for signed-in clients. It does not authorize any operational resource or disclose mutation payloads.",
      },
    },
    async (_req, reply) => subscribe("global", reply),
  );

  typed.get(
    "/api/queue/me/stream",
    {
      preHandler: requireAuth,
      config: { routeAccessPolicy: { kind: "authenticated" } },
      schema: {
        summary: "Personal queue stream",
        description:
          "Authenticated SSE stream for the current participant's queue notifications only.",
      },
    },
    async (req, reply) => subscribe(`user:${req.userId}`, reply),
  );

  typed.get(
    "/api/tv/mode",
    {
      config: { routeAccessPolicy: { kind: "public", anonymousCategory: "public-tv" } },
      schema: {
        summary: "What the venue screens are currently showing.",
        description:
          "Public feed for the TV wall. Returns the resolved display state: an operator override if one is live and unexpired, otherwise the timetable slot covering now (latest-starting slot wins on overlap), otherwise the default rooms view. `source` says which of the three applied, and `slot.items` carries the rotation entries a slot cycles through.",
      },
    },
    async () => resolveTvState(),
  );

  typed.patch(
    "/api/tv/mode",
    {
      preHandler: requireCapability(CAPABILITIES.TV_CONTROL),
      config: { routeAccessPolicy: tvControlPolicy },
      schema: {
        summary: "Broadcast a mode to every screen, overriding the timetable.",
        description:
          "Sets the operator override, which wins over any running timetable slot until it is cleared or its optional expiresAt passes.",
        body: tvModeBody,
      },
    },
    async (req) => setTvMode(req.body.mode, req.body.payload, req.body.expiresAt ?? null),
  );

  typed.delete(
    "/api/tv/mode",
    {
      preHandler: requireCapability(CAPABILITIES.TV_CONTROL),
      config: { routeAccessPolicy: tvControlPolicy },
      schema: {
        summary: "Clear the operator override and go back to the timetable.",
        description:
          "Drops the manual broadcast so screens follow the active timetable slot or default rooms view.",
      },
    },
    async () => clearTvOverride(),
  );

  typed.get(
    "/api/tv/config",
    {
      config: { routeAccessPolicy: { kind: "public", anonymousCategory: "public-tv" } },
      schema: {
        summary: "Venue details the screens render (Wi-Fi credentials).",
        description:
          "Public TV companion feed for venue Wi-Fi details printed on the wall. It is intentionally separate from the public event site projection.",
      },
    },
    async () => tvVenueConfig(),
  );

  typed.get(
    "/api/tv/slots",
    {
      preHandler: requireCapability(CAPABILITIES.TV_CONTROL),
      config: { routeAccessPolicy: tvControlPolicy },
      schema: {
        summary: "List the TV timetable.",
        description:
          "Every scheduled slot in start order. Slots may overlap; the latest-starting slot covering now wins.",
      },
    },
    async () => ({ items: await listTvSlots() }),
  );

  typed.post(
    "/api/tv/slots",
    {
      preHandler: requireCapability(CAPABILITIES.TV_CONTROL),
      config: { routeAccessPolicy: tvControlPolicy },
      schema: {
        summary: "Add a slot to the TV timetable.",
        description:
          "Schedules a display mode for an absolute time window; several items rotate by their configured dwell.",
        body: tvSlotBody,
      },
    },
    async (req) => createTvSlot(req.body, req.userId),
  );

  typed.patch(
    "/api/tv/slots/:id",
    {
      preHandler: requireCapability(CAPABILITIES.TV_CONTROL),
      config: { routeAccessPolicy: tvControlPolicy },
      schema: {
        summary: "Edit a TV timetable slot.",
        description:
          "Updates a slot and republishes the resolved public display state immediately when it is active.",
        params: idParam,
        body: tvSlotPatchBody,
      },
    },
    async (req) => updateTvSlot(req.params.id, req.body, req.userId),
  );

  typed.delete(
    "/api/tv/slots/:id",
    {
      preHandler: requireCapability(CAPABILITIES.TV_CONTROL),
      config: { routeAccessPolicy: tvControlPolicy },
      schema: {
        summary: "Remove a TV timetable slot.",
        description: "Deletes the slot and falls through to the next applicable timetable state.",
        params: idParam,
      },
    },
    async (req) => {
      await deleteTvSlot(req.params.id, req.userId);
      return { ok: true };
    },
  );
}
