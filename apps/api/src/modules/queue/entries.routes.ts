import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../db/pool.js";
import { requireCapability } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { actor } from "./actor.js";
import { requireEntryJudgeOrCapability } from "./contextual-access.js";
import { scheduleTopUp } from "./pump.js";
import { entryHistory } from "./reads.js";
import {
  callNextBody,
  entryIdParam,
  manualCallBody,
  moveToPositionBody,
  reasonBody,
  requeueBody,
  requiredReasonBody,
  roomIdParam,
} from "./schemas.js";
import {
  bringIn,
  callNextForRoom,
  cancelEntry,
  completePresentation,
  disqualify,
  manualCall,
  markNoShow,
  moveToPosition,
  moveToTop,
  notifyEnter,
  reEnter,
  remindWaitingRoom,
  requeue,
  sendBackToWaiting,
  setPresentationPaused,
  skipToEnd,
  startPresentation,
} from "./service.js";
import type { QueueEntryRow } from "./types.js";

/**
 * Runs a queue transition, then immediately tops up the affected room's waiting
 * area so a freed slot refills without waiting for the 5s pump (H29/H30/H35).
 * The room is captured BEFORE the transition (requeue/no-show null the entry's
 * assigned_room_id) with the post-transition room as fallback (manual-call from
 * `waiting` only gains a room after). Top-up is fire-and-forget — it never
 * fails the user's original action.
 */
async function transitionAndTopUp(
  entryId: number,
  run: () => Promise<QueueEntryRow>,
): Promise<QueueEntryRow> {
  // One cheap read for the pre-transition room. The fixture boundary is
  // enforced by the route's contextual guard and again under the entry lock
  // inside `run`, and the top-up resolves its own room marker, so no scope
  // re-check is repeated here.
  const { rows } = await pool.query(`SELECT assigned_room_id FROM queue_entries WHERE id = $1`, [
    entryId,
  ]);
  const roomBefore = (rows[0]?.assigned_room_id as number | null) ?? null;
  const entry = await run();
  const roomId = roomBefore ?? entry.assigned_room_id;
  if (roomId != null) await scheduleTopUp(roomId);
  return entry;
}

/** A top-of-challenge move should immediately fill any open waiting-room slot. */
async function moveToTopAndTopUp(run: () => Promise<QueueEntryRow>): Promise<QueueEntryRow> {
  const entry = await run();
  // H46: every room serving this challenge's queue_group has a slot that a
  // top-of-queue move could fill.
  const { rows } = await pool.query(
    `SELECT rqg.room_id
       FROM queue_group_challenges self
       JOIN room_queue_groups rqg ON rqg.queue_group_id = self.queue_group_id
      WHERE self.challenge_id = $1
      ORDER BY rqg.room_id ASC`,
    [entry.challenge_id],
  );
  await Promise.all(rows.map((row: { room_id: number }) => scheduleTopUp(row.room_id)));
  return entry;
}

/**
 * Queue state machine transitions (H29-H35, H37). Every POST here is a
 * critical mutation: idempotencyGuard + withTransaction/FOR UPDATE inside
 * the service layer; exactly one queue_history row + one broadcast each.
 */
