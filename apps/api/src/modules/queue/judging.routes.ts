import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireCapability } from "../../lib/capabilities.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { requireAnyCapability } from "./access.js";
import { exportEvaluationsCsv, exportQueueCsv } from "./exports.js";
import {
  getAttemptReview,
  joinJudgingSession,
  leaveJudgingSession,
  listActiveJudgingSessions,
  listAttemptReviewVersions,
  searchChallengeQueue,
  upsertAttemptReview,
} from "./judging.js";
import {
  challengeIdParam,
  entryIdParam,
  reviewPatchBody,
  searchQuery,
  sessionJoinBody,
} from "./schemas.js";

function actor(userId: number | null): number {
  if (userId == null) throw new UnauthorizedError();
  return userId;
}

/** Judging surface (H36, H37, H40): collaborative review, versions, presence, search, CSV. */
export function registerJudgingRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const judgePanel = requireCapability(CAPABILITIES.JUDGE_PANEL);
  const judgeOrOperate = requireAnyCapability(CAPABILITIES.JUDGE_PANEL, CAPABILITIES.QUEUE_OPERATE);

  typed.get(
    "/api/queue/entries/:entryId/review",
    { preHandler: judgePanel, schema: { params: entryIdParam } },
    async (req) => getAttemptReview(req.params.entryId),
  );

  // H36: field-level last-write-wins collaborative save; every save versioned.
  typed.patch(
    "/api/queue/entries/:entryId/review",
    { preHandler: judgePanel, schema: { params: entryIdParam, body: reviewPatchBody } },
    async (req) => upsertAttemptReview(req.params.entryId, actor(req.userId), req.body),
  );

  typed.get(
    "/api/queue/entries/:entryId/review/versions",
    { preHandler: judgePanel, schema: { params: entryIdParam } },
    async (req) => listAttemptReviewVersions(req.params.entryId),
  );

  // H36: judge presence on a ficha.
  typed.post(
    "/api/queue/entries/:entryId/session",
    { preHandler: judgePanel, schema: { params: entryIdParam, body: sessionJoinBody } },
    async (req) => joinJudgingSession(req.params.entryId, actor(req.userId), req.body.roomId),
  );

  typed.delete(
    "/api/queue/entries/:entryId/session",
    { preHandler: judgePanel, schema: { params: entryIdParam } },
    async (req) => leaveJudgingSession(req.params.entryId, actor(req.userId)),
  );

  typed.get(
    "/api/queue/entries/:entryId/sessions",
    { preHandler: judgeOrOperate, schema: { params: entryIdParam } },
    async (req) => listActiveJudgingSessions(req.params.entryId),
  );

  // H37: search a challenge's queue by repo name / repo id / entry id.
  // Includes review existence so the UI opens the evaluation instead of
  // creating a second one (structurally impossible anyway).
  typed.get(
    "/api/queue/challenges/:challengeId/search",
    { preHandler: judgeOrOperate, schema: { params: challengeIdParam, querystring: searchQuery } },
    async (req) => searchChallengeQueue(req.params.challengeId, req.query.q),
  );

  // H40: CSV exports.
  typed.get(
    "/api/queue/challenges/:challengeId/export/queue.csv",
    {
      preHandler: requireCapability(CAPABILITIES.JUDGING_EXPORT),
      schema: { params: challengeIdParam },
    },
    async (req, reply) => {
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header(
        "content-disposition",
        `attachment; filename="challenge-${req.params.challengeId}-queue.csv"`,
      );
      return exportQueueCsv(req.params.challengeId);
    },
  );

  typed.get(
    "/api/queue/challenges/:challengeId/export/evaluations.csv",
    {
      preHandler: requireCapability(CAPABILITIES.JUDGING_EXPORT),
      schema: { params: challengeIdParam },
    },
    async (req, reply) => {
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header(
        "content-disposition",
        `attachment; filename="challenge-${req.params.challengeId}-evaluations.csv"`,
      );
      return exportEvaluationsCsv(req.params.challengeId);
    },
  );
}
