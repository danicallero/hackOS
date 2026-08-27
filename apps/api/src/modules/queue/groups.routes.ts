import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { NotFoundError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { assertFixtureQueueScope } from "../logistics/review-fixture-scope.js";
import {
  assertCanManageEnterpriseJudging,
  requireEnterpriseJudgeManager,
} from "../sponsors/access.js";
import { actor } from "./actor.js";
import {
  assignableRooms,
  listEnterpriseQueueGroups,
  mergeQueueGroups,
  previewMergedPanel,
  setQueueGroupRooms,
  splitQueueGroup,
  updateQueueGroup,
} from "./group-merge.js";
import { queueGroupEnterpriseId } from "./groups.js";
import { queueGroupQueue } from "./reads.js";
import {
  enterpriseQueueGroupParam,
  mergeQueueGroupsBody,
  previewMergeBody,
  queueGroupIdParam,
  queueGroupRoomsBody,
  updateQueueGroupBody,
} from "./schemas.js";
import { clearQueueGroup, enqueueQueueGroup } from "./service.js";

const enterpriseParam = { source: "params", field: "id" } as const;
const enterpriseIdParam = z.object({ id: z.coerce.number().int().positive() });

function auditRequest(req: FastifyRequest) {
  return {
    ip: req.ip,
    userAgent:
      typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
  };
}

/**
 * Queue-group configuration (H46): merging an enterprise's challenges into
 * one shared judging queue, splitting them back apart, and reviewing the
 * merged judging form. Enterprise-scoped and gated by the same grant as the
 * judge roster — a global queue/sponsor admin, or the enterprise's own reps.
 */
export function registerQueueGroupRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const enterprisePolicy = {
    kind: "contextual",
    policy: "enterprise-judge-manage",
    resource: enterpriseParam,
  } as const;
  const enterprisePreviewPolicy = {
    ...enterprisePolicy,
    emailVerification: "none",
  } as const;

  typed.get(
    "/api/enterprises/:id/queue-groups",
    {
      preHandler: requireEnterpriseJudgeManager(enterpriseParam),
      config: { routeAccessPolicy: enterprisePolicy },
      schema: {
        params: enterpriseIdParam,
        summary: "List the enterprise's judging queues",
        description:
          "Every queue group the enterprise runs, with the challenges feeding each one, the rooms serving it, its merged judging form, and whether judging has already started for it. An enterprise with a single challenge has exactly one group and no choice to make; more than one group, or a group with more than one challenge, is what the shared-queue configuration screen edits.",
      },
    },
    async (req) => ({ groups: await listEnterpriseQueueGroups(req.params.id) }),
  );

  typed.post(
    "/api/enterprises/:id/queue-groups/preview-merge",
    {
      preHandler: requireEnterpriseJudgeManager(enterpriseParam),
      config: { routeAccessPolicy: enterprisePreviewPolicy },
      schema: {
        params: enterpriseIdParam,
        body: previewMergeBody,
        summary: "Preview a merged judging form",
        description:
          "The judging form merging this enterprise's challenges would produce, without writing anything: the de-duplicated union of their questions, how many duplicates were folded away, and any question key renamed because two different questions claimed it. Challenges outside the authorized enterprise are refused. Feeds the review step shown before the merge is confirmed.",
      },
    },
    async (req) => previewMergedPanel(req.params.id, req.body.challengeIds),
  );

  typed.post(
    "/api/enterprises/:id/queue-groups/merge",
    {
      preHandler: [requireEnterpriseJudgeManager(enterpriseParam), idempotencyGuard],
      config: { routeAccessPolicy: enterprisePolicy },
      schema: {
        params: enterpriseIdParam,
        body: mergeQueueGroupsBody,
        summary: "Merge challenges into one shared judging queue",
        description:
          "Moves the named challenges into a single queue group called `displayName`, renumbers their queues into one shared ordering, hands the rooms that served the absorbed queues to the merged one, and stores the de-duplicated union of their judging forms as the group's own. Teams queued for more than one of the merged challenges are called once from then on, not once per challenge. Every challenge must belong to this enterprise, and the merge is refused once judging has started for any of them.",
      },
    },
    async (req, reply) => {
      const result = await mergeQueueGroups({
        enterpriseId: req.params.id,
        challengeIds: req.body.challengeIds,
        displayName: req.body.displayName,
        actorId: actor(req.userId),
        request: auditRequest(req),
      });
      reply.code(201);
      return result;
    },
  );

  typed.post(
    "/api/enterprises/:id/queue-groups/:queueGroupId/split",
    {
      preHandler: [requireEnterpriseJudgeManager(enterpriseParam), idempotencyGuard],
      config: { routeAccessPolicy: enterprisePolicy },
      schema: {
        params: enterpriseQueueGroupParam,
        summary: "Split a shared queue back into one queue per challenge",
        description:
          "Gives every challenge in the group its own queue again, each named after its challenge and scored with its own judging form; the merged form is discarded. Rooms keep serving the group that remains. Refused once judging has started for any of the group's challenges.",
      },
    },
    async (req) => ({
      groups: await splitQueueGroup({
        enterpriseId: req.params.id,
        queueGroupId: req.params.queueGroupId,
        actorId: actor(req.userId),
        request: auditRequest(req),
      }),
    }),
  );

  typed.get(
    "/api/queue/groups/:queueGroupId/queue",
    {
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-group-manage",
          resource: { source: "params", field: "queueGroupId" },
        },
      },
      schema: {
        params: queueGroupIdParam,
        summary: "Read a judging queue in order",
        description:
          "Every team in the queue, in the order it will be called, with the position and status each currently holds and the room it was called into. A team queued for several challenges of a shared queue is one line, at its best position, naming every challenge it is in — the same dedupe the callable queue applies. Unlike a room's view this is keyed by the queue itself, so it also covers a queue no room serves yet and shows a queue served by two rooms once.",
      },
    },
    async (req) => {
      await assertFixtureQueueScope(
        pool,
        req.userId as number,
        "queueGroup",
        req.params.queueGroupId,
      );
      const enterpriseId = await queueGroupEnterpriseId(pool, req.params.queueGroupId);
      if (enterpriseId == null) {
        throw new NotFoundError("Queue group not found", { queueGroupId: req.params.queueGroupId });
      }
      await assertCanManageEnterpriseJudging(req, enterpriseId);
      return queueGroupQueue(req.params.queueGroupId);
    },
  );

  typed.post(
    "/api/queue/groups/:queueGroupId/generate",
    {
      preHandler: idempotencyGuard,
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-group-manage",
          resource: { source: "params", field: "queueGroupId" },
        },
      },
      schema: {
        params: queueGroupIdParam,
        summary: "Generate one judging queue",
        description:
          "Adds eligible projects for every challenge in this queue group. Existing waiting, called and evaluated teams keep their current positions; repeated generation only appends projects not already queued.",
      },
    },
    async (req) => {
      await assertFixtureQueueScope(
        pool,
        req.userId as number,
        "queueGroup",
        req.params.queueGroupId,
      );
      const enterpriseId = await queueGroupEnterpriseId(pool, req.params.queueGroupId);
      if (enterpriseId == null) {
        throw new NotFoundError("Queue group not found", { queueGroupId: req.params.queueGroupId });
      }
      await assertCanManageEnterpriseJudging(req, enterpriseId);
      return enqueueQueueGroup(req.params.queueGroupId, actor(req.userId));
    },
  );

  typed.delete(
    "/api/queue/groups/:queueGroupId/entries",
    {
      preHandler: idempotencyGuard,
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-group-manage",
          resource: { source: "params", field: "queueGroupId" },
        },
      },
      schema: {
        params: queueGroupIdParam,
        summary: "Clear one judging queue",
        description:
          "Removes waiting and called teams from this queue while preserving the queue group and its configuration. It is refused after the first evaluation or while a team is in a judging room; a later generation can restore entries cleared by this action at the end of the queue.",
      },
    },
    async (req) => {
      await assertFixtureQueueScope(
        pool,
        req.userId as number,
        "queueGroup",
        req.params.queueGroupId,
      );
      const enterpriseId = await queueGroupEnterpriseId(pool, req.params.queueGroupId);
      if (enterpriseId == null) {
        throw new NotFoundError("Queue group not found", { queueGroupId: req.params.queueGroupId });
      }
      await assertCanManageEnterpriseJudging(req, enterpriseId);
      return clearQueueGroup(req.params.queueGroupId, actor(req.userId));
    },
  );

  typed.get(
    "/api/enterprises/:id/assignable-rooms",
    {
      preHandler: requireEnterpriseJudgeManager(enterpriseParam),
      config: { routeAccessPolicy: enterprisePolicy },
      schema: {
        params: enterpriseIdParam,
        summary: "List rooms this enterprise can route a queue to",
        description:
          "Rooms already serving one of the enterprise's queues, plus every room serving nothing yet, each with the queue it currently serves. Rooms held by another enterprise are excluded: moving a room between enterprises is a venue decision made on the rooms screen, not from a queue.",
      },
    },
    async (req) => ({ rooms: await assignableRooms(req.params.id) }),
  );

  typed.put(
    "/api/queue/groups/:queueGroupId/rooms",
    {
      preHandler: idempotencyGuard,
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-group-manage",
          resource: { source: "params", field: "queueGroupId" },
        },
      },
      schema: {
        params: queueGroupIdParam,
        body: queueGroupRoomsBody,
        summary: "Set which rooms serve this queue",
        description:
          "Replaces the queue's whole room set: rooms named here start serving it, rooms it held and are not named stop serving anything. A room serves one queue at a time, so naming a room takes it from another queue of the same enterprise; a room serving a different enterprise is refused. This is how a sponsor routes their own queues — an enterprise with two rooms can put both, one, or neither behind a given queue.",
      },
    },
    async (req) => {
      await assertFixtureQueueScope(
        pool,
        req.userId as number,
        "queueGroup",
        req.params.queueGroupId,
      );
      const enterpriseId = await queueGroupEnterpriseId(pool, req.params.queueGroupId);
      if (enterpriseId == null) {
        throw new NotFoundError("Queue group not found", { queueGroupId: req.params.queueGroupId });
      }
      await assertCanManageEnterpriseJudging(req, enterpriseId);
      return setQueueGroupRooms({
        queueGroupId: req.params.queueGroupId,
        roomIds: req.body.roomIds,
        actorId: actor(req.userId),
        request: auditRequest(req),
      });
    },
  );

  typed.patch(
    "/api/queue/groups/:queueGroupId",
    {
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-group-manage",
          resource: { source: "params", field: "queueGroupId" },
        },
      },
      schema: {
        params: queueGroupIdParam,
        body: updateQueueGroupBody,
        summary: "Rename a shared queue or edit its judging form",
        description:
          "Saves the admin's review of a merged group: the name judges, teams and venue screens see, and the questions its single judging form asks. Only a shared group has either — a one-challenge group is named by its challenge and scored by that challenge's own form. Permitted for a global queue/sponsor administrator or a representative of the group's enterprise.",
      },
    },
    async (req) => {
      await assertFixtureQueueScope(
        pool,
        req.userId as number,
        "queueGroup",
        req.params.queueGroupId,
      );
      const enterpriseId = await queueGroupEnterpriseId(pool, req.params.queueGroupId);
      if (enterpriseId == null) {
        throw new NotFoundError("Queue group not found", { queueGroupId: req.params.queueGroupId });
      }
      await assertCanManageEnterpriseJudging(req, enterpriseId);
      return updateQueueGroup({
        queueGroupId: req.params.queueGroupId,
        displayName: req.body.displayName,
        criteria: req.body.criteria,
        actorId: actor(req.userId),
        request: auditRequest(req),
      });
    },
  );
}
