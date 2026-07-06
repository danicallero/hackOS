import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { subscribe } from "../../lib/sse.js";
import { requireAnyCapability } from "./access.js";
import {
  allRoomViews,
  challengeProgress,
  myQueueStatus,
  roomAssignments,
  roomPace,
  roomView,
} from "./reads.js";
import { challengeIdParam, roomIdParam, tvModeBody } from "./schemas.js";
import { getTvMode, setTvMode } from "./tv.js";

/** Read APIs (H38-H42): progress, room views, participant status, pace, SSE streams, TV mode. */
export function registerReadsRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const judgeOrOperate = requireAnyCapability(
    CAPABILITIES.JUDGE_PANEL,
    CAPABILITIES.QUEUE_OPERATE,
    CAPABILITIES.QUEUE_ADMIN,
  );

  // H40: progress panel per challenge.
  typed.get(
    "/api/queue/challenges/:challengeId/progress",
    { preHandler: judgeOrOperate, schema: { params: challengeIdParam } },
    async (req) => challengeProgress(req.params.challengeId),
  );

  // H41: full room view for operator panels; also the TV data source.
  typed.get(
    "/api/queue/rooms/:roomId/view",
    { preHandler: judgeOrOperate, schema: { params: roomIdParam } },
    async (req) => roomView(req.params.roomId),
  );

  // H46: authoritative room assignment surface for the admin panel.
  typed.get(
    "/api/queue/rooms/:roomId/assignments",
    { preHandler: requireCapability(CAPABILITIES.QUEUE_ADMIN), schema: { params: roomIdParam } },
    async (req) => roomAssignments(req.params.roomId),
  );

  // H39: pace check.
  typed.get(
    "/api/queue/rooms/:roomId/pace",
    { preHandler: judgeOrOperate, schema: { params: roomIdParam } },
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

  // Personal stream (H31/H38 aviso/pre-aviso): only your own topic.
  typed.get("/api/queue/me/stream", { preHandler: requireAuth }, async (req, reply) => {
    await subscribe(`user:${req.userId}`, reply);
  });

  // H42: TV mode state in Valkey.
  typed.get("/api/tv/mode", async () => getTvMode());

  typed.patch(
    "/api/tv/mode",
    { preHandler: requireCapability(CAPABILITIES.TV_CONTROL), schema: { body: tvModeBody } },
    async (req) => setTvMode(req.body.mode, req.body.payload),
  );
}
