import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { createAuthorizationContext, userHasCapability } from "../../lib/capabilities.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { assertWithinParticipantSelfServiceWindow } from "../../lib/hacking-window.js";
import { broadcast } from "../../lib/sse.js";
import { hasEventAccess } from "../identity/role.js";
import { notify } from "../notifications/service.js";
import { resolveDevpostUrls } from "../projects/devpost-url.js";
import { updateLinkedWorkGroupProject } from "../projects/service.js";

async function assertParticipant(db: Queryable, userId: number) {
  const { rows } = await db.query(
    `SELECT id FROM users WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL FOR UPDATE`,
    [userId],
  );
  if (!rows[0]) throw new NotFoundError("User not found");
  if (!(await hasEventAccess(db, userId)))
    throw new ForbiddenError("Only admitted participants can plan a work group");
}
async function assertMember(db: Queryable, groupId: number, userId: number) {
  const { rows } = await db.query(
    `SELECT g.id, g.created_by FROM planned_work_groups g JOIN planned_work_group_members m ON m.group_id = g.id WHERE g.id = $1 AND m.user_id = $2 AND m.status = 'active' FOR UPDATE`,
    [groupId, userId],
  );
  if (!rows[0]) throw new ForbiddenError("Not an active member of this work group");
  return rows[0] as { id: number; created_by: number };
}
/** The intended challenge lineup becomes part of the judging contract at the
 * scheduled start, so participants cannot change it after that point. */
