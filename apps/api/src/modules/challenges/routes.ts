import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireAnyCapability, requireAuth } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import type { RouteAccessPolicy } from "../../lib/route-policy.js";
import {
  challengeEditAccessFor,
  isChallengeAdmin,
  requireChallengeAccess,
  requireChallengeEdit,
  requireChallengeListAccess,
} from "./access.js";
import {
  bulkVisibilityBody,
  challengeIdParam,
  createChallengeBody,
  publishChallengeBody,
  setWinnerBody,
  updateChallengeBody,
  winnerRankParam,
} from "./schemas.js";
import {
  createChallenge,
  getChallenge,
  listAllChallenges,
  listAssignedJudgeChallenges,
  listOwnedChallenges,
  listVersions,
  previewPanel,
  publishChallenge,
  setChallengesVisibility,
  unpublishChallenge,
  updateChallenge,
} from "./service.js";
import { getChallengeWinners, removeChallengeWinner, setChallengeWinner } from "./winners.js";

const access = (routeAccessPolicy: RouteAccessPolicy) => ({ config: { routeAccessPolicy } });
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
      const canListAll = await isChallengeAdmin(userId);
      if (canListAll) return { challenges: await listAllChallenges() };
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
        anyOf: [CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN],
      }),
      preHandler: manageChallenges,
      schema: {
        body: createChallengeBody,
        summary: "Create a sponsor challenge",
        description:
          "Creates a hidden challenge template for an enterprise. Requires global sponsor or queue administration (H43, H44).",
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
      return getChallenge(req.params.id);
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
          "Partially updates challenge content, prizes, judging configuration, timing and visibility. Organization admins with sponsors:manage, queue:admin or the admin wildcard may update any editable field; a sponsor representative may edit only their own challenge, and public content is locked after reveal. Judging panel criteria remain locked once judging starts. Every successful edit is versioned and audited (H44, H45, H53).",
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

  // Admin bulk visibility flip from the challenges list (H45).
  r.post(
    "/api/challenges/visibility",
    {
      ...access({
        kind: "capability",
        anyOf: [CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN],
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
        anyOf: [CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN],
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
        anyOf: [CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.QUEUE_ADMIN],
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
      return previewPanel(req.params.id);
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
        description: "Sets one rank for a repo that is entered in this exact challenge (H46).",
      },
    },
    async (req) => {
      return setChallengeWinner(
        req.userId as number,
        req.params.id,
        req.params.rank,
        req.body.repoId,
      );
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
      return { removed: true };
    },
  );
}
