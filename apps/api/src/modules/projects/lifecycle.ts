import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { assertWithinHackingWindow } from "../../lib/hacking-window.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { hasEventAccess } from "../identity/role.js";
import { assertFixtureQueueScope } from "../logistics/review-fixture-scope.js";
import {
  announceQueueOutcomes,
  enrollReposInMandatoryChallenges,
  isActiveProjectMember,
} from "./service.js";
import { assertProjectEditable, hasReopenedProject } from "./submission-state.js";

export async function requireProjectMember(db: Queryable, userId: number, repoId: number) {
  if (!(await isActiveProjectMember(db, repoId, userId)))
    throw new ForbiddenError("Not a member of this project");
}

/** H17/H20: submitting needs the participant window and a configured deadline. */
async function submissionWindow(db: Queryable) {
  await assertWithinHackingWindow(db);
  const { rows } = await db.query(
    `SELECT hacking_ends_at, hacking_ends_at <= now() AS closed FROM event_config WHERE id=1 FOR SHARE`,
  );
  if (!rows[0]?.hacking_ends_at)
    throw new ConflictError(
      "Organizers must configure the submission deadline before projects can be submitted",
    );
  if (rows[0].closed) throw new ForbiddenError("The submission deadline has passed");
}

/** H20: an immutable copy of what was submitted (project, team, challenges). */
export async function snapshotProject(
  db: Queryable,
  repoId: number,
  actorId: number,
  source: "participant" | "admin",
) {
  await db.query(
    `INSERT INTO project_submission_versions(repo_id,actor_id,source,snapshot)
    SELECT r.id,$2,$3,jsonb_build_object('project',to_jsonb(r),
      'members',COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM submissions s WHERE s.repo_id=r.id AND s.status='active'),'[]'::jsonb),
      'challenges',COALESCE((SELECT jsonb_agg(c.id ORDER BY c.id) FROM challenges c
        WHERE c.is_test_account=r.is_test_account AND (c.mandatory OR EXISTS (
          SELECT 1 FROM project_challenges pc WHERE pc.repo_id=r.id AND pc.challenge_id=c.id))),'[]'::jsonb))
    FROM repos r WHERE r.id=$1`,
    [repoId, actorId, source],
  );
}

async function validateSubmission(db: Queryable, repoId: number) {
  const { rows } = await db.query(
    `SELECT r.name, e.participant_count, e.max_team_size, e.team_size_exception
       FROM repos r JOIN project_eligibility e ON e.id = r.id WHERE r.id=$1`,
    [repoId],
  );
  const state = rows[0];
  if (!state?.name.trim()) throw new BadRequestError("A project name is required");
  if (state.participant_count === 0)
    throw new ConflictError("At least one active participant is required");
  if (
    state.max_team_size &&
    state.participant_count > state.max_team_size &&
    !state.team_size_exception
  )
    throw new ConflictError("The project exceeds the maximum team size");
}

/**
 * H20: a member submits (or resubmits) their project. Submitting records a
 * snapshot and does not lock editing: members keep editing until the window
 * closes and the last submitted snapshot is the one that counts (#1006).
 */
export async function submitProject(userId: number, repoId: number) {
  const result = await withTransaction(async (db) => {
    if (!(await hasEventAccess(db, userId)))
      throw new ForbiddenError("Only admitted participants can submit projects");
    await requireProjectMember(db, userId, repoId);
    await assertProjectEditable(db, repoId);
    if (!(await hasReopenedProject(db, repoId))) await submissionWindow(db);
    await validateSubmission(db, repoId);
    await db.query(
      `UPDATE repos SET submission_status='submitted',submitted_at=now(),submitted_via='participant' WHERE id=$1`,
      [repoId],
    );
    await snapshotProject(db, repoId, userId, "participant");
    const outcomes = await enrollReposInMandatoryChallenges(db, userId, [repoId]);
    await audit(db, {
      actorId: userId,
      entityType: "repo",
      entityId: repoId,
      action: "submit",
      after: { submittedVia: "participant" },
      source: "participant",
    });
    return { repoId, outcomes };
  });
  await announceQueueOutcomes(result.outcomes);
  return { repoId: result.repoId };
}