async function assertJudgingHasNotStarted(db: Queryable) {
  const { rows } = await db.query<{ started: boolean }>(
    `SELECT COALESCE(schedule_start_at <= now(), false) AS started
       FROM queue_settings WHERE id = 1 FOR UPDATE`,
  );
  if (rows[0]?.started) {
    throw new ForbiddenError("Challenges can no longer be changed after judging starts");
  }
}
export async function listMine(userId: number) {
  const { rows } = await pool.query(
    `SELECT g.id, g.name, g.description, g.github_url, g.demo_url, g.devpost_url, COALESCE(r.presentation_timing_preference,g.presentation_timing_preference) AS presentation_timing_preference, g.linked_repo_id, g.created_by, g.created_at, g.updated_at,
    CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id', r.id, 'name', r.name, 'devpostUrl', r.devpost_url) END AS "linkedProject",
    coalesce(json_agg(DISTINCT jsonb_build_object('userId', m.user_id, 'name', u.name, 'surname', u.surname, 'status', m.status, 'invitedBy', m.invited_by, 'respondedAt', m.responded_at)) FILTER (WHERE m.user_id IS NOT NULL), '[]') members,
    coalesce(json_agg(DISTINCT jsonb_build_object('id', c.id, 'title', c.title, 'mandatory', c.mandatory)) FILTER (WHERE c.id IS NOT NULL), '[]') challenges,
    NOT EXISTS (SELECT 1 FROM queue_entries qe WHERE qe.repo_id = g.linked_repo_id) AS presentation_timing_editable
    FROM planned_work_groups g JOIN planned_work_group_members mine ON mine.group_id = g.id AND mine.user_id = $1 AND mine.status IN ('active','invited')
    LEFT JOIN repos r ON r.id = g.linked_repo_id
    LEFT JOIN planned_work_group_members m ON m.group_id = g.id LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN challenges c ON c.is_test_account = false AND (
      c.mandatory OR EXISTS (SELECT 1 FROM planned_work_group_challenges gc WHERE gc.group_id = g.id AND gc.challenge_id = c.id)
    )
    -- #852/#854: linked repo is optional, so g.id does not functionally
    -- determine r.id for PostgreSQL's aggregate checker. Group it explicitly;
    -- r.id then determines the remaining projected repo fields.
    GROUP BY g.id, r.id ORDER BY g.updated_at DESC`,
    [userId],
  );
  return rows;
}
export async function getMine(userId: number, groupId: number) {
  const groups = await listMine(userId);
  const group = groups.find((candidate) => Number(candidate.id) === groupId);
  if (!group) throw new NotFoundError("Work group not found");
  return group;
}
export async function canCreateGroup(userId: number) {
  const { rows } = await pool.query<{ allowed: boolean }>(
    `SELECT participants_can_create_projects AND (
      (participant_self_service_starts_at IS NULL AND participant_self_service_ends_at IS NULL)
      OR now() BETWEEN COALESCE(participant_self_service_starts_at,hacking_starts_at)
                    AND COALESCE(participant_self_service_ends_at,hacking_ends_at)
    ) AS allowed FROM event_config WHERE id=1`,
  );
  return rows[0]?.allowed === true && (await hasEventAccess(pool, userId));
}
export async function createGroup(userId: number, name: string, challengeIds: number[] = []) {
  return withTransaction(async (db) => {
    await assertParticipant(db, userId);
    const policy = await db.query(
      `SELECT participants_can_create_projects FROM event_config WHERE id = 1 FOR UPDATE`,
    );
    if (policy.rows[0]?.participants_can_create_projects !== true) {
      throw new ForbiddenError("Participants cannot create projects for this event");
    }
    await assertWithinParticipantSelfServiceWindow(db);
    const uniqueChallengeIds = [...new Set(challengeIds)];
    if (uniqueChallengeIds.length > 0) {
      const visible = await db.query<{ id: number }>(
        `SELECT id FROM challenges WHERE id = ANY($1::int[]) AND visibility = 'visible' AND is_test_account = $2`,
        [uniqueChallengeIds, false],
      );
      const found = new Set(visible.rows.map((row) => Number(row.id)));
      const missing = uniqueChallengeIds.filter((id) => !found.has(id));
      if (missing.length > 0) throw new NotFoundError(`Challenge ${missing.join(", ")} not found`);
    }
    const { rows } = await db.query(
      `INSERT INTO planned_work_groups (name,created_by) VALUES ($1,$2) RETURNING id,name,description,github_url,demo_url,devpost_url,presentation_timing_preference,linked_repo_id`,
      [name, userId],
    );
    const group = rows[0];
    await db.query(
      `INSERT INTO planned_work_group_members (group_id,user_id,status,responded_at) VALUES ($1,$2,'active',now())`,
      [group.id, userId],
    );
    for (const challengeId of uniqueChallengeIds) {
      await db.query(
        `INSERT INTO planned_work_group_challenges (group_id,challenge_id) VALUES ($1,$2)`,
        [group.id, challengeId],
      );
    }
    await audit(db, {
      actorId: userId,
      entityType: "planned_work_group",
      entityId: group.id,
      action: "create",
      after: { name, challengeIds: uniqueChallengeIds },
      source: "participant",
    });
    return group;
  });
}
export async function updateGroup(
  userId: number,
  id: number,
  input: {
    name?: string;
    description?: string;
    devpostUrl?: string | null;
    githubUrl?: string | null;
    demoUrl?: string | null;
    presentationTimingPreference?: string;
  },
) {
  const existingRepos =
    input.devpostUrl === undefined
      ? []
      : (
          await pool.query<{
            id: number;
            devpost_url: string | null;
            devpost_canonical_url: string | null;
          }>(
            `SELECT id, devpost_url, devpost_canonical_url FROM repos WHERE is_test_account = false AND devpost_url IS NOT NULL`,
          )
        ).rows;
  const identities = await resolveDevpostUrls([
    input.devpostUrl ?? null,
    ...existingRepos
      .filter((repo) => repo.devpost_canonical_url === null)
      .map((repo) => repo.devpost_url),
  ]);
  return withTransaction(async (db) => {
    await assertParticipant(db, userId);
    await assertMember(db, id, userId);
    await assertWithinParticipantSelfServiceWindow(db);
    const { rows: before } = await db.query(
      `SELECT name,description,github_url,demo_url,devpost_url,
       COALESCE((SELECT r.presentation_timing_preference FROM repos r WHERE r.id = linked_repo_id),presentation_timing_preference) AS presentation_timing_preference,
       linked_repo_id FROM planned_work_groups WHERE id=$1 FOR UPDATE`,
      [id],
    );
    if (!before[0]) throw new NotFoundError("Work group not found");
    const b = before[0];
    if (
      input.presentationTimingPreference !== undefined &&
      input.presentationTimingPreference !== b.presentation_timing_preference &&
      b.linked_repo_id != null
    ) {
      const generated = await db.query(`SELECT 1 FROM queue_entries WHERE repo_id = $1 LIMIT 1`, [
        b.linked_repo_id,
      ]);
      if (generated.rows[0]) {
        throw new ConflictError("Presentation timing cannot be changed after queues are generated");
      }
    }
    await db.query(
      `UPDATE planned_work_groups SET name=$2,description=$3,github_url=$4,demo_url=$5,devpost_url=$6,presentation_timing_preference=$7,
       devpost_canonical_url = CASE WHEN $8 THEN
         CASE WHEN devpost_url IS NOT DISTINCT FROM $6 THEN COALESCE($9,devpost_canonical_url) ELSE $9 END
         ELSE devpost_canonical_url END
       WHERE id=$1
       RETURNING planned_work_groups.id,planned_work_groups.name,planned_work_groups.description,planned_work_groups.github_url,planned_work_groups.demo_url,planned_work_groups.devpost_url,planned_work_groups.presentation_timing_preference,planned_work_groups.linked_repo_id`,
      [
        id,
        input.name ?? b.name,
        input.description ?? b.description,
        input.githubUrl === undefined ? b.github_url : input.githubUrl,
        input.demoUrl === undefined ? b.demo_url : input.demoUrl,
        input.devpostUrl === undefined ? b.devpost_url : input.devpostUrl,
        input.presentationTimingPreference ?? b.presentation_timing_preference,
        input.devpostUrl !== undefined,
        identities.get(input.devpostUrl ?? "") ?? null,
      ],
    );
    if (b.linked_repo_id != null) {
      await updateLinkedWorkGroupProject(db, userId, b.linked_repo_id, input);
    }
    for (const repo of existingRepos) {
      const canonical = identities.get(repo.devpost_url ?? "");
      if (canonical)
        await db.query(
          `UPDATE repos SET devpost_canonical_url = $2 WHERE id = $1 AND devpost_url = $3`,
          [repo.id, canonical, repo.devpost_url],
        );
    }
    if (b.linked_repo_id == null && existingRepos.length) {
      await linkDevpostImports(
        db,
        userId,
        existingRepos.map((repo) => repo.id),
        id,
      );
    }
    const after = (
      await db.query(
        `SELECT id,name,description,github_url,demo_url,devpost_url,presentation_timing_preference,linked_repo_id FROM planned_work_groups WHERE id=$1`,
        [id],
      )
    ).rows[0];
    await audit(db, {
      actorId: userId,
      entityType: "planned_work_group",
      entityId: id,
      action: "update",
      before: b,
      after,
      source: "participant",
    });
    return after;
  });
}
export async function removeMember(userId: number, id: number, memberId: number) {
  return withTransaction(async (db) => {
    await assertParticipant(db, userId);
    await assertMember(db, id, userId);
    await assertWithinParticipantSelfServiceWindow(db);
    if (memberId === userId)
      throw new ConflictError(
        "Leave a work group by deleting it or asking another active member to remove you",
      );
    const removed = await db.query(
      `DELETE FROM planned_work_group_members WHERE group_id=$1 AND user_id=$2 RETURNING user_id,status`,
      [id, memberId],
    );
    if (!removed.rows[0]) throw new NotFoundError("Work-group member not found");
    await audit(db, {
      actorId: userId,
      entityType: "planned_work_group",
      entityId: id,
      action: "member.remove",
      before: { userId: memberId, status: removed.rows[0].status },
      source: "participant",
    });
    return { removed: true };
  });
}
export async function deleteGroup(userId: number, id: number) {
  return withTransaction(async (db) => {
    await assertParticipant(db, userId);
    await assertMember(db, id, userId);
    await assertWithinParticipantSelfServiceWindow(db);
    await assertJudgingHasNotStarted(db);
    const group = await db.query(
      `SELECT name,linked_repo_id FROM planned_work_groups WHERE id=$1 FOR UPDATE`,
      [id],
    );
    if (!group.rows[0]) throw new NotFoundError("Work group not found");
    if (group.rows[0].linked_repo_id != null) {
      throw new ConflictError("A work group linked to a project cannot be deleted");
    }
    await db.query(`DELETE FROM planned_work_groups WHERE id=$1`, [id]);
    await audit(db, {
      actorId: userId,
      entityType: "planned_work_group",
      entityId: id,
      action: "delete",
      before: group.rows[0],
      source: "participant",
    });
    return { deleted: true };
  });
}

