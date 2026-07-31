import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireCapability } from "../../lib/capabilities.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { requireAnyCapability } from "./access.js";
import {
  accessibleRoomIds,
  requireRoomAccessOrCapability,
  requireRoomJudgeManager,
  requireRoomJudgeOrCapability,
  requireRoomListAccess,
} from "./contextual-access.js";
import { scheduleTopUp } from "./pump.js";
import {
  assignChallengeBody,
  assignJudgeBody,
  challengeIdParam,
  createRoomBody,
  enqueueChallengeBody,
  queueSettingsBody,
  roomChallengeParam,
  roomIdParam,
  roomJudgeParam,
  roomQueueStateBody,
  updateRoomBody,
} from "./schemas.js";
import { enqueueChallenge, pauseRoom, resumeRoom } from "./service.js";

function auditRequest(req: FastifyRequest) {
  return {
    ip: req.ip,
    userAgent:
      typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
  };
}

/** Rooms, assignment admin, room/queue settings, enqueue (H29 admin surface). */
export function registerRoomsRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  // ── rooms CRUD ─────────────────────────────────────────────────────────
  typed.post(
    "/api/queue/rooms",
    {
      preHandler: requireCapability(CAPABILITIES.QUEUE_ADMIN),
      config: { routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.QUEUE_ADMIN } },
      schema: { body: createRoomBody },
    },
    async (req, reply) => {
      const { name, slug, location } = req.body;
      const { rows } = await pool.query(
        `INSERT INTO rooms (name, slug, location) VALUES ($1, $2, $3) RETURNING *`,
        [name, slug, location ?? null],
      );
      const room = rows[0];
      // A room is not eligible for auto-fill until a judge/operator explicitly
      // resumes it from the judging panel.
      await pool.query(`INSERT INTO room_queue_state (room_id, is_paused) VALUES ($1, true)`, [
        room.id,
      ]);
      reply.code(201);
      return room;
    },
  );

  typed.get(
    "/api/queue/rooms",
    {
      preHandler: requireRoomListAccess,
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "room-list",
        },
      },
    },
    async (req) => {
      const roomIds = await accessibleRoomIds(req);
      if (roomIds === null) {
        const { rows } = await pool.query(
          `SELECT rooms.*, CASE WHEN rqs.is_paused THEN 'paused' ELSE 'active' END AS status
         FROM rooms
         LEFT JOIN room_queue_state rqs ON rqs.room_id = rooms.id
         ORDER BY rooms.id ASC`,
        );
        return rows;
      }

      const { rows } = await pool.query(
        `SELECT rooms.*, CASE WHEN rqs.is_paused THEN 'paused' ELSE 'active' END AS status
       FROM rooms
       LEFT JOIN room_queue_state rqs ON rqs.room_id = rooms.id
       WHERE rooms.id = ANY($1)
       ORDER BY rooms.id ASC`,
        [roomIds],
      );
      return rows;
    },
  );

  typed.get(
    "/api/queue/rooms/:roomId",
    {
      preHandler: requireRoomAccessOrCapability(
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
    async (req) => {
      const room = (await pool.query(`SELECT * FROM rooms WHERE id = $1`, [req.params.roomId]))
        .rows[0];
      if (!room) throw new NotFoundError("Room not found");
      const state = (
        await pool.query(`SELECT * FROM room_queue_state WHERE room_id = $1`, [req.params.roomId])
      ).rows[0];
      return { ...room, queueState: state };
    },
  );

  typed.patch(
    "/api/queue/rooms/:roomId",
    {
      preHandler: requireCapability(CAPABILITIES.QUEUE_ADMIN),
      config: { routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.QUEUE_ADMIN } },
      schema: { params: roomIdParam, body: updateRoomBody },
    },
    async (req) => {
      const fields = req.body;
      const existing = (await pool.query(`SELECT * FROM rooms WHERE id = $1`, [req.params.roomId]))
        .rows[0];
      if (!existing) throw new NotFoundError("Room not found");
      const { rows } = await pool.query(
        `UPDATE rooms SET name = $1, slug = $2, location = $3, status = $4 WHERE id = $5 RETURNING *`,
        [
          fields.name ?? existing.name,
          fields.slug ?? existing.slug,
          fields.location ?? existing.location,
          fields.status ?? existing.status,
          req.params.roomId,
        ],
      );
      return rows[0];
    },
  );

  // ── room_challenges / room_judges assignment ────────────────────────────
  typed.post(
    "/api/queue/rooms/:roomId/challenges",
    {
      preHandler: requireCapability(CAPABILITIES.QUEUE_ADMIN),
      config: { routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.QUEUE_ADMIN } },
      schema: { params: roomIdParam, body: assignChallengeBody },
    },
    async (req, reply) => {
      await withTransaction(async (client) => {
        const before = (
          await client.query(`SELECT * FROM room_challenges WHERE room_id = $1 FOR UPDATE`, [
            req.params.roomId,
          ])
        ).rows[0];
        const room = (
          await client.query(`SELECT id FROM rooms WHERE id = $1 FOR UPDATE`, [req.params.roomId])
        ).rows[0];
        if (!room) throw new NotFoundError("Room not found", { roomId: req.params.roomId });

        const challenge = (
          await client.query(`SELECT id FROM challenges WHERE id = $1 FOR UPDATE`, [
            req.body.challengeId,
          ])
        ).rows[0];
        if (!challenge) {
          throw new NotFoundError("Challenge not found", { challengeId: req.body.challengeId });
        }
        await client.query(
          `INSERT INTO room_challenges (room_id, challenge_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (room_id) DO UPDATE
             SET challenge_id = EXCLUDED.challenge_id,
                 assigned_by = EXCLUDED.assigned_by,
                 assigned_at = now()`,
          [req.params.roomId, req.body.challengeId, req.userId],
        );
        if (before && before.challenge_id !== req.body.challengeId) {
          await client.query(`DELETE FROM room_judges WHERE room_id = $1 AND challenge_id <> $2`, [
            req.params.roomId,
            req.body.challengeId,
          ]);
        }
        await audit(client, {
          actorId: req.userId,
          entityType: "room",
          entityId: req.params.roomId,
          action: "assign_challenge",
          before,
          after: { roomId: req.params.roomId, challengeId: req.body.challengeId },
          ...auditRequest(req),
        });
      });
      reply.code(201);
      return { roomId: req.params.roomId, challengeId: req.body.challengeId };
    },
  );

  typed.delete(
    "/api/queue/rooms/:roomId/challenges/:challengeId",
    {
      preHandler: requireCapability(CAPABILITIES.QUEUE_ADMIN),
      config: { routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.QUEUE_ADMIN } },
      schema: { params: roomChallengeParam },
    },
    async (req) => {
      await withTransaction(async (client) => {
        const before = (
          await client.query(
            `DELETE FROM room_challenges WHERE room_id = $1 AND challenge_id = $2 RETURNING *`,
            [req.params.roomId, req.params.challengeId],
          )
        ).rows[0];
        await client.query(`DELETE FROM room_judges WHERE room_id = $1 AND challenge_id = $2`, [
          req.params.roomId,
          req.params.challengeId,
        ]);
        await audit(client, {
          actorId: req.userId,
          entityType: "room",
          entityId: req.params.roomId,
          action: "remove_challenge",
          before,
          ...auditRequest(req),
        });
      });
      return { ok: true };
    },
  );

  typed.get(
    "/api/queue/rooms/:roomId/judge-candidates",
    {
      preHandler: requireRoomJudgeManager("room"),
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "room-judge-manage",
          resource: { source: "params", field: "roomId" },
        },
      },
      schema: { params: roomIdParam },
    },
    async () => {
      const { rows } = await pool.query(
        `SELECT id, email, name, surname
           FROM users
          ORDER BY name ASC NULLS LAST, surname ASC NULLS LAST, email ASC
          LIMIT 500`,
      );
      return { users: rows };
    },
  );

  typed.post(
    "/api/queue/rooms/:roomId/judges",
    {
      preHandler: requireRoomJudgeManager("body"),
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "room-judge-manage",
          resource: { source: "params", field: "roomId" },
        },
      },
      schema: { params: roomIdParam, body: assignJudgeBody },
    },
    async (req, reply) => {
      await withTransaction(async (client) => {
        const roomChallenge = (
          await client.query(
            `SELECT * FROM room_challenges WHERE room_id = $1 AND challenge_id = $2 FOR UPDATE`,
            [req.params.roomId, req.body.challengeId],
          )
        ).rows[0];
        if (!roomChallenge) {
          throw new NotFoundError("Room challenge assignment not found", {
            roomId: req.params.roomId,
            challengeId: req.body.challengeId,
          });
        }
        const { rows } = await client.query(
          `INSERT INTO room_judges (room_id, challenge_id, user_id, assigned_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (room_id, challenge_id, user_id) DO UPDATE
             SET assigned_by = EXCLUDED.assigned_by,
                 assigned_at = now()
           RETURNING *`,
          [req.params.roomId, req.body.challengeId, req.body.userId, req.userId],
        );
        await audit(client, {
          actorId: req.userId,
          entityType: "room_judge",
          entityId: `${req.params.roomId}:${req.body.challengeId}:${req.body.userId}`,
          action: "assign",
          after: rows[0],
          ...auditRequest(req),
        });
      });
      reply.code(201);
      return {
        roomId: req.params.roomId,
        challengeId: req.body.challengeId,
        userId: req.body.userId,
      };
    },
  );

  typed.delete(
    "/api/queue/rooms/:roomId/judges/:challengeId/:userId",
    {
      preHandler: requireRoomJudgeManager("params"),
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "room-judge-manage",
          resource: { source: "params", field: "roomId" },
        },
      },
      schema: { params: roomJudgeParam },
    },
    async (req) => {
      await withTransaction(async (client) => {
        const before = (
          await client.query(
            `DELETE FROM room_judges WHERE room_id = $1 AND challenge_id = $2 AND user_id = $3 RETURNING *`,
            [req.params.roomId, req.params.challengeId, req.params.userId],
          )
        ).rows[0];
        await audit(client, {
          actorId: req.userId,
          entityType: "room_judge",
          entityId: `${req.params.roomId}:${req.params.challengeId}:${req.params.userId}`,
          action: "remove",
          before,
          ...auditRequest(req),
        });
      });
      return { ok: true };
    },
  );

  // ── room_queue_state settings ────────────────────────────────────────────
  typed.patch(
    "/api/queue/rooms/:roomId/state",
    {
      preHandler: requireCapability(CAPABILITIES.QUEUE_ADMIN),
      config: { routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.QUEUE_ADMIN } },
      schema: { params: roomIdParam, body: roomQueueStateBody },
    },
    async (req) => {
      const existing = (
        await pool.query(`SELECT * FROM room_queue_state WHERE room_id = $1`, [req.params.roomId])
      ).rows[0];
      if (!existing) throw new NotFoundError("Room not found");
      const { rows } = await pool.query(
        `UPDATE room_queue_state
            SET max_in_waiting_area = $1,
                desired_minutes_per_team = $2
          WHERE room_id = $3
          RETURNING *`,
        [
          req.body.maxInWaitingArea ?? existing.max_in_waiting_area,
          req.body.desiredMinutesPerTeam ?? existing.desired_minutes_per_team,
          req.params.roomId,
        ],
      );
      return rows[0];
    },
  );

  // ── H35: pause / resume ──────────────────────────────────────────────────
  typed.post(
    "/api/queue/rooms/:roomId/pause",
    {
      preHandler: [
        requireRoomJudgeOrCapability(CAPABILITIES.QUEUE_OPERATE, CAPABILITIES.JUDGE_PANEL),
        idempotencyGuard,
      ],
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "room-operate",
          resource: { source: "params", field: "roomId" },
        },
      },
      schema: { params: roomIdParam },
    },
    async (req) => {
      if (req.userId == null) throw new ConflictError("Missing actor");
      await pauseRoom(req.params.roomId, req.userId);
      return { roomId: req.params.roomId, isPaused: true };
    },
  );

  typed.post(
    "/api/queue/rooms/:roomId/resume",
    {
      preHandler: [
        requireRoomJudgeOrCapability(CAPABILITIES.QUEUE_OPERATE, CAPABILITIES.JUDGE_PANEL),
        idempotencyGuard,
      ],
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "room-operate",
          resource: { source: "params", field: "roomId" },
        },
      },
      schema: { params: roomIdParam },
    },
    async (req) => {
      if (req.userId == null) throw new ConflictError("Missing actor");
      await resumeRoom(req.params.roomId, req.userId);
      // H35: a resumed room fills back to capacity immediately, not on the tick.
      await scheduleTopUp(req.params.roomId);
      return { roomId: req.params.roomId, isPaused: false };
    },
  );

  // ── queue_settings singleton ──────────────────────────────────────────────
  typed.get(
    "/api/queue/settings",
    {
      preHandler: requireAnyCapability(CAPABILITIES.QUEUE_OPERATE, CAPABILITIES.QUEUE_ADMIN),
      config: {
        routeAccessPolicy: {
          kind: "capability",
          anyOf: [CAPABILITIES.QUEUE_OPERATE, CAPABILITIES.QUEUE_ADMIN],
        },
      },
    },
    async () => (await pool.query(`SELECT * FROM queue_settings WHERE id = 1`)).rows[0],
  );

  typed.patch(
    "/api/queue/settings",
    {
      preHandler: requireCapability(CAPABILITIES.QUEUE_ADMIN),
      config: { routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.QUEUE_ADMIN } },
      schema: { body: queueSettingsBody },
    },
    async (req) => {
      const existing = (await pool.query(`SELECT * FROM queue_settings WHERE id = 1`)).rows[0];
      const { rows } = await pool.query(
        `UPDATE queue_settings
            SET handoff_buffer_minutes = $1, schedule_start_at = $2, schedule_end_at = $3,
                pre_call_notification_eta_minutes = $4, requeue_prompt_default = $5,
                called_too_long_threshold_minutes = $6
          WHERE id = 1
          RETURNING *`,
        [
          req.body.handoffBufferMinutes ?? existing.handoff_buffer_minutes,
          req.body.scheduleStartAt === undefined
            ? existing.schedule_start_at
            : req.body.scheduleStartAt,
          req.body.scheduleEndAt === undefined ? existing.schedule_end_at : req.body.scheduleEndAt,
          req.body.preCallNotificationEtaMinutes ?? existing.pre_call_notification_eta_minutes,
          req.body.requeuePromptDefault ?? existing.requeue_prompt_default,
          req.body.calledTooLongThresholdMinutes ?? existing.called_too_long_threshold_minutes,
        ],
      );
      return rows[0];
    },
  );

  // ── enqueue all repos of a challenge ─────────────────────────────────────
  typed.post(
    "/api/queue/challenges/:challengeId/enqueue",
    {
      preHandler: [requireCapability(CAPABILITIES.QUEUE_ADMIN), idempotencyGuard],
      config: { routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.QUEUE_ADMIN } },
      schema: { params: challengeIdParam, body: enqueueChallengeBody },
    },
    async (req) => {
      if (req.userId == null) throw new ConflictError("Missing actor");
      return enqueueChallenge(req.params.challengeId, req.userId, req.body.repoIds);
    },
  );
}
