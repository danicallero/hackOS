import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireCapability } from "../../lib/capabilities.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import {
  requireChallengeExport,
  requireChallengeJudgeOrCapability,
  requireEntryJudgeOrCapability,
  requireReviewEntryAccess,
  requireReviewScopeAccess,
} from "./contextual-access.js";
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
  assertEntryInScope,
  exportReviewsCsv,
  getReviewDetail,
  listReviews,
  resolveReviewScope,
  sendReviewMessage,
} from "./reviews.js";
import {
  challengeIdParam,
  entryIdParam,
  reviewMessageBody,
  reviewPatchBody,
  reviewsQuery,
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

  const judgePanel = requireEntryJudgeOrCapability(CAPABILITIES.JUDGE_PANEL);
  const judgeOrOperateEntry = requireEntryJudgeOrCapability(
    CAPABILITIES.JUDGE_PANEL,
    CAPABILITIES.QUEUE_OPERATE,
  );
  const judgeOrOperateChallenge = requireChallengeJudgeOrCapability(
    CAPABILITIES.JUDGE_PANEL,
    CAPABILITIES.QUEUE_OPERATE,
  );

  typed.get(
    "/api/queue/entries/:entryId/review",
    {
      preHandler: judgePanel,
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-judge",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: { params: entryIdParam },
    },
    async (req) => getAttemptReview(req.params.entryId),
  );

  // H36: field-level last-write-wins collaborative save; every save versioned.
  typed.patch(
    "/api/queue/entries/:entryId/review",
    {
      preHandler: judgePanel,
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-judge",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: { params: entryIdParam, body: reviewPatchBody },
    },
    async (req) => upsertAttemptReview(req.params.entryId, actor(req.userId), req.body),
  );

  typed.get(
    "/api/queue/entries/:entryId/review/versions",
    {
      preHandler: judgePanel,
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-judge",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: { params: entryIdParam },
    },
    async (req) => listAttemptReviewVersions(req.params.entryId),
  );

  // H36: judge presence on a ficha.
  typed.post(
    "/api/queue/entries/:entryId/session",
    {
      preHandler: judgePanel,
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-judge",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: { params: entryIdParam, body: sessionJoinBody },
    },
    async (req) => joinJudgingSession(req.params.entryId, actor(req.userId), req.body.roomId),
  );

  typed.delete(
    "/api/queue/entries/:entryId/session",
    {
      preHandler: judgePanel,
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-judge",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: { params: entryIdParam },
    },
    async (req) => leaveJudgingSession(req.params.entryId, actor(req.userId)),
  );

  typed.get(
    "/api/queue/entries/:entryId/sessions",
    {
      preHandler: judgeOrOperateEntry,
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "queue-entry-operate",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: { params: entryIdParam },
    },
    async (req) => listActiveJudgingSessions(req.params.entryId),
  );

  // H37: search a challenge's queue by repo name / repo id / entry id.
  // Includes review existence so the UI opens the evaluation instead of
  // creating a second one (structurally impossible anyway).
  typed.get(
    "/api/queue/challenges/:challengeId/search",
    {
      preHandler: judgeOrOperateChallenge,
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "challenge-judge",
          resource: { source: "params", field: "challengeId" },
        },
      },
      schema: { params: challengeIdParam, querystring: searchQuery },
    },
    async (req) => searchChallengeQueue(req.params.challengeId, req.query.q),
  );

  // H40: CSV exports.
  typed.get(
    "/api/queue/challenges/:challengeId/export/queue.csv",
    {
      preHandler: requireChallengeExport(),
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "challenge-export",
          resource: { source: "params", field: "challengeId" },
        },
      },
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
      preHandler: requireChallengeExport(),
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "challenge-export",
          resource: { source: "params", field: "challengeId" },
        },
      },
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

  // Reviews overview: admin sees every challenge, a sponsor rep only ever
  // sees their own enterprise's — enforced inside resolveReviewScope/listReviews,
  // not by a capability flag (see reviews.ts for why).
  typed.get(
    "/api/queue/reviews",
    {
      preHandler: requireReviewScopeAccess,
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "review-list",
          resource: { source: "query", field: "challengeId" },
        },
      },
      schema: { querystring: reviewsQuery },
    },
    async (req) => {
      const scope = await resolveReviewScope(req.userId);
      return { reviews: await listReviews(scope, req.query) };
    },
  );

  // The ficha behind a reviews-overview row: project + team, the challenge's
  // judging panel questions, the answers given, and the edit history. Same
  // scoping as the list (admin: any entry; sponsor: own challenges only).
  typed.get(
    "/api/queue/reviews/:entryId",
    {
      preHandler: requireReviewEntryAccess,
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "review",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: {
        params: entryIdParam,
        summary: "Review detail",
        description:
          "Project details, the challenge's judging panel questions with the answers recorded for this entry, and the evaluation's edit history. Admins reach any entry; a sponsor rep only entries of their own enterprise's challenges (403 otherwise).",
      },
    },
    async (req) => getReviewDetail(await resolveReviewScope(req.userId), req.params.entryId),
  );

  // Correcting an evaluation from the overview: same validation and versioning
  // as the judging panel's own save, plus an audit_log row (H53) because this
  // happens outside the room, after the fact.
  typed.patch(
    "/api/queue/reviews/:entryId",
    {
      preHandler: [requireReviewEntryAccess, idempotencyGuard],
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "review",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: {
        params: entryIdParam,
        body: reviewPatchBody,
        summary: "Update a review from the overview",
        description:
          "Edits an evaluation's answers, notes or submitted state out of band. Answers are validated against the challenge's judging panel; submitting requires every required question answered. Every save is versioned and audited.",
      },
    },
    async (req) => {
      const scope = await resolveReviewScope(req.userId);
      await assertEntryInScope(scope, req.params.entryId);
      return upsertAttemptReview(req.params.entryId, actor(req.userId), req.body, { audit: true });
    },
  );

  // H46: reach the team behind an evaluation (e.g. call them back for a
  // question). Needs the comms capability on top of review visibility.
  typed.post(
    "/api/queue/reviews/:entryId/message",
    {
      preHandler: [
        requireReviewEntryAccess,
        requireCapability(CAPABILITIES.NOTIFICATIONS_SEND),
        idempotencyGuard,
      ],
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "review-message",
          resource: { source: "params", field: "entryId" },
        },
      },
      schema: {
        params: entryIdParam,
        body: reviewMessageBody,
        summary: "Message the team of a review",
        description:
          "Sends a free-text message to every member of the evaluated team through the mandatory queue notification category (inbox, email and push), so it cannot be silenced by notification preferences. Audited. Returns the number of recipients reached.",
      },
    },
    async (req) => {
      const scope = await resolveReviewScope(req.userId);
      return sendReviewMessage(scope, req.params.entryId, actor(req.userId), req.body.message);
    },
  );

  typed.get(
    "/api/queue/reviews/export.csv",
    {
      preHandler: requireReviewScopeAccess,
      config: {
        routeAccessPolicy: {
          kind: "contextual",
          policy: "review-export",
          resource: { source: "query", field: "challengeId" },
        },
      },
      schema: { querystring: reviewsQuery },
    },
    async (req, reply) => {
      const scope = await resolveReviewScope(req.userId);
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="reviews.csv"`);
      return exportReviewsCsv(scope, req.query);
    },
  );
}