/**
 * #854 import boundary. A valid Devpost URL wins, but only if it identifies
 * one unlinked planning group. Without a usable URL, a link needs complete
 * matched rosters AND exactly the same non-empty challenge set. Candidate
 * uniqueness on both sides is intentional: any tie stays for manual review.
 */
export async function linkDevpostImports(
  db: Queryable,
  actorId: number,
  repoIds: number[],
  groupId?: number,
) {
  if (!repoIds.length) return;
  const source = groupId === undefined ? "admin" : "participant";
  const validDevpostUrl =
    "^https?://([a-z0-9-]+\\.)?devpost\\.com/(software|submissions)/[^/?#]+/?(?:[?#].*)?$";
  const exact = await db.query(
    `WITH candidates AS (
       SELECT g.id AS group_id, r.id AS repo_id
       FROM planned_work_groups g
       JOIN repos r ON (
         (g.devpost_canonical_url IS NOT NULL AND g.devpost_canonical_url = r.devpost_canonical_url)
         OR lower(regexp_replace(split_part(split_part(g.devpost_url, '?', 1), '#', 1), '/+$', '')) = lower(regexp_replace(split_part(split_part(r.devpost_url, '?', 1), '#', 1), '/+$', ''))
       )
       WHERE g.linked_repo_id IS NULL
         AND r.id = ANY($1::int[])
         AND g.devpost_url ~* $2
         AND r.devpost_url ~* $2
         AND r.is_test_account = false
         AND NOT EXISTS (SELECT 1 FROM planned_work_groups linked WHERE linked.linked_repo_id = r.id)
     ), scored_candidates AS (
       SELECT group_id, repo_id,
              count(*) OVER (PARTITION BY group_id) AS groups_per_repo,
              count(*) OVER (PARTITION BY repo_id) AS repos_per_group
       FROM candidates
     ), unique_candidates AS (
       SELECT group_id, repo_id FROM scored_candidates
       WHERE groups_per_repo = 1 AND repos_per_group = 1
     )
     UPDATE planned_work_groups g
     SET linked_repo_id = c.repo_id
     FROM unique_candidates c
     WHERE g.id = c.group_id AND g.linked_repo_id IS NULL
       AND ($3::bigint IS NULL OR g.id = $3)
     RETURNING g.id, c.repo_id`,
    [repoIds, validDevpostUrl, groupId ?? null],
  );
  for (const row of exact.rows) {
    await audit(db, {
      actorId,
      entityType: "planned_work_group",
      entityId: row.id,
      action: "link_exact_devpost_import",
      after: { repoId: row.repo_id },
      source,
    });
    await mergeLinkedWorkGroup(db, actorId, Number(row.id), Number(row.repo_id), source);
  }

  const highConfidence = await db.query(
    `WITH candidates AS (
       SELECT g.id AS group_id, r.id AS repo_id
       FROM planned_work_groups g
       JOIN repos r ON r.id = ANY($1::int[])
       WHERE g.linked_repo_id IS NULL
         AND r.is_test_account = false
         -- A supplied valid Devpost URL is authoritative; never fall back to inference.
         AND (g.devpost_url IS NULL OR g.devpost_url !~* $2)
         -- Each active planner appears in the imported roster exactly once,
         -- and every imported participant resolved to one active planner.
         AND EXISTS (SELECT 1 FROM planned_work_group_members m WHERE m.group_id = g.id AND m.status = 'active')
         AND NOT EXISTS (
           SELECT 1 FROM planned_work_group_members m
           WHERE m.group_id = g.id AND m.status = 'active'
             AND NOT EXISTS (
               SELECT 1 FROM devpost_participants dp WHERE dp.repo_id = r.id AND dp.user_id = m.user_id
             )
         )
         AND NOT EXISTS (
           SELECT 1 FROM devpost_participants dp
           WHERE dp.repo_id = r.id AND (
             dp.user_id IS NULL OR NOT EXISTS (
               SELECT 1 FROM planned_work_group_members m
               WHERE m.group_id = g.id AND m.status = 'active' AND m.user_id = dp.user_id
             )
           )
         )
         -- Intended challenges are a required second signal and must match exactly.
         AND EXISTS (SELECT 1 FROM planned_work_group_challenges gc WHERE gc.group_id = g.id)
         AND NOT EXISTS (
           SELECT 1 FROM planned_work_group_challenges gc
           WHERE gc.group_id = g.id AND NOT EXISTS (
             SELECT 1 FROM repo_devpost_prizes rp
             JOIN challenges c ON c.devpost_tags ? rp.prize
             WHERE rp.repo_id = r.id AND c.id = gc.challenge_id
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM repo_devpost_prizes rp
           JOIN challenges c ON c.devpost_tags ? rp.prize
           WHERE rp.repo_id = r.id AND NOT EXISTS (
             SELECT 1 FROM planned_work_group_challenges gc
             WHERE gc.group_id = g.id AND gc.challenge_id = c.id
           )
         )
     ), scored_candidates AS (
       SELECT group_id, repo_id,
              count(*) OVER (PARTITION BY group_id) AS groups_per_repo,
              count(*) OVER (PARTITION BY repo_id) AS repos_per_group
       FROM candidates
     ), unique_candidates AS (
       SELECT group_id, repo_id FROM scored_candidates
       WHERE groups_per_repo = 1 AND repos_per_group = 1
     )
     UPDATE planned_work_groups g
     SET linked_repo_id = c.repo_id
     FROM unique_candidates c
     WHERE g.id = c.group_id AND g.linked_repo_id IS NULL
       AND ($3::bigint IS NULL OR g.id = $3)
       AND NOT EXISTS (
         SELECT 1 FROM planned_work_groups already_linked WHERE already_linked.linked_repo_id = c.repo_id
       )
     RETURNING g.id, c.repo_id`,
    [repoIds, validDevpostUrl, groupId ?? null],
  );
  for (const row of highConfidence.rows) {
    await audit(db, {
      actorId,
      entityType: "planned_work_group",
      entityId: row.id,
      action: "link_high_confidence_devpost_import",
      after: { repoId: row.repo_id },
      source,
    });
    await mergeLinkedWorkGroup(db, actorId, Number(row.id), Number(row.repo_id), source);
  }
}

