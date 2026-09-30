import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireAuth } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import {
  challengeBody,
  createGroupBody,
  groupParams,
  inviteBody,
  updateGroupBody,
} from "./schemas.js";
import {
  addChallenge,
  canCreateGroup,
  createGroup,
  deleteGroup,
  estimates,
  getMine,
  invite,
  listMine,
  removeChallenge,
  removeMember,
  respond,
  updateGroup,
} from "./service.js";

const auth = { config: { routeAccessPolicy: { kind: "authenticated" as const } } };
export function registerWorkGroupsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    "/api/me/work-groups",
    {
      ...auth,
      preHandler: requireAuth,
      schema: {
        summary: "List my planned work groups",
        description:
          "Planning groups, invitation state, intended and mandatory challenges, and canCreate reflecting event policy and the participant editing window. Planning never creates operational queue entries (#852).",
      },
    },
    async (q) => ({
      groups: await listMine(q.userId as number),
      canCreate: await canCreateGroup(q.userId as number),
    }),
  );
  r.get(
    "/api/me/work-groups/:id",
    {
      ...auth,
      preHandler: requireAuth,
      schema: {
        params: groupParams,
        summary: "Read my planned work group",
        description:
          "Returns one planning-stage project view for an invited or active member (#852, #854).",
      },
    },
    async (q) => getMine(q.userId as number, q.params.id),
  );
  r.post(
    "/api/me/work-groups",
    {
      ...auth,
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        body: createGroupBody,
        summary: "Create a planned work group",
        description:
          "Creates an auditable pre-event work group for an admitted participant, optionally with intended published challenges (#852).",
      },
    },
    async (q) => createGroup(q.userId as number, q.body.name, q.body.challengeIds),
  );
  r.delete(
    "/api/me/work-groups/:id/members/:userId",
    {
      ...auth,
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: groupParams.extend({ userId: groupParams.shape.id }),
        summary: "Remove a work-group member",
        description:
          "An active planner may remove another member or pending invite. The last active member must delete the group instead (#852).",
      },
    },
    async (q) => removeMember(q.userId as number, q.params.id, q.params.userId),
  );
  r.patch(
    "/api/me/work-groups/:id",
    {
      ...auth,
      preHandler: requireAuth,
      schema: {
        params: groupParams,
        body: updateGroupBody,
        summary: "Update a planned work group",
        description:
          "Updates project planning metadata and presentation preference. For an active member of the linked project, metadata changes update that project in the same audited transaction. Established links remain stable; preference changes are refused after queue generation (#853/#854).",
      },
    },
    async (q) => updateGroup(q.userId as number, q.params.id, q.body),
  );
  r.post(
    "/api/me/work-groups/:id/invites",
    {
      ...auth,
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: groupParams,
        body: inviteBody,
        summary: "Invite a work-group member",
        description:
          "Invites an admitted participant. Membership is pending until the invitee explicitly accepts or declines (#852).",
      },
    },
    async (q) => invite(q.userId as number, q.params.id, q.body.email),
  );
  for (const [path, status, summary] of [
    ["accept", "active", "Accept a work-group invitation"],
    ["decline", "declined", "Decline a work-group invitation"],
  ] as const)
    r.post(
      `/api/me/work-groups/:id/invites/${path}`,
      {
        ...auth,
        preHandler: [requireAuth, idempotencyGuard],
        schema: {
          params: groupParams,
          summary,
          description: "Responds only to the caller’s pending invitation (#852).",
        },
      },
      async (q) => respond(q.userId as number, q.params.id, status),
    );
  r.post(
    "/api/me/work-groups/:id/challenges",
    {
      ...auth,
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: groupParams,
        body: challengeBody,
        summary: "Add an intended challenge",
        description:
          "Records planned interest only; it never creates a queue entry and is refused once judging has started (#852).",
      },
    },
    async (q) => addChallenge(q.userId as number, q.params.id, q.body.challengeId),
  );
  r.delete(
    "/api/me/work-groups/:id/challenges/:challengeId",
    {
      ...auth,
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: groupParams.extend({ challengeId: groupParams.shape.id }),
        summary: "Remove an intended challenge",
        description:
          "Removes optional planned interest before judging starts. Mandatory challenges cannot be withdrawn (#852).",
      },
    },
    async (q) => removeChallenge(q.userId as number, q.params.id, q.params.challengeId),
  );
  r.delete(
    "/api/me/work-groups/:id",
    {
      ...auth,
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: groupParams,
        summary: "Delete a planned work group",
        description:
          "Deletes planning-only metadata, members and intended challenges in one audited transaction before judging starts. Linked operational projects are retained (#852, #854).",
      },
    },
    async (q) => deleteGroup(q.userId as number, q.params.id),
  );
  r.get(
    "/api/work-groups/estimates",
    {
      ...auth,
      preHandler: requireAuth,
      schema: {
        summary: "Read planned challenge participation estimates",
        description:
          "Staff with project-read access see all estimates; sponsor representatives see only their enterprise's challenges. Counts include mandatory intent, submitted projects and a deduplicated expectedCount across groups and projects (#852/#854).",
      },
    },
    async (q) => ({ estimates: await estimates(q.userId as number) }),
  );
}
