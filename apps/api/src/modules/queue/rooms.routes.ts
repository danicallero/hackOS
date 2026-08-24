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
import { scheduleTopUp } from "./pump.js";
import {
  assignRoomEnterpriseBody,
  challengeIdParam,
  createRoomBody,
  enqueueChallengeBody,
  queueSettingsBody,
  roomIdParam,
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

  // ── room -> enterprise pool assignment (H46) ────────────────────────────
  // A room belongs to an enterprise's room pool; which of that enterprise's
  // queues (if it runs more than one) the room actually serves is a separate,
  // queue-scoped decision made from that queue's own page (Judging queues ->
  // a queue -> Rooms), reachable by admins and the enterprise's own reps.
  // Global-admin only: assigning a room to a company is a venue-planning
  // call, not a judging-configuration one.
  typed.post(
    "/api/queue/rooms/:roomId/enterprise",
    {
      preHandler: [requireCapability(CAPABILITIES.QUEUE_ADMIN), idempotencyGuard],
      config: { routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.QUEUE_ADMIN } },
      schema: {
        params: roomIdParam,
        body: assignRoomEnterpriseBody,
        summary: "Assign a room to an enterprise's room pool",
        description:
          "Puts the room in the enterprise's room pool, replacing any previous enterprise (a room belongs to one enterprise at a time). If the enterprise runs exactly one queue, the room is also wired to serve it automatically; if it runs none or several, no queue is auto-assigned — that is decided per-queue from Judging queues instead. Global-admin only.",
      },
    },
    async (req, reply) => {
      const { roomId } = req.params;
      const { enterpriseId } = req.body;
      const enterprise = (
        await pool.query(`SELECT id FROM enterprises WHERE id = $1`, [enterpriseId])
      ).rows[0];
      if (!enterprise) throw new NotFoundError("Enterprise not found", { enterpriseId });

      const result = await withTransaction(async (client) => {
        const room = (await client.query(`SELECT id FROM rooms WHERE id = $1 FOR UPDATE`, [roomId]))
          .rows[0];
        if (!room) throw new NotFoundError("Room not found", { roomId });

        const beforePool = (
          await client.query(`SELECT * FROM room_enterprises WHERE room_id = $1 FOR UPDATE`, [
            roomId,
          ])
        ).rows[0];
        await client.query(
          `INSERT INTO room_enterprises (room_id, enterprise_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (room_id) DO UPDATE
             SET enterprise_id = EXCLUDED.enterprise_id,
                 assigned_by = EXCLUDED.assigned_by,
                 assigned_at = now()`,
          [roomId, enterpriseId, req.userId],
        );
        await audit(client, {
          actorId: req.userId,
          entityType: "room",
          entityId: roomId,
          action: "assign_enterprise",
          before: beforePool,
          after: { roomId, enterpriseId },
          ...auditRequest(req),
        });

        // Auto-resolve the serving queue only when it is unambiguous.
        const groups = (
          await client.query(`SELECT id FROM queue_groups WHERE enterprise_id = $1 ORDER BY id`, [
            enterpriseId,
          ])
        ).rows;
        const beforeServing = (
          await client.query(`SELECT * FROM room_queue_groups WHERE room_id = $1 FOR UPDATE`, [
            roomId,
          ])
        ).rows[0];
        const queueGroupId = groups.length === 1 ? Number(groups[0].id) : null;

        if (queueGroupId != null) {
          await client.query(
            `INSERT INTO room_queue_groups (room_id, queue_group_id, assigned_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (room_id) DO UPDATE
               SET queue_group_id = EXCLUDED.queue_group_id,
                   assigned_by = EXCLUDED.assigned_by,
                   assigned_at = now()`,
            [roomId, queueGroupId, req.userId],
          );
        } else if (beforeServing) {
          // Ambiguous (0 or >1 queues) — clear a stale serving link rather
          // than leave the room pointed at a queue outside its new pool.
          await client.query(`DELETE FROM room_queue_groups WHERE room_id = $1`, [roomId]);
        }
        if (Number(beforeServing?.queue_group_id) !== queueGroupId) {
          await audit(client, {
            actorId: req.userId,
            entityType: "room",
            entityId: roomId,
            action: queueGroupId != null ? "assign_queue_group" : "remove_queue_group",
            before: beforeServing,
            after: queueGroupId != null ? { roomId, queueGroupId, enterpriseId } : undefined,
            ...auditRequest(req),
          });
        }
        return { roomId, enterpriseId, queueGroupId };
      });
      // The room's callable set may have just changed; fill its waiting area
      // from the group it now serves rather than waiting for the next tick.
      if (result.queueGroupId != null) await scheduleTopUp(roomId);
      reply.code(201);
      return result;
    },
  );

  typed.delete(
    "/api/queue/rooms/:roomId/enterprise",
    {
      preHandler: requireCapability(CAPABILITIES.QUEUE_ADMIN),
      config: { routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.QUEUE_ADMIN } },
      schema: {
        params: roomIdParam,
        summary: "Remove a room from its enterprise's room pool",
        description:
          "Takes the room out of its enterprise's pool and, if it was serving a queue, stops it from serving that too — a room outside an enterprise's pool cannot be pointed at one of its queues. Same permissions as assigning it.",
      },
    },
    async (req) => {
      const { roomId } = req.params;
      await withTransaction(async (client) => {
        const beforePool = (
          await client.query(`SELECT * FROM room_enterprises WHERE room_id = $1 FOR UPDATE`, [
            roomId,
          ])
        ).rows[0];
        const beforeServing = (
          await client.query(`SELECT * FROM room_queue_groups WHERE room_id = $1 FOR UPDATE`, [
            roomId,
          ])
        ).rows[0];
        await client.query(`DELETE FROM room_queue_groups WHERE room_id = $1`, [roomId]);
        await client.query(`DELETE FROM room_enterprises WHERE room_id = $1`, [roomId]);
        await audit(client, {
          actorId: req.userId,
          entityType: "room",
          entityId: roomId,
          action: "remove_enterprise",
          before: beforePool,
          ...auditRequest(req),
        });
        if (beforeServing) {
          await audit(client, {
            actorId: req.userId,
            entityType: "room",
            entityId: roomId,
            action: "remove_queue_group",
            before: beforeServing,
            ...auditRequest(req),
          });
        }
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