export async function requestEdits(userId: number, repoId: number, reason: string) {
  return withTransaction(async (db) => {
    await requireProjectMember(db, userId, repoId);
    const { rows } = await db.query(`SELECT locked_at FROM repos WHERE id=$1 FOR UPDATE`, [repoId]);
    if (!rows[0]?.locked_at) throw new ConflictError("This project is already open for editing");
    const pending = await db.query(
      `SELECT id FROM project_edit_requests WHERE repo_id=$1 AND status='pending'`,
      [repoId],
    );
    if (pending.rows[0]) throw new ConflictError("An edit request is already awaiting a decision");
    const inserted = await db.query(
      `INSERT INTO project_edit_requests(repo_id,requested_by,reason) VALUES($1,$2,$3) RETURNING id`,
      [repoId, userId, reason],
    );
    await audit(db, {
      actorId: userId,
      entityType: "repo",
      entityId: repoId,
      action: "request_edits",
      after: { requestId: inserted.rows[0].id },
      reason,
      source: "participant",
    });
    return { requested: true };
  });
}

/** H21/H53: organizers decide an edit request or reopen a locked project. */
export async function unlockProject(
  actorId: number,
  repoId: number,
  reason: string,
  decision: "approve" | "deny" | "unlock",
) {
  return withTransaction(async (db) => {
    await assertFixtureQueueScope(db, actorId, "repo", repoId);
    const { rows } = await db.query(
      `SELECT submission_status,locked_at,lock_reason FROM repos WHERE id=$1 FOR UPDATE`,
      [repoId],
    );
    if (!rows[0]) throw new NotFoundError("Project not found");
    const requests = await db.query(
      `SELECT id FROM project_edit_requests WHERE repo_id=$1 AND status='pending' FOR UPDATE`,
      [repoId],
    );
    if (decision !== "unlock" && !requests.rows[0])
      throw new ConflictError("No pending edit request");
    if (decision !== "deny") {
      const busy = await db.query(
        `SELECT 1 FROM queue_entries WHERE repo_id=$1 AND status IN ('called','in_room','presenting','completed') LIMIT 1`,
        [repoId],
      );
      if (busy.rows[0])
        throw new ConflictError("Finish or reset judging for this project before reopening it");
      if (!rows[0].locked_at) throw new ConflictError("Project is already open");
      await snapshotProject(db, repoId, actorId, "admin");
      await db.query(
        `UPDATE repos SET submission_status='draft',locked_at=NULL,lock_reason=NULL,eligibility_override=NULL WHERE id=$1`,
        [repoId],
      );
    }
    await db.query(
      `UPDATE project_edit_requests SET status=$2,decided_by=$3,decision_reason=$4,decided_at=now() WHERE repo_id=$1 AND status='pending'`,
      [repoId, decision === "deny" ? "denied" : "approved", actorId, reason],
    );
    await audit(db, {
      actorId,
      entityType: "repo",
      entityId: repoId,
      action: decision === "deny" ? "deny_edits" : "unlock",
      before: rows[0],
      after: { requiresResubmission: decision !== "deny" },
      reason,
      source: "admin",
    });
    return { decided: true };
  });
}

