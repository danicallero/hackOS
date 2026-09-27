import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { hasEventAccess } from "../identity/role.js";
import { notify } from "../notifications/service.js";

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
    `SELECT g.id, g.name, g.description, g.github_url, g.demo_url, g.devpost_url, g.presentation_timing_preference, g.linked_repo_id, g.created_by, g.created_at, g.updated_at,
    CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id', r.id, 'name', r.name, 'devpostUrl', r.devpost_url) END AS "linkedProject",
    coalesce(json_agg(DISTINCT jsonb_build_object('userId', m.user_id, 'name', u.name, 'surname', u.surname, 'status', m.status, 'invitedBy', m.invited_by, 'respondedAt', m.responded_at)) FILTER (WHERE m.user_id IS NOT NULL), '[]') members,
    coalesce(json_agg(DISTINCT jsonb_build_object('id', c.id, 'title', c.title)) FILTER (WHERE c.id IS NOT NULL), '[]') challenges
    FROM planned_work_groups g JOIN planned_work_group_members mine ON mine.group_id = g.id AND mine.user_id = $1
    LEFT JOIN repos r ON r.id = g.linked_repo_id
    LEFT JOIN planned_work_group_members m ON m.group_id = g.id LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN planned_work_group_challenges gc ON gc.group_id = g.id LEFT JOIN challenges c ON c.id = gc.challenge_id
    GROUP BY g.id ORDER BY g.updated_at DESC`,
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
export async function createGroup(userId: number, name: string) {
  return withTransaction(async (db) => {
    await assertParticipant(db, userId);
    const policy = await db.query(
      `SELECT participants_can_create_projects FROM event_config WHERE id = 1 FOR UPDATE`,
    );
    if (policy.rows[0]?.participants_can_create_projects !== true) {
      throw new ForbiddenError("Participants cannot create projects for this event");
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
    await audit(db, {
      actorId: userId,
      entityType: "planned_work_group",
      entityId: group.id,
      action: "create",
      after: { name },
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
  return withTransaction(async (db) => {
    await assertParticipant(db, userId);
    await assertMember(db, id, userId);
    const { rows: before } = await db.query(
      `SELECT name,description,github_url,demo_url,devpost_url,presentation_timing_preference,linked_repo_id FROM planned_work_groups WHERE id=$1 FOR UPDATE`,
      [id],
    );
    if (!before[0]) throw new NotFoundError("Work group not found");
    const b = before[0];
    const { rows } = await db.query(
      `UPDATE planned_work_groups SET name=$2,description=$3,github_url=$4,demo_url=$5,devpost_url=$6,presentation_timing_preference=$7,
       linked_repo_id = CASE WHEN $8::text IS DISTINCT FROM $9::text THEN (SELECT id FROM repos WHERE devpost_url = $8 LIMIT 1) ELSE linked_repo_id END
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
        input.devpostUrl === undefined ? b.devpost_url : input.devpostUrl,
        b.devpost_url,
      ],
    );
    await audit(db, {
      actorId: userId,
      entityType: "planned_work_group",
      entityId: id,
      action: "update",
      before: b,
      after: rows[0],
      source: "participant",
    });
    return rows[0];
  });
}
export async function removeMember(userId: number, id: number, memberId: number) {
  return withTransaction(async (db) => {
    await assertParticipant(db, userId);
    await assertMember(db, id, userId);
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

/** #854 boundary: import and assignment link exact, canonical Devpost URLs only. */
export async function linkExactDevpostImports(
  db: Queryable,
  actorId: number,
  imports: Array<{ id: number; devpostUrl: string | null }>,
) {
  const urls = imports.flatMap((repo) => (repo.devpostUrl ? [repo.devpostUrl] : []));
  if (!urls.length) return;
  const { rows } = await db.query(
    `UPDATE planned_work_groups g SET linked_repo_id = r.id
     FROM repos r WHERE r.devpost_url = g.devpost_url AND r.devpost_url = ANY($1::text[])
       AND g.linked_repo_id IS NULL
     RETURNING g.id, g.name, r.id AS repo_id`,
    [urls],
  );
  for (const row of rows)
    await audit(db, {
      actorId,
      entityType: "planned_work_group",
      entityId: row.id,
      action: "link_exact_devpost_import",
      after: { repoId: row.repo_id },
      source: "admin",
    });
}
export async function invite(userId: number, id: number, email: string) {
  return withTransaction(async (db) => {
    await assertParticipant(db, userId);
    await assertMember(db, id, userId);
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
    await assertJudgingHasNotStarted(db);
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
  const { rows } = await pool.query(
    `WITH scope AS (SELECT EXISTS(SELECT 1 FROM user_effective_capabilities WHERE user_id=$1 AND capability IN ('projects:read','*')) staff), allowed AS (SELECT c.id,c.title FROM challenges c JOIN sponsors author ON author.id=c.author WHERE (SELECT staff FROM scope) OR EXISTS (SELECT 1 FROM sponsors mine WHERE mine.enterprise_id=author.enterprise_id AND mine.user_id=$1)) SELECT c.id AS "challengeId",c.title, count(DISTINCT gc.group_id)::int AS "groupCount", count(DISTINCT m.user_id) FILTER (WHERE m.status='active')::int AS "participantCount" FROM allowed c LEFT JOIN planned_work_group_challenges gc ON gc.challenge_id=c.id LEFT JOIN planned_work_group_members m ON m.group_id=gc.group_id GROUP BY c.id,c.title ORDER BY c.title`,
    [userId],
  );
  const access = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM user_effective_capabilities WHERE user_id=$1 AND capability IN ('projects:read','*')) OR EXISTS(SELECT 1 FROM sponsors WHERE user_id=$1) ok`,
    [userId],
  );
  if (!access.rows[0]?.ok)
    throw new ForbiddenError("Not allowed to read planned participation estimates");
  return rows;
}
export async function announceChanged() {
  await broadcast(SSE_TOPICS.PROJECTS, EVENTS.DOMAIN_CHANGED, { domain: "work-groups" });
}
