import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireCapability, userHasCapability } from "../../lib/capabilities.js";
import { NotFoundError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { requireAnyCapability } from "./access.js";
import { actor } from "./actor.js";
import {
  accessibleRoomIds,
  requireRoomAccessOrCapability,
  requireRoomJudgeOrCapability,
  requireRoomListAccess,
} from "./contextual-access.js";
import { listManageableQueueGroups } from "./group-merge.js";
import { queueGroupEnterpriseId } from "./groups.js";
import { scheduleTopUp } from "./pump.js";
import {
  assignQueueGroupBody,
  challengeIdParam,
  createRoomBody,
  enqueueChallengeBody,
  queueSettingsBody,
  roomIdParam,
  roomQueueGroupParam,
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

  // ── room -> queue_group assignment (H46) ───────────────────────────────
  // A room serves one enterprise's queue group; which challenges that group
  // covers is the enterprise's business, not the room's. Assignable by a
  // global queue/sponsor admin or by a rep of the group's own enterprise.
  typed.get(
    "/api/queue/groups",
    {
      config: { routeAccessPolicy: { kind: "authenticated" } },
      schema: {
        summary: "List manageable judging queues",
        description:
          "Every judging queue the caller may manage, with the owning enterprise's name and branding, the challenges feeding it, the rooms serving it, its merged judging form, and whether judging has already started for it. The list is the caller's own scope: global queue/sponsor administrators see every queue on the platform, a sponsor representative sees only their own enterprises', and anyone else sees none. Backs both the room-assignment picker and the all-queues management view.",
      },
    },
    async (req) => {
      const userId = actor(req.userId);
      const admin =
        (await userHasCapability(userId, CAPABILITIES.QUEUE_ADMIN, req)) ||
        (await userHasCapability(userId, CAPABILITIES.SPONSORS_MANAGE, req));
      return { groups: await listManageableQueueGroups(userId, admin) };
    },
  );

  typed.post(
    "/api/queue/rooms/:roomId/queue-group",
    {
      preHandler: [requireCapability(CAPABILITIES.QUEUE_ADMIN), idempotencyGuard],
      config: { routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.QUEUE_ADMIN } },
      schema: {
        params: roomIdParam,
        body: assignQueueGroupBody,
        summary: "Assign a room to a queue group",
        description:
          "Points the room at the enterprise queue group it serves, replacing any previous assignment (a room serves one group at a time). The room's enterprise, callable challenges and judges all follow from the group. Global-admin only — sponsor representatives manage their queue group's challenges and judges, but not which rooms serve it.",
      },
    },
    async (req, reply) => {
      const { roomId } = req.params;
      const { queueGroupId } = req.body;
      const enterpriseId = await queueGroupEnterpriseId(pool, queueGroupId);
      if (enterpriseId == null) {
        throw new NotFoundError("Queue group not found", { queueGroupId });
      }

      await withTransaction(async (client) => {
        const room = (await client.query(`SELECT id FROM rooms WHERE id = $1 FOR UPDATE`, [roomId]))
          .rows[0];
        if (!room) throw new NotFoundError("Room not found", { roomId });
        const before = (
          await client.query(`SELECT * FROM room_queue_groups WHERE room_id = $1 FOR UPDATE`, [
            roomId,
          ])
        ).rows[0];

        await client.query(
          `INSERT INTO room_queue_groups (room_id, queue_group_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (room_id) DO UPDATE
             SET queue_group_id = EXCLUDED.queue_group_id,
                 assigned_by = EXCLUDED.assigned_by,
                 assigned_at = now()`,
          [roomId, queueGroupId, req.userId],
        );
        await audit(client, {
          actorId: req.userId,
          entityType: "room",
          entityId: roomId,
          action: "assign_queue_group",
          before,
          after: { roomId, queueGroupId, enterpriseId },
          ...auditRequest(req),
        });
      });
      // The room's callable set just changed; fill its waiting area from the
      // group it now serves rather than waiting for the next tick.
      await scheduleTopUp(roomId);
      reply.code(201);
      return { roomId, queueGroupId, enterpriseId };
    },
  );

  typed.delete(
    "/api/queue/rooms/:roomId/queue-group/:queueGroupId",
    {
      preHandler: requireCapability(CAPABILITIES.QUEUE_ADMIN),
      config: { routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.QUEUE_ADMIN } },
      schema: {
        params: roomQueueGroupParam,
        summary: "Unassign a room from its queue group",
        description:
          "Leaves the room serving nothing: it stops being callable for the group's challenges and grants no contextual access. Same permissions as assigning it.",
      },
    },
    async (req) => {
      const { roomId, queueGroupId } = req.params;
      const enterpriseId = await queueGroupEnterpriseId(pool, queueGroupId);
      if (enterpriseId == null) {
        throw new NotFoundError("Queue group not found", { queueGroupId });
      }

      await withTransaction(async (client) => {
        const before = (
          await client.query(
            `DELETE FROM room_queue_groups WHERE room_id = $1 AND queue_group_id = $2 RETURNING *`,
            [roomId, queueGroupId],
          )
        ).rows[0];
        await audit(client, {
          actorId: req.userId,
          entityType: "room",
          entityId: roomId,
          action: "remove_queue_group",
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
      const userId = actor(req.userId);
      await pauseRoom(req.params.roomId, userId);
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
      const userId = actor(req.userId);
      await resumeRoom(req.params.roomId, userId);
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
      const userId = actor(req.userId);
      return enqueueChallenge(req.params.challengeId, userId, req.body.repoIds);
    },
  );
}