/** Submission state, team-size rule and edit requests of one project (H20/H21). */
export async function submissionDetail(db: Queryable, repoId: number) {
  const { rows } = await db.query(
    `SELECT r.id, r.name, r.submission_status, r.submitted_via, r.submitted_at, r.locked_at,
            r.lock_reason, e.eligible, e.participant_count, e.max_team_size,
            e.team_size_violation, e.team_size_exception, e.eligibility_override,
            (SELECT max(v.created_at) FROM project_submission_versions v
              WHERE v.repo_id = r.id AND v.source = 'participant') AS last_submitted_at,
            r.updated_at > COALESCE(r.submitted_at, r.created_at) AS changed_since_submit
       FROM repos r JOIN project_eligibility e ON e.id = r.id WHERE r.id=$1`,
    [repoId],
  );
  if (!rows[0]) throw new NotFoundError("Project not found");
  const s = rows[0];
  const requests = await db.query(
    `SELECT id,reason,status,created_at,decision_reason,decided_at FROM project_edit_requests WHERE repo_id=$1 ORDER BY created_at DESC`,
    [repoId],
  );
  const window = await db.query(
    `SELECT hacking_ends_at>now() AS open FROM event_config WHERE id=1`,
  );
  const reopened = s.submission_status === "draft" && s.submitted_at !== null;
  return {
    id: s.id,
    name: s.name,
    status: s.submission_status,
    submittedVia: s.submitted_via,
    submittedAt: s.submitted_at,
    changedSinceSubmit: s.submission_status === "submitted" && s.changed_since_submit === true,
    lockedAt: s.locked_at,
    lockReason: s.lock_reason,
    eligible: s.eligible,
    participantCount: s.participant_count,
    maxTeamSize: s.max_team_size,
    teamSizeViolation: s.team_size_violation,
    teamSizeException: s.team_size_exception,
    eligibilityOverride: s.eligibility_override,
    requests: requests.rows,
    canSubmit: (window.rows[0]?.open === true || reopened) && !s.locked_at,
  };
}

/** H21: organizer overview of every project's submission state. */
export async function submissionsOverview() {
  const repos = await pool.query(
    `SELECT id FROM repos WHERE is_test_account=false ORDER BY name,id`,
  );
  const projects = [];
  for (const r of repos.rows) projects.push(await submissionDetail(pool, r.id));
  const config = await pool.query(
    `SELECT project_max_team_size AS "maxTeamSize",hacking_ends_at AS deadline FROM event_config WHERE id=1`,
  );
  return { projects, config: config.rows[0] ?? { maxTeamSize: null, deadline: null } };
}

/** H21/H53: team-size exceptions and judging-eligibility overrides. */
export async function resolveException(
  actorId: number,
  repoId: number,
  input: { teamSizeException?: boolean; eligibilityOverride?: boolean | null; reason: string },
) {
  return withTransaction(async (db) => {
    await assertFixtureQueueScope(db, actorId, "repo", repoId);
    const before = await db.query(`SELECT * FROM repos WHERE id=$1 FOR UPDATE`, [repoId]);
    if (!before.rows[0]) throw new NotFoundError("Project not found");
    const busy = await db.query(
      `SELECT 1 FROM queue_entries WHERE repo_id=$1 AND status IN ('called','in_room','presenting')`,
      [repoId],
    );
    if (busy.rows[0])
      throw new ConflictError("Resolve this project after its active judging finishes");
    await db.query(
      `UPDATE repos SET team_size_exception=COALESCE($2,team_size_exception),eligibility_override=CASE WHEN $3 THEN $4 ELSE eligibility_override END WHERE id=$1`,
      [
        repoId,
        input.teamSizeException ?? null,
        input.eligibilityOverride !== undefined,
        input.eligibilityOverride ?? null,
      ],
    );
    if (input.eligibilityOverride === true) {
      await db.query(
        `UPDATE repos SET submission_status='submitted',submitted_at=COALESCE(submitted_at,now()),submitted_via=COALESCE(submitted_via,'admin'),locked_at=COALESCE(locked_at,now()),lock_reason=COALESCE(lock_reason,'organizer_lock') WHERE id=$1`,
        [repoId],
      );
      await snapshotProject(db, repoId, actorId, "admin");
    }
    const after = await submissionDetail(db, repoId);
    await audit(db, {
      actorId,
      entityType: "repo",
      entityId: repoId,
      action: "resolve_exception",
      before: before.rows[0],
      after,
      reason: input.reason,
      source: "admin",
    });
    return after;
  });
}
