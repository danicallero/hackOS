import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import {
  getRequestAuthorizationContext,
  requireAnyCapability,
  requireAuth,
} from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { routeAccessOption as access } from "../../lib/route-policy.js";
import { isSyntheticOperator } from "../logistics/review-fixture-scope.js";
import {
  challengeEditAccessFor,
  isChallengeAdmin,
  requireChallengeAccess,
  requireChallengeEdit,
  requireChallengeListAccess,
} from "./access.js";
import {
  bulkVisibilityBody,
  challengeAlertBody,
  challengeIdParam,
  createChallengeBody,
  publishChallengeBody,
  setWinnerBody,
  updateChallengeBody,
  winnerRankParam,
} from "./schemas.js";
import {
  createChallenge,
  deleteChallenge,
  getChallenge,
  listAllChallenges,
  listAssignedJudgeChallenges,
  listOwnedChallenges,
  listVersions,
  previewPanel,
  publishChallenge,
  sendChallengeAlert,
  setChallengesVisibility,
  unpublishChallenge,
  updateChallenge,
} from "./service.js";
import {
  announcePublishedWinners,
  publishWinnersNow,
  scheduleWinners,
  visibleWinnerRows,
  winnerPublication,
} from "./winner-publication.js";
import { getChallengeWinners, removeChallengeWinner, setChallengeWinner } from "./winners.js";

const challengeParam = { source: "params", field: "id" } as const;

/**
 * H44: challenge editing — sponsors build their own judging panel and edit
 * their reto; org admins can do the same. Ownership-sensitive routes check
 * access inside the handler (it depends on the challenge, not just a
 * capability); list routes gate on a plain capability.
 */
