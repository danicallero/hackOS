import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../db/pool.js";
import {
  requireAnyCapability,
  requireAuth,
  requireCapability,
  userHasCapability,
} from "../../lib/capabilities.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";
import { subscribe } from "../../lib/sse.js";
import {
  requireChallengeJudgeOrCapability,
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
import { challengeIdParam, repoIdParam, roomIdParam, tvModeBody } from "./schemas.js";
import { getTvMode, setTvMode } from "./tv.js";

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
      preHandler: requireAnyCapability(
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
    async (req) => roomView(req.params.roomId),
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

  // H42: TV mode state in Valkey.
  typed.get("/api/tv/mode", async () => getTvMode());

  typed.patch(
    "/api/tv/mode",
    { preHandler: requireCapability(CAPABILITIES.TV_CONTROL), schema: { body: tvModeBody } },
    async (req) => setTvMode(req.body.mode, req.body.payload, req.body.expiresAt ?? null),
  );
}
