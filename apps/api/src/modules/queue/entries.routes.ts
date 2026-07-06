import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireCapability } from "../../lib/capabilities.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { requireAnyCapability } from "./access.js";
import { entryHistory } from "./reads.js";
import {
  callNextBody,
  entryIdParam,
  manualCallBody,
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
  moveToTop,
  notifyEnter,
  reEnter,
  requeue,
  sendBackToWaiting,
  skipToEnd,
  startPresentation,
} from "./service.js";

function actor(userId: number | null): number {
  if (userId == null) throw new UnauthorizedError();
  return userId;
}

/**
 * Queue state machine transitions (H29-H35, H37). Every POST here is a
 * critical mutation: idempotencyGuard + withTransaction/FOR UPDATE inside
 * the service layer; exactly one queue_history row + one broadcast each.
 */
export function registerEntriesRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const operate = requireCapability(CAPABILITIES.QUEUE_OPERATE);
  const judgeOrOperate = requireAnyCapability(CAPABILITIES.JUDGE_PANEL, CAPABILITIES.QUEUE_OPERATE);
  const judge = requireCapability(CAPABILITIES.JUDGE_PANEL);

  // H29/H30: call the next eligible team of the room's shared queue(s).
  typed.post(
    "/api/queue/rooms/:roomId/call-next",
    {
      preHandler: [operate, idempotencyGuard],
      schema: { params: roomIdParam, body: callNextBody },
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
    { preHandler: [judgeOrOperate, idempotencyGuard], schema: { params: entryIdParam } },
    async (req) => notifyEnter(req.params.entryId, actor(req.userId)),
  );

  // H32: bring in (no clock) then start (clock running).
  typed.post(
    "/api/queue/entries/:entryId/bring-in",
    { preHandler: [judge, idempotencyGuard], schema: { params: entryIdParam } },
    async (req) => bringIn(req.params.entryId, actor(req.userId)),
  );

  typed.post(
    "/api/queue/entries/:entryId/start",
    { preHandler: [judge, idempotencyGuard], schema: { params: entryIdParam } },
    async (req) => startPresentation(req.params.entryId, actor(req.userId)),
  );

  typed.post(
    "/api/queue/entries/:entryId/complete",
    { preHandler: [judge, idempotencyGuard], schema: { params: entryIdParam } },
    async (req) => completePresentation(req.params.entryId, actor(req.userId)),
  );

  // H33: in_room|presenting -> called (top), keeps their turn.
  typed.post(
    "/api/queue/entries/:entryId/send-back",
    {
      preHandler: [judgeOrOperate, idempotencyGuard],
      schema: { params: entryIdParam, body: reasonBody },
    },
    async (req) => sendBackToWaiting(req.params.entryId, actor(req.userId), req.body.reason),
  );

  // H33: called -> waiting, top|bottom.
  typed.post(
    "/api/queue/entries/:entryId/requeue",
    {
      preHandler: [judgeOrOperate, idempotencyGuard],
      schema: { params: entryIdParam, body: requeueBody },
    },
    async (req) =>
      requeue(req.params.entryId, actor(req.userId), req.body.position, req.body.reason),
  );

  // H33: recover a forgotten team from a terminal state. Manual + audited.
  typed.post(
    "/api/queue/entries/:entryId/re-enter",
    {
      preHandler: [operate, idempotencyGuard],
      schema: { params: entryIdParam, body: requeueBody.extend(requiredReasonBody.shape) },
    },
    async (req) =>
      reEnter(req.params.entryId, actor(req.userId), req.body.position, req.body.reason),
  );

  // H34: human no-show decision — operator AND judge views. Bottom + ladder.
  typed.post(
    "/api/queue/entries/:entryId/no-show",
    {
      preHandler: [judgeOrOperate, idempotencyGuard],
      schema: { params: entryIdParam, body: reasonBody },
    },
    async (req) => markNoShow(req.params.entryId, actor(req.userId), req.body.reason),
  );

  // H37: send a searched team to the TOP of the challenge queue (release from
  // `called` if needed). "Adding" only moves the existing entry.
  typed.post(
    "/api/queue/entries/:entryId/move-top",
    {
      preHandler: [judgeOrOperate, idempotencyGuard],
      schema: { params: entryIdParam, body: reasonBody },
    },
    async (req) => moveToTop(req.params.entryId, actor(req.userId), req.body.reason),
  );

  // Voluntary "send me to the end" — no ladder penalty (plan/07 §4).
  typed.post(
    "/api/queue/entries/:entryId/skip",
    {
      preHandler: [operate, idempotencyGuard],
      schema: { params: entryIdParam, body: reasonBody },
    },
    async (req) => skipToEnd(req.params.entryId, actor(req.userId), req.body.reason),
  );

  // H34: manual disqualification for repeated no-shows. Audited.
  typed.post(
    "/api/queue/entries/:entryId/disqualify",
    {
      preHandler: [requireCapability(CAPABILITIES.QUEUE_ADMIN), idempotencyGuard],
      schema: { params: entryIdParam, body: requiredReasonBody },
    },
    async (req) => disqualify(req.params.entryId, actor(req.userId), req.body.reason),
  );

  typed.post(
    "/api/queue/entries/:entryId/cancel",
    {
      preHandler: [requireCapability(CAPABILITIES.QUEUE_ADMIN), idempotencyGuard],
      schema: { params: entryIdParam, body: reasonBody },
    },
    async (req) => cancelEntry(req.params.entryId, actor(req.userId), req.body.reason),
  );

  // H37: manually call ANY team to called or in_room regardless of position.
  typed.post(
    "/api/queue/entries/:entryId/manual-call",
    {
      preHandler: [judgeOrOperate, idempotencyGuard],
      schema: { params: entryIdParam, body: manualCallBody },
    },
    async (req) =>
      manualCall(
        req.params.entryId,
        actor(req.userId),
        req.body.targetStatus,
        req.body.roomId,
        req.body.reason,
      ),
  );

  // H34: per-entry requeue/no-show history (from queue_history).
  typed.get(
    "/api/queue/entries/:entryId/history",
    { preHandler: judgeOrOperate, schema: { params: entryIdParam } },
    async (req) => entryHistory(req.params.entryId),
  );
}
