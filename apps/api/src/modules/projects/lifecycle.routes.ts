import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { broadcast } from "../../lib/sse.js";
import {
  requestEdits,
  requireProjectMember,
  resolveException,
  submissionDetail,
  submissionsOverview,
  submitProject,
  unlockProject,
} from "./lifecycle.js";

const params = z.object({ id: z.coerce.number().int().positive() });
const reason = z.string().trim().min(1).max(1000);
const auth = {
  config: { routeAccessPolicy: { kind: "authenticated" as const } },
  preHandler: [requireAuth, idempotencyGuard],
};
const admin = {
  config: {
    routeAccessPolicy: { kind: "capability" as const, capability: CAPABILITIES.PROJECTS_EDIT },
  },
  preHandler: [requireCapability(CAPABILITIES.PROJECTS_EDIT), idempotencyGuard],
};
async function announceChanged() {
  await broadcast(SSE_TOPICS.PROJECTS, EVENTS.DOMAIN_CHANGED, { domain: "projects" });
}
export function registerProjectLifecycleRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.post(
    "/api/me/projects/:id/submit",
    {
      ...auth,
      schema: {
        params,
        summary: "Submit project",
        description:
          "Submits or resubmits a project before the deadline and records a snapshot of the project, team and challenges. Submitting does not lock editing: members can keep editing until the participant window closes, and the last submitted snapshot counts (H20).",
      },
    },
    async (q) => {
      const result = await submitProject(q.userId as number, q.params.id);
      await announceChanged();
      return result;
    },
  );
  r.get(
    "/api/me/projects/:id/submission",
    {
      ...auth,
      preHandler: requireAuth,
      schema: {
        params,
        summary: "Read project submission",
        description:
          "Member view of the submission state, organizer lock, team-size rule and edit requests (H20).",
      },
    },
    async (q) => {
      await requireProjectMember(pool, q.userId as number, q.params.id);
      return submissionDetail(pool, q.params.id);
    },
  );
  r.post(
    "/api/me/projects/:id/edit-requests",
    {
      ...auth,
      schema: {
        params,
        body: z.object({ reason }),
        summary: "Request project edits",
        description:
          "Asks organizers to reopen a project they locked. Creates an audited decision request without unlocking the project (H20/H53).",
      },
    },
    async (q) => {
      const result = await requestEdits(q.userId as number, q.params.id, q.body.reason);
      await announceChanged();
      return result;
    },
  );
  r.get(
    "/api/projects/submissions",
    {
      ...admin,
      preHandler: requireCapability(CAPABILITIES.PROJECTS_EDIT),
      schema: {
        summary: "Review project submissions",
        description:
          "Organizer overview of every project's submission state, judging eligibility, team-size rule and edit requests (H21).",
      },
    },
    submissionsOverview,
  );
  r.post(
    "/api/projects/:id/unlock",
    {
      ...admin,
      schema: {
        params,
        body: z.object({ reason, decision: z.enum(["approve", "deny", "unlock"]) }),
        summary: "Decide project editing",
        description:
          "Approves or denies an edit request, or directly reopens a locked project. Retains snapshots and requires resubmission (H21/H53).",
      },
    },
    async (q) => {
      const result = await unlockProject(
        q.userId as number,
        q.params.id,
        q.body.reason,
        q.body.decision,
      );
      await announceChanged();
      return result;
    },
  );
  r.post(
    "/api/projects/:id/resolve",
    {
      ...admin,
      schema: {
        params,
        body: z
          .object({
            reason,
            teamSizeException: z.boolean().optional(),
            eligibilityOverride: z.boolean().nullable().optional(),
          })
          .refine(
            (b) =>
              b.teamSizeException !== undefined ||
              b.eligibilityOverride !== undefined,
          ),
        summary: "Resolve project exception",
        description:
          "Grants or revokes a team-size exception, or overrides/resets judging eligibility. An override to eligible also submits and locks the project. All decisions require an audited reason (H21/H53).",
      },
    },
    async (q) => {
      const result = await resolveException(q.userId as number, q.params.id, q.body);
      await announceChanged();
      return result;
    },
  );
  r.patch(
    "/api/projects/submission-rules",
    {
      config: {
        routeAccessPolicy: {
          kind: "capability",
          allOf: [CAPABILITIES.PROJECTS_EDIT, CAPABILITIES.EVENT_MANAGE],
        },
      },
      preHandler: [
        requireCapability(CAPABILITIES.PROJECTS_EDIT),
        requireCapability(CAPABILITIES.EVENT_MANAGE),
      ],
      schema: {
        body: z.object({ maxTeamSize: z.number().int().positive().max(100).nullable() }),
        summary: "Configure maximum project team size",
        description:
          "Sets an optional event-specific maximum; existing teams are retained and violations appear for organizer review. Records the actor and before/after values without requiring a justification for this event rule. Counts active members (H19/H21/H53).",
      },
    },
    async (q) =>
      withTransaction(async (db) => {
        const before = await db.query(
          `SELECT project_max_team_size FROM event_config WHERE id=1 FOR UPDATE`,
        );
        await db.query(
          `INSERT INTO event_config(id,project_max_team_size) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET project_max_team_size=$1`,
          [q.body.maxTeamSize],
        );
        await audit(db, {
          actorId: q.userId,
          entityType: "event",
          entityId: 1,
          action: "project_submission_rules",
          before: before.rows[0],
          after: { project_max_team_size: q.body.maxTeamSize },
          source: "admin",
        });
        return { saved: true };
      }),
  );
}
