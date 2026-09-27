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
          "Pre-event planning groups, their invitation state, and intended challenges. They never create operational projects or queue entries (#852).",
      },
    },
    async (q) => ({ groups: await listMine(q.userId as number) }),
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
          "Creates an auditable pre-event work group for an admitted participant (#852).",
      },
    },
    async (q) => createGroup(q.userId as number, q.body.name),
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
          "Updates planning metadata only. devpostUrl and presentationTimingPreference are stable contracts for #854 and #853; this route does not link imports or order queues.",
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
        description: "Removes planned interest only before judging starts (#852).",
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
          "Staff with project-read access see all estimates; sponsor representatives see only their enterprise’s challenges. This is the stable aggregate recipient boundary for #856, without sending notifications.",
      },
    },
    async (q) => ({ estimates: await estimates(q.userId as number) }),
  );
}
