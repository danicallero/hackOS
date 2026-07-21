import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../db/pool.js";
import { requireAuth, requireCapability, userHasCapability } from "../../lib/capabilities.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";
import { subscribe } from "../../lib/sse.js";
import {
  requireChallengeJudgeOrCapability,
  requireRepoJudgeOrCapability,
  requireRoomJudgeOrCapability,
} from "./contextual-access.js";
import {
  allRoomViews,
  challengeProgress,
  myQueueStatus,
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

/** Read APIs (H38-H42): progress, room views, participant status, pace, SSE streams, TV mode. */
export function registerReadsRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  async function assertCanReadRoomAssignments(userId: number | null, roomId: number) {
    if (userId == null) throw new UnauthorizedError();
    if (await userHasCapability(userId, CAPABILITIES.QUEUE_ADMIN)) return;
    const { rows } = await pool.query(
      `SELECT 1
         FROM room_challenges rc
         JOIN challenges c ON c.id = rc.challenge_id
         JOIN sponsors author ON author.id = c.author
         JOIN sponsors mine ON mine.enterprise_id = author.enterprise_id
        WHERE rc.room_id = $1 AND mine.user_id = $2
        LIMIT 1`,
      [roomId, userId],
    );
    if (rows.length === 0) throw new ForbiddenError("Not allowed to read room assignments");
  }

  // H40: progress panel per challenge.
  typed.get(
    "/api/queue/challenges/:challengeId/progress",
    {
      preHandler: requireChallengeJudgeOrCapability(
        CAPABILITIES.JUDGE_PANEL,
        CAPABILITIES.QUEUE_OPERATE,
        CAPABILITIES.QUEUE_ADMIN,
      ),
      schema: { params: challengeIdParam },
    },
    async (req) => challengeProgress(req.params.challengeId),
  );

  // H40 (judging card): every challenge queue this repo belongs to, not just
  // the one the current room judges — a project can submit to several.
  typed.get(
    "/api/queue/repos/:repoId/challenges",
    {
      preHandler: requireRepoJudgeOrCapability(
        CAPABILITIES.JUDGE_PANEL,
        CAPABILITIES.QUEUE_OPERATE,
        CAPABILITIES.QUEUE_ADMIN,
      ),
      schema: { params: repoIdParam },
    },
    async (req) => repoChallenges(req.params.repoId),
  );

  // H41: full room view for operator panels; also the TV data source.
  typed.get(
    "/api/queue/rooms/:roomId/view",
    {
      preHandler: requireRoomJudgeOrCapability(
        CAPABILITIES.JUDGE_PANEL,
        CAPABILITIES.QUEUE_OPERATE,
        CAPABILITIES.QUEUE_ADMIN,
      ),
      schema: { params: roomIdParam },
    },
    async (req) => roomView(req.params.roomId, { includeCrossRoomSkips: true }),
  );

  // H46: authoritative room assignment surface for the admin panel.
  typed.get(
    "/api/queue/rooms/:roomId/assignments",
    { preHandler: requireAuth, schema: { params: roomIdParam } },
    async (req) => {
      await assertCanReadRoomAssignments(req.userId, req.params.roomId);
      return roomAssignments(req.params.roomId);
    },
  );

  // H39: pace check.
  typed.get(
    "/api/queue/rooms/:roomId/pace",
    {
      preHandler: requireRoomJudgeOrCapability(
        CAPABILITIES.JUDGE_PANEL,
        CAPABILITIES.QUEUE_OPERATE,
        CAPABILITIES.QUEUE_ADMIN,
      ),
      schema: { params: roomIdParam },
    },
    async (req) => roomPace(req.params.roomId),
  );

  // H38: participant "my queue status" — auth only, no capability.
  typed.get("/api/queue/me", { preHandler: requireAuth }, async (req) => {
    if (req.userId == null) throw new UnauthorizedError();
    return myQueueStatus(req.userId);
  });

  // H41: public TV data (all rooms) — no auth, read-only aggregate.
  typed.get("/api/tv/rooms", async () => allRoomViews());

  // H41/H42: public SSE streams. subscribe() keeps the socket open itself.
  typed.get("/api/queue/stream", async (_req, reply) => {
    await subscribe("queue", reply);
  });

  typed.get("/api/tv/stream", async (_req, reply) => {
    await subscribe("tv", reply);
  });

  // Public displays also need to react when the agenda or announcement feed
  // changes; these are published on the shared content topic.
  typed.get("/api/content/stream", async (_req, reply) => {
    await subscribe("content", reply);
  });

  // A deliberately payload-free stream for clients which are not tied to a
  // single domain read model. Every successful API write publishes here.
  typed.get("/api/events/stream", async (_req, reply) => {
    await subscribe("global", reply);
  });

  // Personal stream (H31/H38 aviso/pre-aviso): only your own topic.
  typed.get("/api/queue/me/stream", { preHandler: requireAuth }, async (req, reply) => {
    await subscribe(`user:${req.userId}`, reply);
  });

  // H42: what the screens should show right now — an operator override if one
  // is live, otherwise the covering timetable slot, otherwise the default.
  typed.get(
    "/api/tv/mode",
    {
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
      schema: {
        summary: "Broadcast a mode to every screen, overriding the timetable.",
        description:
          "Sets the operator override, which wins over any running timetable slot until it is cleared or its optional expiresAt passes (the tv-scheduler worker drops it and the timetable takes back over). Returns the newly resolved display state.",
        body: tvModeBody,
      },
    },
    async (req) => setTvMode(req.body.mode, req.body.payload, req.body.expiresAt ?? null),
  );

  typed.delete(
    "/api/tv/mode",
    {
      preHandler: requireCapability(CAPABILITIES.TV_CONTROL),
      schema: {
        summary: "Clear the operator override and go back to the timetable.",
        description:
          "Drops the manual broadcast so the screens follow the tv_slots timetable again, landing on whichever slot is running at that moment (or the default rooms view if none covers now).",
      },
    },
    async () => clearTvOverride(),
  );

  // H42: venue details every screen may need regardless of mode. Public, like
  // the rest of the TV feed — these are credentials printed on the venue wall.
  typed.get(
    "/api/tv/config",
    {
      schema: {
        summary: "Venue details the screens render (Wi-Fi credentials).",
        description:
          "Public TV feed companion to /api/tv/mode. Serves the venue Wi-Fi network name, password and note from the event config, so the combined live screen and the full-screen Wi-Fi mode can show them unattended. Returns null when no network is configured.",
      },
    },
    async () => tvVenueConfig(),
  );

  // H42 timetable: absolute time windows saying what the fleet shows when.
  typed.get(
    "/api/tv/slots",
    {
      preHandler: requireCapability(CAPABILITIES.TV_CONTROL),
      schema: {
        summary: "List the TV timetable.",
        description:
          "Every scheduled slot in start order. Slots may overlap; the one covering now with the latest start is the one that ends up on screen.",
      },
    },
    async () => ({ items: await listTvSlots() }),
  );

  typed.post(
    "/api/tv/slots",
    {
      preHandler: requireCapability(CAPABILITIES.TV_CONTROL),
      schema: {
        summary: "Add a slot to the TV timetable.",
        description:
          "Schedules what the screens show during an absolute time window. One item renders statically; several make the display rotate through them on each item's `seconds` dwell. Rejected when the window ends before it starts.",
        body: tvSlotBody,
      },
    },
    async (req) => createTvSlot(req.body, req.userId),
  );

  typed.patch(
    "/api/tv/slots/:id",
    {
      preHandler: requireCapability(CAPABILITIES.TV_CONTROL),
      schema: {
        summary: "Edit a TV timetable slot.",
        description:
          "Updates the window, label or items of an existing slot. Editing the slot that is currently running takes effect on the screens immediately. Fields omitted from the body are left unchanged.",
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
      schema: {
        summary: "Remove a TV timetable slot.",
        description:
          "Deletes the slot. If it was the one running, the screens fall through to whatever other slot covers now, or to the default rooms view.",
        params: idParam,
      },
    },
    async (req) => {
      await deleteTvSlot(req.params.id, req.userId);
      return { ok: true };
    },
  );
}