export function registerEntriesRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const operate = requireCapability(CAPABILITIES.QUEUE_OPERATE);
  const judgeOrOperate = requireEntryJudgeOrCapability(
    CAPABILITIES.JUDGE_PANEL,
    CAPABILITIES.QUEUE_OPERATE,
  );
  const judge = requireEntryJudgeOrCapability(CAPABILITIES.JUDGE_PANEL);

  // H29/H30: call the next eligible team of the room's shared queue(s).
  typed.post(
    "/api/queue/rooms/:roomId/call-next",
    {
      preHandler: [operate, idempotencyGuard],
      config: { routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.QUEUE_OPERATE } },
      schema: {
        params: roomIdParam,
        body: callNextBody,
        summary: "Call the next available team",
        description:
          "Calls the next eligible waiting team, skipping teams whose members are already called, in a room or presenting in any room, including the destination. Skipped teams keep their position. Force bypasses waiting-area capacity only.",
      },
    },
    async (req) => {
      const entry = await callNextForRoom(actor(req.userId), req.params.roomId, {
        force: req.body.force,
      });
      return { called: entry !== null, entry };
    },
  );

  // H31: "que entre" — notification only, no status transition.
  typed.post(
    "/api/queue/entries/:entryId/notify-enter",
    {
      preHandler: [judgeOrOperate, idempotencyGuard],
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-operate",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: {
        summary: "Tell a team to enter",
        description:
          "Notification only (H31): pings the team that it can come in. The entry keeps its status; replays with the same idempotency key return the original result.",
        params: entryIdParam,
      },
    },
    async (req) => notifyEnter(req.params.entryId, actor(req.userId)),
  );

  // H29: remind a called team to come to the waiting room again; no status transition.
  typed.post(
    "/api/queue/entries/:entryId/remind-waiting",
    {
      preHandler: [judgeOrOperate, idempotencyGuard],
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-operate",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: {
        summary: "Remind a called team",
        description:
          "Notification only (H29): asks a called team to come back to the waiting room. The entry keeps its status.",
        params: entryIdParam,
      },
    },
    async (req) => remindWaitingRoom(req.params.entryId, actor(req.userId)),
  );

  // H32: bring in (no clock) then start (clock running).
  typed.post(
    "/api/queue/entries/:entryId/bring-in",
    {
      preHandler: [judge, idempotencyGuard],
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-judge",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: {
        summary: "Bring a called team into the room",
        description:
          "Moves a called team to `in_room` without starting the presentation clock (H32). Freed waiting-area slots are refilled right after.",
        params: entryIdParam,
      },
    },
    async (req) =>
      transitionAndTopUp(req.params.entryId, () => bringIn(req.params.entryId, actor(req.userId))),
  );

  typed.post(
    "/api/queue/entries/:entryId/start",
    {
      preHandler: [judge, idempotencyGuard],
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-judge",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: {
        summary: "Start the presentation",
        description:
          "Moves the team to `presenting` and starts the authoritative presentation clock (H32).",
        params: entryIdParam,
      },
    },
    async (req) => startPresentation(req.params.entryId, actor(req.userId)),
  );

  // #926: same contextual judge authorization and replay contract as start.
  for (const [action, paused] of [
    ["pause-timer", true],
    ["resume-timer", false],
  ] as const) {
    typed.post(
      `/api/queue/entries/:entryId/${action}`,
      {
        preHandler: [judge, idempotencyGuard],
        config: {
          routeAccessPolicy: {
            kind: "contextual",
            policy: "queue-entry-judge",
            resource: { source: "params", field: "entryId" },
          },
        },
        schema: {
          params: entryIdParam,
          summary: paused ? "Pause presentation timer" : "Resume presentation timer",
          description:
            "Updates the authoritative presentation clock without changing queue status or room pause. Requires an active presentation; retries with the same idempotency key replay the original result.",
        },
      },
      async (req) => setPresentationPaused(req.params.entryId, actor(req.userId), paused),
    );
  }

  typed.post(
    "/api/queue/entries/:entryId/complete",
    {
      preHandler: [judge, idempotencyGuard],
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-judge",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: {
        summary: "Complete the presentation",
        description:
          "Closes the presentation and frees the room slot, which is refilled right after (H32).",
        params: entryIdParam,
      },
    },
    async (req) =>
      transitionAndTopUp(req.params.entryId, () =>
        completePresentation(req.params.entryId, actor(req.userId)),
      ),
  );

  // H33: in_room|presenting -> called (top), keeps their turn. Re-queueing a
  // team that already reached the room/stage is a judging decision — it lives
  // in the Judging Panel only, never in the global Queue Operations view, so
  // QUEUE_OPERATE alone is not enough here (#59).
  typed.post(
    "/api/queue/entries/:entryId/send-back",
    {
      preHandler: [judge, idempotencyGuard],
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-judge",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: {
        summary: "Send a team back to called",
        description:
          "Returns an `in_room` or `presenting` team to the top of the called list, keeping its turn, and resets its clock (H33). Judging decision: needs the judge view, not queue operation alone.",
        params: entryIdParam,
        body: reasonBody,
      },
    },
    async (req) =>
      transitionAndTopUp(req.params.entryId, () =>
        sendBackToWaiting(req.params.entryId, actor(req.userId), req.body.reason),
      ),
  );

  // H33: called -> waiting, top|bottom.
  typed.post(
    "/api/queue/entries/:entryId/requeue",
    {
      preHandler: [judgeOrOperate, idempotencyGuard],
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-operate",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: {
        summary: "Requeue a called team",
        description:
          "Moves a `called` team back to `waiting` at the top or bottom of its queue, with an optional reason (H33).",
        params: entryIdParam,
        body: requeueBody,
      },
    },
    async (req) =>
      transitionAndTopUp(req.params.entryId, () =>
        requeue(req.params.entryId, actor(req.userId), req.body.position, req.body.reason),
      ),
  );

  // H33: recover a forgotten team from a terminal state. Manual + audited.
  typed.post(
    "/api/queue/entries/:entryId/re-enter",
    {
      preHandler: [operate, idempotencyGuard],
      config: { routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.QUEUE_OPERATE } },
      schema: {
        summary: "Re-enter a team from a terminal state",
        description:
          "Puts a team that is `completed`, `cancelled` or `disqualified` back in `waiting` at the top or bottom. Manual and audited; the reason is required (H33).",
        params: entryIdParam,
        body: requeueBody.extend(requiredReasonBody.shape),
      },
    },
    async (req) =>
      reEnter(req.params.entryId, actor(req.userId), req.body.position, req.body.reason),
  );

  // H34: human no-show decision — operator AND judge views. Bottom + ladder.
  typed.post(
    "/api/queue/entries/:entryId/no-show",
    {
      preHandler: [judgeOrOperate, idempotencyGuard],
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-operate",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: {
        summary: "Mark a team as no-show",
        description:
          "Human no-show decision for a `called` or `in_room` team, available to judges and operators (H34): the team goes to the bottom of the queue and its call count rises; it is never eliminated automatically.",
        params: entryIdParam,
        body: reasonBody,
      },
    },
    async (req) =>
      transitionAndTopUp(req.params.entryId, () =>
        markNoShow(req.params.entryId, actor(req.userId), req.body.reason),
      ),
  );

  // H37: send a searched team to the TOP of the challenge queue (release from
  // `called` if needed). "Adding" only moves the existing entry.
  typed.post(
    "/api/queue/entries/:entryId/move-top",
    {
      preHandler: [judgeOrOperate, idempotencyGuard],
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-operate",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: {
        summary: "Move a team to the top of the queue",
        description:
          "Sends a searched team to the top of its challenge queue, releasing it from `called` if needed. Only moves the existing entry; no second entry is created (H37).",
        params: entryIdParam,
        body: reasonBody,
      },
    },
    async (req) =>
      moveToTopAndTopUp(() => moveToTop(req.params.entryId, actor(req.userId), req.body.reason)),
  );

  // Drag-free reordering: put a team at an explicit place in its queue.
  typed.post(
    "/api/queue/entries/:entryId/move-to",
    {
      preHandler: [judgeOrOperate, idempotencyGuard],
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-operate",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: {
        params: entryIdParam,
        body: moveToPositionBody,
        summary: "Move a team to a place in its queue",
        description:
          "Puts the team at the given 1-based place among the challenge's waiting teams, renumbering the rest around it — the number given here counts only teams still waiting to enter the waiting room, exactly like every surface's displayed position, regardless of any `called` teams interleaved in the underlying ordering. Out-of-range values are clamped to the ends rather than rejected. The team returns to `waiting` and leaves any waiting area it was called into.",
      },
    },
    async (req) =>
      transitionAndTopUp(req.params.entryId, () =>
        moveToPosition(req.params.entryId, actor(req.userId), req.body.position, req.body.reason),
      ),
  );

  // Voluntary "send me to the end" — no ladder penalty (plan/07 §4).
  typed.post(
    "/api/queue/entries/:entryId/skip",
    {
      preHandler: [judgeOrOperate, idempotencyGuard],
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-operate",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: {
        summary: "Send a team to the end of the queue",
        description:
          "Voluntary skip: the team goes to the end of its queue without a no-show ladder penalty (plan/07 section 4).",
        params: entryIdParam,
        body: reasonBody,
      },
    },
    async (req) => skipToEnd(req.params.entryId, actor(req.userId), req.body.reason),
  );

  // H34: manual disqualification for repeated no-shows. Audited.
  typed.post(
    "/api/queue/entries/:entryId/disqualify",
    {
      preHandler: [requireCapability(CAPABILITIES.QUEUE_ADMIN), idempotencyGuard],
      config: { routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.QUEUE_ADMIN } },
      schema: {
        summary: "Disqualify a team",
        description:
          "Manual disqualification after repeated no-shows. Needs queue admin, a reason, and is audited (H34).",
        params: entryIdParam,
        body: requiredReasonBody,
      },
    },
    async (req) => disqualify(req.params.entryId, actor(req.userId), req.body.reason),
  );

  typed.post(
    "/api/queue/entries/:entryId/cancel",
    {
      preHandler: [requireCapability(CAPABILITIES.QUEUE_ADMIN), idempotencyGuard],
      config: { routeAccessPolicy: { kind: "capability", capability: CAPABILITIES.QUEUE_ADMIN } },
      schema: {
        summary: "Cancel a queue entry",
        description: "Cancels the entry. Needs queue admin; the reason is optional.",
        params: entryIdParam,
        body: reasonBody,
      },
    },
    async (req) => cancelEntry(req.params.entryId, actor(req.userId), req.body.reason),
  );

  // H37: manually call ANY team to called or in_room regardless of position.
  typed.post(
    "/api/queue/entries/:entryId/manual-call",
    {
      preHandler: [judgeOrOperate, idempotencyGuard],
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-operate",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: {
        summary: "Call any team manually",
        description:
          "Calls any team to `called` or `in_room` regardless of its position (H37). Fails when the room already has an active team or a team member is busy in another room (H30).",
        params: entryIdParam,
        body: manualCallBody,
      },
    },
    async (req) =>
      transitionAndTopUp(req.params.entryId, () =>
        manualCall(
          req.params.entryId,
          actor(req.userId),
          req.body.targetStatus,
          req.body.roomId,
          req.body.reason,
        ),
      ),
  );

  // H34: per-entry requeue/no-show history (from queue_history).
  typed.get(
    "/api/queue/entries/:entryId/history",
    {
      preHandler: judgeOrOperate,
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-operate",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: {
        summary: "Entry history",
        description:
          "Requeue, no-show and other transitions of one entry, from the queue history (H34).",
        params: entryIdParam,
      },
    },
    async (req) => entryHistory(req.params.entryId, actor(req.userId)),
  );
}