export function registerChallengeRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const manageChallenges = requireAnyCapability(
    CAPABILITIES.SPONSORS_MANAGE,
    CAPABILITIES.QUEUE_ADMIN,
    CAPABILITIES.CHALLENGES_MANAGE,
  );

  // Admin-wide list.
  r.get(
    "/api/challenges",
    {
      ...access({
        kind: "contextual",
        policy: "challenge-directory",
      }),
      preHandler: requireChallengeListAccess,
      schema: {
        summary: "List challenges available to the caller",
        description:
          "Global challenge administrators see all challenges; sponsor representatives and assigned judges see only their scoped challenges (H44, H46).",
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const canListAll = await isChallengeAdmin(getRequestAuthorizationContext(req));
      if (canListAll) {
        return {
          challenges: await listAllChallenges(await isSyntheticOperator(pool, userId)),
        };
      }
      const [owned, assigned] = await Promise.all([
        listOwnedChallenges(userId),
        listAssignedJudgeChallenges(userId),
      ]);
      return {
        challenges: [
          ...owned,
          ...assigned.filter((challenge) => !owned.some((own) => own.id === challenge.id)),
        ],
      };
    },
  );

  // Admin creates a challenge template bound to an enterprise. It starts hidden;
  // making it visible below reveals it on /api/public/challenges (H45).
  r.post(
    "/api/challenges",
    {
      ...access({
        kind: "capability",
        anyOf: [
          CAPABILITIES.SPONSORS_MANAGE,
          CAPABILITIES.QUEUE_ADMIN,
          CAPABILITIES.CHALLENGES_MANAGE,
        ],
      }),
      preHandler: manageChallenges,
      schema: {
        body: createChallengeBody,
        summary: "Create a sponsor challenge",
        description:
          "Creates a hidden challenge template for an enterprise. Requires global sponsor, queue, or challenge administration (H8, H43, H44).",
      },
    },
    async (req, reply) => {
      const created = await createChallenge(req.body, req.userId as number);
      reply.code(201);
      return created;
    },
  );

  // Sponsor rep's own challenges (H44/H46).
  r.get(
    "/api/challenges/mine",
    {
      ...access({ kind: "authenticated" }),
      preHandler: requireAuth,
      schema: {
        summary: "List my enterprise challenges",
        description: "Returns challenges owned by the caller's sponsor enterprise (H44, H46).",
      },
    },
    async (req) => ({
      challenges: await listOwnedChallenges(req.userId as number),
    }),
  );

  r.get(
    "/api/challenges/:id",
    {
      ...access({ kind: "contextual", policy: "challenge-access", resource: challengeParam }),
      preHandler: requireChallengeAccess(challengeParam),
      schema: {
        params: challengeIdParam,
        summary: "Get a scoped challenge",
        description:
          "Accessible to global administrators, the owning sponsor enterprise, or judges assigned to that challenge (H44, H46).",
      },
    },
    async (req) => {
      return getChallenge(req.params.id, await isSyntheticOperator(pool, req.userId as number));
    },
  );

  r.patch(
    "/api/challenges/:id",
    {
      ...access({ kind: "contextual", policy: "challenge-edit", resource: challengeParam }),
      preHandler: requireChallengeEdit(challengeParam),
      schema: {
        params: challengeIdParam,
        body: updateChallengeBody,
        summary: "Update a challenge",
        description:
          "Partially updates challenge content, prizes, judging configuration, timing and visibility. Organization admins with sponsors:manage, queue:admin, challenges:manage, or the admin wildcard may update any editable field; a sponsor representative may edit only their own challenge, and public content is locked after reveal. Judging panel criteria remain locked after the first submitted evaluation or completed queue entry in the challenge's queue group. Every successful edit is versioned and audited (H8, H44, H45, H53).",
      },
    },
    async (req) => {
      return updateChallenge(
        req.params.id,
        req.userId as number,
        req.body,
        challengeEditAccessFor(req),
      );
    },
  );

  r.post(
    "/api/challenges/:id/alerts",
    {
      ...access({ kind: "contextual", policy: "challenge-edit", resource: challengeParam }),
      preHandler: [requireChallengeEdit(challengeParam), idempotencyGuard],
      schema: {
        params: challengeIdParam,
        body: challengeAlertBody,
        summary: "Send a challenge alert",
        description:
          "Sends an auditable alert to active members of projects entered in this challenge and active members of planned work groups that intend it. Sponsor representatives are limited to their enterprise's challenge; staff may instead target all admitted event participants. Delivery respects each recipient's notification preferences (#856, H51, H53).",
      },
    },
    async (req) =>
      sendChallengeAlert(
        req.params.id,
        req.userId as number,
        req.body,
        challengeEditAccessFor(req),
      ),
  );

  // Admin bulk visibility flip from the challenges list (H45).
  r.post(
    "/api/challenges/visibility",
    {
      ...access({
        kind: "capability",
        anyOf: [
          CAPABILITIES.SPONSORS_MANAGE,
          CAPABILITIES.QUEUE_ADMIN,
          CAPABILITIES.CHALLENGES_MANAGE,
        ],
      }),
      preHandler: manageChallenges,
      schema: {
        body: bulkVisibilityBody,
        summary: "Set challenge visibility",
        description: "Globally reveals or hides selected challenges (H45).",
      },
    },
    async (req) => setChallengesVisibility(req.body.ids, req.body.visible, req.userId as number),
  );

  r.post(
    "/api/challenges/:id/publish",
    {
      ...access({
        kind: "capability",
        anyOf: [
          CAPABILITIES.SPONSORS_MANAGE,
          CAPABILITIES.QUEUE_ADMIN,
          CAPABILITIES.CHALLENGES_MANAGE,
        ],
      }),
      preHandler: manageChallenges,
      schema: {
        params: challengeIdParam,
        body: publishChallengeBody,
        summary: "Publish a challenge",
        description: "Publishes a challenge now or schedules its reveal (H45).",
      },
    },
    async (req) => publishChallenge(req.params.id, req.userId as number, req.body),
  );

  r.post(
    "/api/challenges/:id/unpublish",
    {
      ...access({
        kind: "capability",
        anyOf: [
          CAPABILITIES.SPONSORS_MANAGE,
          CAPABILITIES.QUEUE_ADMIN,
          CAPABILITIES.CHALLENGES_MANAGE,
        ],
      }),
      preHandler: manageChallenges,
      schema: {
        params: challengeIdParam,
        summary: "Unpublish a challenge",
        description: "Hides a published challenge and clears any scheduled reveal (H45).",
      },
    },
    async (req) => unpublishChallenge(req.params.id, req.userId as number),
  );

  // Admin-only permanent delete (H44) — gated like publish/unpublish, not the
  // owner-inclusive edit policy: deleting is strictly more destructive than
  // editing, so a sponsor rep who owns the challenge cannot do it themselves.
  r.delete(
    "/api/challenges/:id",
    {
      ...access({
        kind: "capability",
        anyOf: [
          CAPABILITIES.SPONSORS_MANAGE,
          CAPABILITIES.QUEUE_ADMIN,
          CAPABILITIES.CHALLENGES_MANAGE,
        ],
      }),
      preHandler: manageChallenges,
      schema: {
        params: challengeIdParam,
        summary: "Delete a challenge",
        description:
          "Permanently deletes a challenge. Blocked if it has queue entries, recorded winners, or an active room assignment — unpublish it instead (H44).",
      },
    },
    async (req, reply) => {
      await deleteChallenge(req.params.id, req.userId as number);
      reply.code(204);
    },
  );

  // Preview the judging panel before it goes live (H44).
  r.get(
    "/api/challenges/:id/panel/preview",
    {
      ...access({ kind: "contextual", policy: "challenge-access", resource: challengeParam }),
      preHandler: requireChallengeAccess(challengeParam),
      schema: {
        params: challengeIdParam,
        summary: "Preview a judging panel",
        description: "Shows the scoped challenge panel and its edit lock state (H44, H46).",
      },
    },
    async (req) => {
      return previewPanel(req.params.id, await isSyntheticOperator(pool, req.userId as number));
    },
  );

  // Version history — "saber qué decía el reto en cualquier momento" (H44).
  r.get(
    "/api/challenges/:id/versions",
    {
      ...access({ kind: "contextual", policy: "challenge-edit", resource: challengeParam }),
      preHandler: requireChallengeEdit(challengeParam),
      schema: {
        params: challengeIdParam,
        summary: "List challenge versions",
        description:
          "Returns immutable challenge edit history to its owner or a global administrator (H44).",
      },
    },
    async (req) => {
      return { versions: await listVersions(req.params.id) };
    },
  );

  r.get(
    "/api/challenges/:id/winners/publication",
    {
      ...access({ kind: "contextual", policy: "challenge-edit", resource: challengeParam }),
      preHandler: requireChallengeEdit(challengeParam),
      schema: {
        params: challengeIdParam,
        summary: "Read winner publication",
        description:
          "Owning sponsors and challenge editors read private publication scheduling (H60).",
      },
    },
    (q) => winnerPublication(pool, q.params.id),
  );
  r.put(
    "/api/challenges/:id/winners/publication",
    {
      ...access({ kind: "contextual", policy: "challenge-edit", resource: challengeParam }),
      preHandler: [requireChallengeEdit(challengeParam), idempotencyGuard],
      schema: {
        params: challengeIdParam,
        body: z.object({ publishAt: z.iso.datetime({ offset: true }).nullable() }),
        summary: "Schedule winner publication",
        description:
          "Audits a future SQL-clock winner reveal time; scheduling emits no public invalidation before publication (H60,H53).",
      },
    },
    (q) => scheduleWinners(q.userId as number, q.params.id, q.body.publishAt),
  );
  r.post(
    "/api/challenges/:id/winners/publish",
    {
      ...access({ kind: "contextual", policy: "challenge-edit", resource: challengeParam }),
      preHandler: [requireChallengeEdit(challengeParam), idempotencyGuard],
      schema: {
        params: challengeIdParam,
        summary: "Publish winners now",
        description:
          "Serializes an audited publication transition and emits one payload-free invalidation per public topic only after commit (H60).",
      },
    },
    (q) => publishWinnersNow(q.userId as number, q.params.id),
  );
  r.get(
    "/api/public/challenges/:id/winners",
    {
      ...access({ kind: "public", anonymousCategory: "public-content" }),
      schema: {
        params: challengeIdParam,
        summary: "Read published winners",
        description:
          "Returns no winner field until publication and gallery audience allow the caller to read the result (H60).",
      },
    },
    async (q) => {
      const winners = (await visibleWinnerRows(pool, q.userId)).filter(
        (row) => row.challengeId === q.params.id,
      );
      return winners.length ? { winners } : {};
    },
  );
  // H46: internal winner ranking — same access as editing the challenge
  // (admin or the owning sponsor rep), never public, never other sponsors.
  r.get(
    "/api/challenges/:id/winners",
    {
      ...access({ kind: "contextual", policy: "challenge-edit", resource: challengeParam }),
      preHandler: requireChallengeEdit(challengeParam),
      schema: {
        params: challengeIdParam,
        summary: "List challenge winners",
        description:
          "Returns non-public winner rankings only for the owning enterprise or global administrators (H46).",
      },
    },
    async (req) => {
      return { winners: await getChallengeWinners(req.params.id) };
    },
  );

  r.put(
    "/api/challenges/:id/winners/:rank",
    {
      ...access({ kind: "contextual", policy: "challenge-edit", resource: challengeParam }),
      preHandler: [requireChallengeEdit(challengeParam), idempotencyGuard],
      schema: {
        params: winnerRankParam,
        body: setWinnerBody,
        summary: "Set a challenge winner",
        description:
          "Sets one rank for a repo entered in any challenge sharing this challenge's queue group — every challenge has its own 1:1 group unless an enterprise merged several into one shared judging queue. The win is recorded against this challenge (H46).",
      },
    },
    async (req) => {
      const winner = await setChallengeWinner(
        req.userId as number,
        req.params.id,
        req.params.rank,
        req.body.repoId,
      );
      if ((await winnerPublication(pool, req.params.id)).publishedAt)
        await announcePublishedWinners();
      return winner;
    },
  );

  r.delete(
    "/api/challenges/:id/winners/:rank",
    {
      ...access({ kind: "contextual", policy: "challenge-edit", resource: challengeParam }),
      preHandler: requireChallengeEdit(challengeParam),
      schema: {
        params: winnerRankParam,
        summary: "Remove a challenge winner",
        description: "Removes a private winner rank from the exact scoped challenge (H46).",
      },
    },
    async (req) => {
      await removeChallengeWinner(req.userId as number, req.params.id, req.params.rank);
      if ((await winnerPublication(pool, req.params.id)).publishedAt)
        await announcePublishedWinners();
      return { removed: true };
    },
  );
}
