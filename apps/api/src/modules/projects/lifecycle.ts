import { EVENTS } from "@hackos/shared/events";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { assertWithinParticipantSelfServiceWindow } from "../../lib/hacking-window.js";
import { hasEventAccess } from "../identity/role.js";
import { assertFixtureQueueScope } from "../logistics/review-fixture-scope.js";
import { broadcastQueueEvent } from "../queue/broadcast.js";
import { notifyChallengeQueueChanged } from "../queue/notify.js";
import {
  announceQueueOutcomes,
  enqueueRepoOnChallenge,
  enrollReposInMandatoryChallenges,
  isActiveProjectMember,
} from "./service.js";
import {
  assertGroupEditable,
  assertProjectEditable,
  hasReopenedProject,
} from "./submission-state.js";

export async function requireProjectMember(db: Queryable, userId: number, repoId: number) {
  if (!(await isActiveProjectMember(db, repoId, userId)))
    throw new ForbiddenError("Not a member of this project");
}
async function submissionWindow(db: Queryable) {
  await assertWithinParticipantSelfServiceWindow(db);
  const { rows } = await db.query(
    `SELECT hacking_ends_at, hacking_ends_at <= now() AS closed FROM event_config WHERE id=1 FOR SHARE`,
  );
  if (!rows[0]?.hacking_ends_at)
    throw new ConflictError(
      "Organizers must configure the submission deadline before projects can be submitted",
    );
  if (rows[0].closed) throw new ForbiddenError("The submission deadline has passed");
}
export async function snapshotProject(
  db: Queryable,
  repoId: number,
  actorId: number,
  source: "native" | "devpost" | "admin",
) {
  await db.query(
    `INSERT INTO project_submission_versions(repo_id,actor_id,source,snapshot)
    SELECT r.id,$2,$3,jsonb_build_object('project',to_jsonb(r),
      'members',COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM submissions s WHERE s.repo_id=r.id AND s.status='active'),'[]'::jsonb),
      'devpostParticipants',COALESCE((SELECT jsonb_agg(to_jsonb(dp)) FROM devpost_participants dp WHERE dp.repo_id=r.id),'[]'::jsonb),
      'planning', (SELECT to_jsonb(g) FROM planned_work_groups g WHERE g.linked_repo_id=r.id),
      'planningMembers',COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM planned_work_groups g JOIN planned_work_group_members m ON m.group_id=g.id WHERE g.linked_repo_id=r.id),'[]'::jsonb),
      'intendedChallenges',COALESCE((SELECT jsonb_agg(gc.challenge_id) FROM planned_work_groups g JOIN planned_work_group_challenges gc ON gc.group_id=g.id WHERE g.linked_repo_id=r.id),'[]'::jsonb),
      'challenges',COALESCE((SELECT jsonb_agg(qe.challenge_id) FROM queue_entries qe WHERE qe.repo_id=r.id AND qe.status NOT IN ('cancelled','disqualified')),'[]'::jsonb),
      'prizes',COALESCE((SELECT jsonb_agg(rp.prize) FROM repo_devpost_prizes rp WHERE rp.repo_id=r.id),'[]'::jsonb))
    FROM repos r WHERE r.id=$1`,
    [repoId, actorId, source],
  );
}
async function validateNative(db: Queryable, repoId: number) {
  const { rows } = await db.query(`SELECT * FROM project_reconciliation_state WHERE id=$1`, [
    repoId,
  ]);
  const state = rows[0];
  if (!state?.name.trim()) throw new BadRequestError("A project name is required");
  if (state.internal_ids.length === 0)
    throw new ConflictError("At least one active participant is required");
  if (
    state.max_team_size &&
    state.internal_ids.length > state.max_team_size &&
    !state.team_size_exception
  )
    throw new ConflictError("The project exceeds the maximum team size");
  if (state.membership_differs && !state.membership_resolution)
    throw new ConflictError("Resolve the participant differences before submitting");
}
export async function submitProject(userId: number, id: number, stage: "group" | "repo") {
  const result = await withTransaction(async (db) => {
    if (!(await hasEventAccess(db, userId)))
      throw new ForbiddenError("Only admitted participants can submit projects");
    let reopenedRepo = stage === "repo" ? id : null;
    if (stage === "group") {
      const group = await db.query(`SELECT linked_repo_id FROM planned_work_groups WHERE id=$1`, [
        id,
      ]);
      reopenedRepo = group.rows[0]?.linked_repo_id ?? null;
    }
    if (!reopenedRepo || !(await hasReopenedProject(db, reopenedRepo))) await submissionWindow(db);
    let repoId = id;
    const outcomes: Awaited<ReturnType<typeof enrollReposInMandatoryChallenges>> = [];
    if (stage === "group") {
      const group = await db.query(
        `SELECT g.* FROM planned_work_groups g JOIN planned_work_group_members m ON m.group_id=g.id WHERE g.id=$1 AND m.user_id=$2 AND m.status='active' FOR UPDATE OF g`,
        [id, userId],
      );
      if (!group.rows[0]) throw new ForbiddenError("Not an active member of this project");
      await assertGroupEditable(db, id);
      const g = group.rows[0];
      if (g.linked_repo_id) repoId = Number(g.linked_repo_id);
      else {
        const inserted = await db.query(
          `INSERT INTO repos(name,description,github_url,demo_url,source,created_by,reconciliation_code,presentation_timing_preference,submission_status,submitted_via)
          VALUES($1,$2,$3,$4,'native',$5,$6,$7,'draft',NULL) RETURNING id`,
          [
            g.name,
            g.description,
            g.github_url,
            g.demo_url,
            userId,
            g.reconciliation_code,
            g.presentation_timing_preference,
          ],
        );
        repoId = inserted.rows[0].id;
        await db.query(`UPDATE planned_work_groups SET linked_repo_id=$2 WHERE id=$1`, [
          id,
          repoId,
        ]);
        await db.query(
          `INSERT INTO submissions(repo_id,user_id,imported_from,status,responded_at)
          SELECT $2,user_id,'manual','active',now() FROM planned_work_group_members WHERE group_id=$1 AND status='active'`,
          [id, repoId],
        );
        const challenges = await db.query(
          `SELECT challenge_id FROM planned_work_group_challenges WHERE group_id=$1 ORDER BY challenge_id`,
          [id],
        );
        for (const c of challenges.rows) {
          const outcome = await enqueueRepoOnChallenge(
            db,
            userId,
            repoId,
            c.challenge_id,
            "participant",
          );
          if (outcome) outcomes.push(outcome);
        }
      }
    }
    await requireProjectMember(db, userId, repoId);
    await assertProjectEditable(db, repoId);
    await validateNative(db, repoId);
    await db.query(
      `UPDATE repos SET submission_status='submitted',submitted_at=now(),submitted_via='native',locked_at=now(),lock_reason='native_submission' WHERE id=$1`,
      [repoId],
    );
    await snapshotProject(db, repoId, userId, "native");
    outcomes.push(...(await enrollReposInMandatoryChallenges(db, userId, [repoId])));
    await audit(db, {
      actorId: userId,
      entityType: "repo",
      entityId: repoId,
      action: "submit",
      after: { submittedVia: "native", lockReason: "native_submission" },
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
export async function finalizeDevpostImport(db: Queryable, actorId: number, repoIds: number[]) {
  const config = await db.query(
    `SELECT hacking_ends_at <= now() AS closed FROM event_config WHERE id=1 FOR SHARE`,
  );
  if (!config.rows[0]?.closed) return;
  for (const id of [...new Set(repoIds)].sort((a, b) => a - b)) {
    const before = await db.query(`SELECT * FROM repos WHERE id=$1 FOR UPDATE`, [id]);
    // Native submissions and an approved reopening retain their own lifecycle.
    if (before.rows[0].submitted_via === "native") continue;
    await db.query(
      `UPDATE repos SET submission_status='submitted',submitted_via='devpost',submitted_at=COALESCE(submitted_at,now()),locked_at=COALESCE(locked_at,now()),lock_reason=COALESCE(lock_reason,'devpost_deadline_import') WHERE id=$1`,
      [id],
    );
    await snapshotProject(db, id, actorId, "devpost");
    await audit(db, {
      actorId,
      entityType: "repo",
      entityId: id,
      action: "lock_devpost_import",
      after: { lockReason: "devpost_deadline_import" },
      source: "admin",
    });
  }
  const unsubmitted = await db.query(
    `UPDATE repos SET submission_status='not_submitted' WHERE submission_status='draft' AND submitted_via IS NULL RETURNING id`,
  );
  for (const row of unsubmitted.rows)
    await audit(db, {
      actorId,
      entityType: "repo",
      entityId: row.id,
      action: "deadline_not_submitted",
      source: "admin",
    });
}

export async function reconciliationDetail(db: Queryable, repoId: number, participant = false) {
  const { rows } = await db.query(
    `SELECT s.*,COALESCE(g.reconciliation_code,s.reconciliation_code) AS display_code FROM project_reconciliation_state s LEFT JOIN planned_work_groups g ON g.linked_repo_id=s.id WHERE s.id=$1`,
    [repoId],
  );
  if (!rows[0]) throw new NotFoundError("Project not found");
  const s = rows[0];
  const internal = await db.query(
    `SELECT id AS "userId",name,surname FROM users WHERE id=ANY($1::int[]) ORDER BY name,id`,
    [s.internal_ids],
  );
  const external = await db.query(
    `SELECT md5(dp.repo_id::text || dp.email) AS "key",dp.user_id AS "userId",COALESCE(u.name,dp.name) AS name,COALESCE(u.surname,dp.surname) AS surname,CASE WHEN $2 THEN NULL ELSE dp.email END AS email FROM devpost_participants dp LEFT JOIN users u ON u.id=dp.user_id WHERE dp.repo_id=$1 ORDER BY name,dp.email`,
    [repoId, participant],
  );
  const requests = await db.query(
    `SELECT id,reason,status,created_at,decision_reason,decided_at FROM project_edit_requests WHERE repo_id=$1 ORDER BY created_at DESC`,
    [repoId],
  );
  const window = await db.query(
    `SELECT hacking_ends_at>now() AS open FROM event_config WHERE id=1`,
  );
  const rejected = await db.query(
    `SELECT count(*)::int AS n FROM project_claim_decisions WHERE repo_id=$1 AND status='rejected'`,
    [repoId],
  );
  const possibleDuplicates = await db.query(
    `SELECT md5(dp.repo_id::text||dp.email) AS "externalKey",u.id AS "candidateUserId",u.name,u.surname
    FROM devpost_participants dp JOIN users u ON u.id=ANY($2::int[])
    WHERE dp.repo_id=$1 AND dp.user_id IS DISTINCT FROM u.id
      AND length(trim(COALESCE(dp.name,'')))>0 AND length(trim(COALESCE(dp.surname,'')))>0
      AND lower(unaccent(trim(dp.name)))=lower(unaccent(trim(u.name)))
      AND lower(unaccent(trim(dp.surname)))=lower(unaccent(trim(u.surname)))`,
    [repoId, [...new Set([...s.internal_ids, ...s.external_ids])]],
  );
  return {
    possibleDuplicates: possibleDuplicates.rows,
    rejectedClaims: rejected.rows[0].n,
    id: s.id,
    name: s.name,
    code: s.display_code,
    status: s.submission_status,
    submittedVia: s.submitted_via,
    submittedAt: s.submitted_at,
    lockedAt: s.locked_at,
    lockReason: s.lock_reason,
    devpostUrl: s.devpost_url,
    eligible: s.eligible,
    membershipDiffers: s.membership_differs,
    membershipResolution: s.membership_resolution,
    unresolvedCount: s.unresolved_count,
    participantCount: s.participant_count,
    maxTeamSize: s.max_team_size,
    teamSizeViolation: s.team_size_violation,
    teamSizeException: s.team_size_exception,
    eligibilityOverride: s.eligibility_override,
    internal: internal.rows,
    external: external.rows,
    requests: requests.rows,
    canSubmit:
      (window.rows[0]?.open === true ||
        (s.submission_status === "draft" && s.submitted_at !== null)) &&
      !s.locked_at,
  };
}
export async function reconciliationOverview() {
  const repos = await pool.query(
    `SELECT id FROM repos WHERE is_test_account=false AND reconciled_into_repo_id IS NULL ORDER BY name,id`,
  );
  const projects = [];
  for (const r of repos.rows) projects.push(await reconciliationDetail(pool, r.id));
  const planned = await pool.query(
    `SELECT g.id,g.name,g.reconciliation_code AS code,CASE WHEN e.hacking_ends_at<=now() THEN 'not_submitted' ELSE 'draft' END AS status FROM planned_work_groups g LEFT JOIN event_config e ON e.id=1 WHERE linked_repo_id IS NULL ORDER BY g.name`,
  );
  const config = await pool.query(
    `SELECT project_max_team_size AS "maxTeamSize",hacking_ends_at AS deadline FROM event_config WHERE id=1`,
  );
  return {
    projects,
    planned: planned.rows.map((g) => ({ ...g, id: Number(g.id) })),
    config: config.rows[0] ?? { maxTeamSize: null, deadline: null },
  };
}
export async function resolveException(
  actorId: number,
  repoId: number,
  input: {
    membership?: "internal" | "devpost";
    teamSizeException?: boolean;
    eligibilityOverride?: boolean | null;
    reason: string;
  },
) {
  return withTransaction(async (db) => {
    await assertFixtureQueueScope(db, actorId, "repo", repoId);
    const before = await db.query(`SELECT * FROM repos WHERE id=$1 FOR UPDATE`, [repoId]);
    const busy = await db.query(
      `SELECT 1 FROM queue_entries WHERE repo_id=$1 AND status IN ('called','in_room','presenting')`,
      [repoId],
    );
    if (busy.rows[0])
      throw new ConflictError("Resolve participants after this project's active judging finishes");
    await db.query(
      `UPDATE repos SET membership_resolution=COALESCE($2,membership_resolution),team_size_exception=COALESCE($3,team_size_exception),eligibility_override=CASE WHEN $4 THEN $5 ELSE eligibility_override END WHERE id=$1`,
      [
        repoId,
        input.membership ?? null,
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
    const after = await reconciliationDetail(db, repoId);
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

/** H16/H53: preserve both records when organizers correct a confirmed relationship. */
export async function unlinkImportedProject(actorId: number, repoId: number, reason: string) {
  return withTransaction(async (db) => {
    await assertFixtureQueueScope(db, actorId, "repo", repoId);
    const { rows } = await db.query(`SELECT * FROM repos WHERE id=$1 FOR UPDATE`, [repoId]);
    const original = rows[0];
    if (!original) throw new NotFoundError("Project not found");
    const groups = await db.query(
      `SELECT id FROM planned_work_groups WHERE linked_repo_id=$1 FOR UPDATE`,
      [repoId],
    );
    if (!original.devpost_import_url || (original.source !== "native" && !groups.rows.length))
      throw new ConflictError("This project has no internal Devpost relationship to unlink");
    const busy = await db.query(
      `SELECT 1 FROM queue_entries WHERE repo_id=$1 AND status IN ('called','in_room','presenting','completed')`,
      [repoId],
    );
    if (busy.rows[0])
      throw new ConflictError(
        "Projects already in judging require organizer correction rather than unlinking",
      );
    await snapshotProject(db, repoId, actorId, "admin");
    let externalRepoId = repoId;
    if (original.source === "native") {
      const retained = await db.query(
        `SELECT id FROM repos WHERE reconciled_into_repo_id=$1 ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [repoId],
      );
      externalRepoId = retained.rows[0]?.id;
      if (!externalRepoId) {
        const created = await db.query(
          `INSERT INTO repos(name,description,github_url,demo_url,source,presentation_timing_preference) VALUES($1,$2,$3,$4,'devpost',$5) RETURNING id`,
          [
            original.name,
            original.description,
            original.github_url,
            original.demo_url,
            original.presentation_timing_preference,
          ],
        );
        externalRepoId = created.rows[0].id;
      }
      // Release the unique import identity before transferring it to the retained external record.
      await db.query(
        `UPDATE repos SET devpost_url=NULL,devpost_import_url=NULL,devpost_canonical_url=NULL,imported_project_code=NULL,membership_resolution=NULL WHERE id=$1`,
        [repoId],
      );
      await db.query(
        `UPDATE repos SET devpost_url=$2,devpost_import_url=$3,devpost_canonical_url=$4,reconciled_into_repo_id=NULL,submission_status='submitted',submitted_via='devpost',submitted_at=COALESCE(submitted_at,now()),eligibility_override=NULL,membership_resolution=NULL,locked_at=CASE WHEN (SELECT hacking_ends_at<=now() FROM event_config WHERE id=1) THEN now() ELSE NULL END,lock_reason=CASE WHEN (SELECT hacking_ends_at<=now() FROM event_config WHERE id=1) THEN 'devpost_deadline_import' ELSE NULL END WHERE id=$1`,
        [
          externalRepoId,
          original.devpost_url,
          original.devpost_import_url,
          original.devpost_canonical_url,
        ],
      );
      await db.query(`UPDATE devpost_participants SET repo_id=$2 WHERE repo_id=$1`, [
        repoId,
        externalRepoId,
      ]);
      await db.query(`DELETE FROM submissions WHERE repo_id=$1 AND imported_from='devpost'`, [
        externalRepoId,
      ]);
      await db.query(
        `INSERT INTO submissions(repo_id,user_id,imported_from,external_id) SELECT $1,user_id,'devpost',min(email) FROM devpost_participants WHERE repo_id=$1 AND user_id IS NOT NULL GROUP BY user_id ON CONFLICT DO NOTHING`,
        [externalRepoId],
      );
      await db.query(`DELETE FROM submissions WHERE repo_id=$1 AND imported_from='devpost'`, [
        repoId,
      ]);
      await db.query(`DELETE FROM repo_devpost_prizes WHERE repo_id=$1`, [externalRepoId]);
      await db.query(
        `INSERT INTO repo_devpost_prizes(repo_id,prize) SELECT $2,prize FROM repo_devpost_prizes WHERE repo_id=$1 ON CONFLICT DO NOTHING`,
        [repoId, externalRepoId],
      );
      await db.query(`DELETE FROM repo_devpost_prizes WHERE repo_id=$1`, [repoId]);
      await snapshotProject(db, externalRepoId, actorId, "admin");
    } else {
      await db.query(`UPDATE planned_work_groups SET linked_repo_id=NULL WHERE linked_repo_id=$1`, [
        repoId,
      ]);
      await db.query(`UPDATE repos SET membership_resolution=NULL WHERE id=$1`, [repoId]);
      for (const group of groups.rows)
        await audit(db, {
          actorId,
          entityType: "planned_work_group",
          entityId: group.id,
          action: "unlink_project",
          before: { repoId },
          after: { repoId },
          reason,
          source: "admin",
        });
    }
    await audit(db, {
      actorId,
      entityType: "repo",
      entityId: repoId,
      action: "unlink_project",
      before: original,
      after: { externalRepoId },
      reason,
      source: "admin",
    });
    return { unlinked: true, externalRepoId };
  });
}

/** H16/H17: only a recognized imported participant may confirm/link it. */
export async function claimImportedProject(
  userId: number,
  repoId: number,
  groupId?: number,
  admin = false,
  targetRepoId?: number,
) {
  const queueChanges: Array<Record<string, unknown> & { id: number; challenge_id: number }> = [];
  const result = await withTransaction(async (db) => {
    const imported = await db.query(
      `SELECT * FROM repos WHERE id=$1 AND is_test_account=false FOR UPDATE`,
      [repoId],
    );
    if (!imported.rows[0]) throw new NotFoundError("Project not found");
    const recognized = await db.query(
      `SELECT 1 FROM devpost_participants WHERE repo_id=$1 AND user_id=$2`,
      [repoId, userId],
    );
    if (!admin && !recognized.rows[0])
      throw new ForbiddenError("This Devpost project does not identify your account");
    if (targetRepoId) {
      if (targetRepoId === repoId) throw new ConflictError("Choose a different internal project");
      const target = await db.query(
        `SELECT * FROM repos WHERE id=$1 AND is_test_account=false AND reconciled_into_repo_id IS NULL FOR UPDATE`,
        [targetRepoId],
      );
      if (!target.rows[0]) throw new NotFoundError("Internal project not found");
      if (target.rows[0].devpost_import_url)
        throw new ConflictError("This project already has a confirmed Devpost link");
      if (!admin) await requireProjectMember(db, userId, targetRepoId);
      const state = await db.query(
        `SELECT internal_ids FROM project_reconciliation_state WHERE id=$1`,
        [targetRepoId],
      );
      const external = await db.query(
        `SELECT DISTINCT user_id FROM devpost_participants WHERE repo_id=$1 ORDER BY user_id`,
        [repoId],
      );
      if (
        !admin &&
        (external.rows.some((m) => m.user_id === null) ||
          JSON.stringify(external.rows.map((m) => m.user_id)) !==
            JSON.stringify(state.rows[0].internal_ids))
      )
        throw new ConflictError("Participant lists differ; ask organizers to review this link");
      const busy = await db.query(
        `SELECT 1 FROM queue_entries WHERE repo_id=ANY($1::int[]) AND status IN ('called','in_room','presenting','completed')`,
        [[repoId, targetRepoId]],
      );
      if (busy.rows[0])
        throw new ConflictError(
          "Projects already in judging require organizer correction rather than a new link",
        );
      await snapshotProject(db, repoId, userId, "admin");
      await snapshotProject(db, targetRepoId, userId, "admin");
      await db.query(
        `UPDATE repos SET devpost_url=NULL,devpost_import_url=NULL,submission_status='not_submitted',eligibility_override=false,reconciled_into_repo_id=$2 WHERE id=$1`,
        [repoId, targetRepoId],
      );
      await db.query(
        `UPDATE repos SET devpost_url=$2,devpost_import_url=$3,devpost_canonical_url=$4 WHERE id=$1`,
        [
          targetRepoId,
          imported.rows[0].devpost_url,
          imported.rows[0].devpost_import_url,
          imported.rows[0].devpost_canonical_url,
        ],
      );
      await db.query(`UPDATE devpost_participants SET repo_id=$2 WHERE repo_id=$1`, [
        repoId,
        targetRepoId,
      ]);
      await db.query(
        `INSERT INTO repo_devpost_prizes(repo_id,prize) SELECT $2,prize FROM repo_devpost_prizes WHERE repo_id=$1 ON CONFLICT DO NOTHING`,
        [repoId, targetRepoId],
      );
      await db.query(
        `INSERT INTO submissions(repo_id,user_id,imported_from,external_id) SELECT $2,user_id,imported_from,external_id FROM submissions WHERE repo_id=$1 AND status='active' ON CONFLICT DO NOTHING`,
        [repoId, targetRepoId],
      );
      const cancelled = await db.query(
        `UPDATE queue_entries SET status='cancelled',assigned_room_id=NULL WHERE repo_id=$1 AND status IN ('waiting','called') RETURNING *`,
        [repoId],
      );
      for (const entry of cancelled.rows) {
        queueChanges.push(entry);
        await audit(db, {
          actorId: userId,
          entityType: "queue_entry",
          entityId: entry.id,
          action: "reconcile_project",
          before: { status: "waiting", repoId },
          after: entry,
          reason: "Linked to internal project",
          source: admin ? "admin" : "participant",
        });
        await db.query(
          `INSERT INTO queue_history(queue_entry_id,actor_id,previous_status,new_status,action,reason) VALUES($1,$2,'waiting','cancelled','reconcile_project','Linked to internal project')`,
          [entry.id, userId],
        );
      }
      await audit(db, {
        actorId: userId,
        entityType: "repo",
        entityId: targetRepoId,
        action: "confirm_project_link",
        before: { externalRepoId: repoId },
        after: { devpostImportUrl: imported.rows[0].devpost_import_url },
        source: admin ? "admin" : "participant",
      });
      return { confirmed: true, repoId: targetRepoId };
    }
    if (groupId) {
      const group = await db.query(`SELECT * FROM planned_work_groups WHERE id=$1 FOR UPDATE`, [
        groupId,
      ]);
      if (!group.rows[0]) throw new NotFoundError("Project not found");
      if (group.rows[0].linked_repo_id && Number(group.rows[0].linked_repo_id) !== repoId)
        throw new ConflictError("This project already has a confirmed link");
      const member = await db.query(
        `SELECT 1 FROM planned_work_group_members WHERE group_id=$1 AND user_id=$2 AND status='active'`,
        [groupId, userId],
      );
      if (!admin && !member.rows[0])
        throw new ForbiddenError("Not a member of the selected project");
      const linked = await db.query(
        `SELECT id FROM planned_work_groups WHERE linked_repo_id=$1 AND id<>$2`,
        [repoId, groupId],
      );
      if (linked.rows[0])
        throw new ConflictError("This Devpost project already has a confirmed link");
      if (!admin) {
        const diff = await db.query(
          `SELECT EXISTS(SELECT 1 FROM devpost_participants WHERE repo_id=$1 AND user_id IS NULL)
          OR ARRAY(SELECT DISTINCT user_id FROM devpost_participants WHERE repo_id=$1 ORDER BY user_id)
           <> ARRAY(SELECT user_id FROM planned_work_group_members WHERE group_id=$2 AND status='active' ORDER BY user_id) AS differs`,
          [repoId, groupId],
        );
        if (diff.rows[0].differs)
          throw new ConflictError("Participant lists differ; ask organizers to review this link");
      }
      await db.query(`UPDATE planned_work_groups SET linked_repo_id=$2 WHERE id=$1`, [
        groupId,
        repoId,
      ]);
      await db.query(
        `UPDATE repos SET presentation_timing_preference=$2 WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM queue_entries WHERE repo_id=$1)`,
        [repoId, group.rows[0].presentation_timing_preference],
      );
    }
    await db.query(
      `INSERT INTO project_claim_decisions(repo_id,user_id,status) VALUES($1,$2,'confirmed') ON CONFLICT(repo_id,user_id) DO UPDATE SET status='confirmed'`,
      [repoId, userId],
    );
    await audit(db, {
      actorId: userId,
      entityType: "repo",
      entityId: repoId,
      action: groupId ? "confirm_project_link" : "confirm_imported_project",
      after: { groupId: groupId ?? null },
      source: admin ? "admin" : "participant",
    });
    return { confirmed: true };
  });
  for (const entry of queueChanges) {
    await broadcastQueueEvent(pool, "entry", entry.id, EVENTS.QUEUE_ENTRY_CHANGED, entry);
  }
  for (const challengeId of new Set(queueChanges.map((entry) => entry.challenge_id))) {
    await notifyChallengeQueueChanged(pool, challengeId);
  }
  return result;
}
export async function candidateGroups(userId: number, repoId: number, admin = false) {
  if (!admin) await requireProjectMember(pool, userId, repoId);
  const { rows } = await pool.query(
    `SELECT g.id,g.name,g.reconciliation_code AS code,
    COALESCE(jsonb_agg(jsonb_build_object('userId',m.user_id,'name',u.name,'surname',u.surname)) FILTER(WHERE m.status='active'),'[]'::jsonb) AS members,
    count(*) FILTER(WHERE m.status='active' AND EXISTS(SELECT 1 FROM devpost_participants dp WHERE dp.repo_id=$1 AND dp.user_id=m.user_id))::int AS overlap
    FROM planned_work_groups g JOIN planned_work_group_members m ON m.group_id=g.id JOIN users u ON u.id=m.user_id
    WHERE g.linked_repo_id IS NULL AND ($3 OR EXISTS(SELECT 1 FROM planned_work_group_members mine WHERE mine.group_id=g.id AND mine.user_id=$2 AND mine.status='active'))
    GROUP BY g.id ORDER BY overlap DESC,g.name`,
    [repoId, userId, admin],
  );
  const projects = await pool.query(
    `SELECT r.id,r.name,r.reconciliation_code AS code,
      COALESCE(jsonb_agg(jsonb_build_object('userId',u.id,'name',u.name,'surname',u.surname)),'[]'::jsonb) AS members,
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM devpost_participants dp WHERE dp.repo_id=$1 AND dp.user_id=u.id))::int AS overlap
    FROM project_reconciliation_state r JOIN repos original ON original.id=r.id JOIN users u ON u.id=ANY(r.internal_ids)
    WHERE r.id<>$1 AND original.devpost_import_url IS NULL AND original.reconciled_into_repo_id IS NULL AND r.is_test_account=false AND ($3 OR $2=ANY(r.internal_ids))
    GROUP BY r.id,r.name,r.reconciliation_code ORDER BY overlap DESC,r.name`,
    [repoId, userId, admin],
  );
  return {
    groups: [
      ...rows.map((g) => ({ ...g, id: Number(g.id), kind: "group" })),
      ...projects.rows.map((p) => ({ ...p, kind: "repo" })),
    ],
  };
}