/** #854: accepted planning memberships remain accepted after import. */
async function mergeLinkedWorkGroup(
  db: Queryable,
  actorId: number,
  groupId: number,
  repoId: number,
  source: "admin" | "participant",
) {
  const before = await db.query(
    `SELECT name,description,github_url,demo_url,presentation_timing_preference FROM repos WHERE id = $1 FOR UPDATE`,
    [repoId],
  );
  const after = await db.query(
    `UPDATE repos r SET presentation_timing_preference = g.presentation_timing_preference,
     github_url=COALESCE(r.github_url,g.github_url), demo_url=COALESCE(r.demo_url,g.demo_url)
    FROM planned_work_groups g WHERE g.id = $1 AND r.id = $2
    RETURNING r.name,r.description,r.github_url,r.demo_url,r.presentation_timing_preference`,
    [groupId, repoId],
  );
  await audit(db, {
    actorId,
    entityType: "repo",
    entityId: repoId,
    action: "merge_work_group",
    before: before.rows[0],
    after: { ...after.rows[0], groupId },
    source,
  });
  await db.query(
    `UPDATE planned_work_groups g SET name=r.name, description=r.description,
    github_url=COALESCE(r.github_url,g.github_url), demo_url=COALESCE(r.demo_url,g.demo_url)
    FROM repos r WHERE g.id=$1 AND r.id=$2`,
    [groupId, repoId],
  );
  const inserted = await db.query<{ user_id: number }>(
    `INSERT INTO submissions (repo_id, user_id, imported_from, status, invited_by, responded_at)
     SELECT $1, m.user_id, 'manual', 'active', $2, COALESCE(m.responded_at,now())
       FROM planned_work_group_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.group_id = $3 AND m.status = 'active'
        AND u.account_state = 'active' AND u.anonymized_at IS NULL
     ON CONFLICT (repo_id, user_id) DO UPDATE SET status='active', responded_at=EXCLUDED.responded_at
       WHERE submissions.status='invited'
     RETURNING user_id`,
    [repoId, actorId, groupId],
  );
  for (const row of inserted.rows) {
    await audit(db, {
      actorId,
      entityType: "repo",
      entityId: repoId,
      action: "member.add_from_work_group",
      after: { userId: Number(row.user_id), source: "linked_work_group", groupId },
      source,
    });
  }
}
export async function invite(userId: number, id: number, email: string) {
  const candidate = await pool.query<{ id: number }>(
    `SELECT id FROM users WHERE lower(email)=lower($1) AND account_state='active' AND anonymized_at IS NULL`,
    [email],
  );
  if (!candidate.rows[0]) throw new NotFoundError("No account for this email");
  return withTransaction(async (db) => {
    await assertParticipant(db, userId);
    await assertMember(db, id, userId);
    await assertWithinParticipantSelfServiceWindow(db);
    const invitee = await db.query(
      `SELECT id FROM users WHERE lower(email)=lower($1) AND account_state='active' AND anonymized_at IS NULL FOR UPDATE`,
      [email],
    );
    if (!invitee.rows[0]) throw new NotFoundError("No account for this email");
    const inviteeId = Number(invitee.rows[0].id);
    if (!(await hasEventAccess(db, inviteeId)))
      throw new ForbiddenError("Invitee is not an admitted participant");
    const inserted = await db.query(
      `INSERT INTO planned_work_group_members (group_id,user_id,status,invited_by) VALUES ($1,$2,'invited',$3) ON CONFLICT (group_id,user_id) DO UPDATE SET status='invited',invited_by=EXCLUDED.invited_by,responded_at=NULL WHERE planned_work_group_members.status='declined' RETURNING user_id`,
      [id, inviteeId, userId],
    );
    if (!inserted.rows[0]) {
      const existing = await db.query(
        `SELECT status FROM planned_work_group_members WHERE group_id=$1 AND user_id=$2`,
        [id, inviteeId],
      );
      if (existing.rows[0]?.status === "active")
        throw new ConflictError("User is already in this work group");
    }
    await notify(db, {
      userId: inviteeId,
      actorId: userId,
      category: "project",
      payload: { template: "work_group.invite", vars: { groupId: id } },
    });
    await audit(db, {
      actorId: userId,
      entityType: "planned_work_group",
      entityId: id,
      action: "member.invite",
      after: { invitedUserId: inviteeId },
      source: "participant",
    });
    return { invited: true };
  });
}
export async function respond(userId: number, id: number, status: "active" | "declined") {
  return withTransaction(async (db) => {
    await assertParticipant(db, userId);
    await assertWithinParticipantSelfServiceWindow(db);
    const result = await db.query(
      `UPDATE planned_work_group_members SET status=$3,responded_at=now() WHERE group_id=$1 AND user_id=$2 AND status='invited' RETURNING user_id`,
      [id, userId, status],
    );
    if (!result.rows[0]) throw new NotFoundError("No pending work-group invitation");
    await audit(db, {
      actorId: userId,
      entityType: "planned_work_group",
      entityId: id,
      action: status === "active" ? "member.invite_accept" : "member.invite_decline",
      after: { userId },
      source: "participant",
    });
    return { accepted: status === "active", declined: status === "declined" };
  });
}
export async function addChallenge(userId: number, id: number, challengeId: number) {
  return withTransaction(async (db) => {
    await assertParticipant(db, userId);
    await assertMember(db, id, userId);
    await assertWithinParticipantSelfServiceWindow(db);
    await assertJudgingHasNotStarted(db);
    const c = await db.query(`SELECT id FROM challenges WHERE id=$1`, [challengeId]);
    if (!c.rows[0]) throw new NotFoundError("Challenge not found");
    await db.query(
      `INSERT INTO planned_work_group_challenges (group_id,challenge_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [id, challengeId],
    );
    await audit(db, {
      actorId: userId,
      entityType: "planned_work_group",
      entityId: id,
      action: "challenge.intent_add",
      after: { challengeId },
      source: "participant",
    });
    return { added: true };
  });
}
export async function removeChallenge(userId: number, id: number, challengeId: number) {
  return withTransaction(async (db) => {
    await assertParticipant(db, userId);
    await assertMember(db, id, userId);
    await assertWithinParticipantSelfServiceWindow(db);
    await assertJudgingHasNotStarted(db);
    const challenge = await db.query<{ mandatory: boolean }>(
      `SELECT mandatory FROM challenges WHERE id = $1 FOR UPDATE`,
      [challengeId],
    );
    if (challenge.rows[0]?.mandatory)
      throw new ConflictError("Mandatory challenges cannot be withdrawn");
    const r = await db.query(
      `DELETE FROM planned_work_group_challenges WHERE group_id=$1 AND challenge_id=$2 RETURNING challenge_id`,
      [id, challengeId],
    );
    if (!r.rows[0]) throw new NotFoundError("No intended challenge");
    await audit(db, {
      actorId: userId,
      entityType: "planned_work_group",
      entityId: id,
      action: "challenge.intent_remove",
      before: { challengeId },
      source: "participant",
    });
    return { removed: true };
  });
}
export async function estimates(userId: number) {
  const staff = await userHasCapability(
    createAuthorizationContext(userId),
    CAPABILITIES.PROJECTS_READ,
  );
  const sponsor = await pool.query(`SELECT 1 FROM sponsors WHERE user_id=$1 LIMIT 1`, [userId]);
  if (!staff && !sponsor.rows[0])
    throw new ForbiddenError("Not allowed to read planned participation estimates");
  const { rows } = await pool.query(
    `WITH allowed AS (
       SELECT c.id,c.title,c.mandatory,c.devpost_tags FROM challenges c JOIN sponsors author ON author.id=c.author
        WHERE c.is_test_account=false AND ($2 OR EXISTS (
          SELECT 1 FROM sponsors mine WHERE mine.enterprise_id=author.enterprise_id AND mine.user_id=$1
        ))
     ), planned AS (
       SELECT c.id AS challenge_id,g.id AS group_id,g.linked_repo_id
         FROM allowed c JOIN planned_work_groups g ON c.mandatory OR EXISTS (
           SELECT 1 FROM planned_work_group_challenges gc WHERE gc.group_id=g.id AND gc.challenge_id=c.id
         )
     ), projects AS (
       SELECT c.id AS challenge_id,r.id AS repo_id FROM allowed c JOIN repos r ON r.is_test_account=false
        AND (EXISTS (SELECT 1 FROM queue_entries qe WHERE qe.repo_id=r.id AND qe.challenge_id=c.id AND qe.status NOT IN ('cancelled','disqualified'))
          OR (EXISTS (SELECT 1 FROM repo_devpost_prizes rp WHERE rp.repo_id=r.id AND c.devpost_tags ? rp.prize)
            AND NOT EXISTS (SELECT 1 FROM queue_entries qe WHERE qe.repo_id=r.id AND qe.challenge_id=c.id AND qe.status IN ('cancelled','disqualified'))))
     ), expected AS (
       SELECT challenge_id, 'group:' || group_id AS identity FROM planned WHERE linked_repo_id IS NULL
       UNION SELECT challenge_id,'repo:' || repo_id FROM projects
     )
     SELECT c.id AS "challengeId",c.title,
       (SELECT count(*)::int FROM planned p WHERE p.challenge_id=c.id) AS "groupCount",
       (SELECT count(*)::int FROM projects p WHERE p.challenge_id=c.id) AS "projectCount",
       (SELECT count(*)::int FROM expected e WHERE e.challenge_id=c.id) AS "expectedCount",
       (SELECT count(DISTINCT m.user_id)::int FROM planned p JOIN planned_work_group_members m ON m.group_id=p.group_id AND m.status='active' WHERE p.challenge_id=c.id) AS "participantCount"
       FROM allowed c ORDER BY c.title`,
    [userId, staff],
  );
  return rows;
}
export async function announceChanged() {
  await broadcast(SSE_TOPICS.PROJECTS, EVENTS.DOMAIN_CHANGED, { domain: "work-groups" });
}
