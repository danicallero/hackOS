import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { announceChanged } from "../work-groups/service.js";
import {
  candidateGroups,
  claimImportedProject,
  reconciliationDetail,
  reconciliationOverview,
  requestEdits,
  requireProjectMember,
  resolveException,
  submitProject,
  unlinkImportedProject,
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
export function registerProjectLifecycleRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  for (const [path, stage] of [
    ["work-groups", "group"],
    ["projects", "repo"],
  ] as const)
    r.post(
      `/api/me/${path}/:id/submit`,
      {
        ...auth,
        schema: {
          params,
          summary: "Submit project",
          description:
            "Submits a project natively before the event deadline, preserves a submitted snapshot, and locks participant editing (H18–H20).",
        },
      },
      async (q) => {
        const result = await submitProject(q.userId as number, q.params.id, stage);
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
          "Authorized member view of submission, lock, participant differences and edit requests. Other participant emails are redacted (H20).",
      },
    },
    async (q) => {
      await requireProjectMember(pool, q.userId as number, q.params.id);
      const detail = await reconciliationDetail(pool, q.params.id, true);
      const claim = await pool.query(
        `SELECT status FROM project_claim_decisions WHERE repo_id=$1 AND user_id=$2`,
        [q.params.id, q.userId],
      );
      return { ...detail, claimStatus: claim.rows[0]?.status ?? null };
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
          "Creates an audited organizer decision request without unlocking a submitted project (H20/H53).",
      },
    },
    async (q) => {
      const result = await requestEdits(q.userId as number, q.params.id, q.body.reason);
      await announceChanged();
      return result;
    },
  );
  r.post(
    "/api/me/projects/:id/reject-claim",
    {
      ...auth,
      schema: {
        params,
        summary: "Dispute an imported project",
        description:
          "Recognized Devpost participants may flag an incorrect project association for organizer review. No identity or roster is silently removed (H17/H53).",
      },
    },
    async (q) =>
      withTransaction(async (db) => {
        await requireProjectMember(db, q.userId as number, q.params.id);
        await db.query(
          `INSERT INTO project_claim_decisions(repo_id,user_id,status) VALUES($1,$2,'rejected') ON CONFLICT(repo_id,user_id) DO UPDATE SET status='rejected'`,
          [q.params.id, q.userId],
        );
        await audit(db, {
          actorId: q.userId,
          entityType: "repo",
          entityId: q.params.id,
          action: "reject_imported_project",
          source: "participant",
        });
        return { rejected: true };
      }),
  );
  r.get(
    "/api/projects/reconciliation",
    {
      ...admin,
      preHandler: requireCapability(CAPABILITIES.PROJECTS_EDIT),
      schema: {
        summary: "Review project reconciliation",
        description:
          "Organizer dashboard of native, imported, unsubmitted, identity, membership, team-size and edit-request cases (H16–H21).",
      },
    },
    reconciliationOverview,
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
    "/api/projects/:id/unlink",
    {
      ...admin,
      schema: {
        params,
        body: z.object({ reason }),
        summary: "Unlink Devpost project",
        description:
          "Corrects a mistaken internal/Devpost relationship, retaining both records, submitted snapshots and an audited reason. Requires organizer approval and rejects projects already in judging (H16/H53).",
      },
    },
    async (q) => {
      const result = await unlinkImportedProject(q.userId as number, q.params.id, q.body.reason);
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
            membership: z.enum(["internal", "devpost"]).optional(),
            teamSizeException: z.boolean().optional(),
            eligibilityOverride: z.boolean().nullable().optional(),
          })
          .refine(
            (b) =>
              b.membership !== undefined ||
              b.teamSizeException !== undefined ||
              b.eligibilityOverride !== undefined,
          ),
        summary: "Resolve project exception",
        description:
          "Explicitly chooses submitted participants, grants/revokes a team-size exception, or overrides/resets judging eligibility. All decisions require an audited reason (H21/H53).",
      },
    },
    async (q) => {
      const result = await resolveException(q.userId as number, q.params.id, q.body);
      await announceChanged();
      return result;
    },
  );
  for (const staff of [false, true]) {
    const base = staff ? "/api/projects" : "/api/me/projects";
    const guards = staff ? admin : auth;
    r.get(
      `${base}/:id/link-candidates`,
      {
        ...guards,
        preHandler: staff ? requireCapability(CAPABILITIES.PROJECTS_EDIT) : requireAuth,
        schema: {
          params,
          summary: "Find project link candidates",
          description:
            "Shows independent unlinked planning projects and their participant overlap. Participant access is restricted to recognized imported members and their own projects (H16/H17).",
        },
      },
      (q) => candidateGroups(q.userId as number, q.params.id, staff),
    );
    r.post(
      `${base}/:id/claim`,
      {
        ...guards,
        schema: {
          params,
          body: z
            .object({
              groupId: z.number().int().positive().optional(),
              targetRepoId: z.number().int().positive().optional(),
            })
            .refine((b) => !(b.groupId && b.targetRepoId)),
          summary: "Confirm imported project",
          description:
            "Confirms a Devpost-only project or links it to an internal planning project. Participants must be recognized in the imported roster; conflicts require organizer review (H16/H17).",
        },
      },
      async (q) => {
        const result = await claimImportedProject(
          q.userId as number,
          q.params.id,
          q.body.groupId,
          staff,
          q.body.targetRepoId,
        );
        await announceChanged();
        return result;
      },
    );
  }
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
          "Sets an optional event-specific maximum; existing teams are retained and violations appear for organizer review. Records the actor and before/after values without requiring a justification for this event rule. Uses resolved unique users (H18/H21/H53).",
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
