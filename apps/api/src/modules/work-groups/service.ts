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
export async function listMine(userId: number) {
  const { rows } = await pool.query(
    `SELECT g.id, g.name, g.devpost_url, g.presentation_timing_preference, g.linked_repo_id, g.created_by, g.created_at, g.updated_at,
    coalesce(json_agg(DISTINCT jsonb_build_object('userId', m.user_id, 'name', u.name, 'surname', u.surname, 'status', m.status, 'invitedBy', m.invited_by, 'respondedAt', m.responded_at)) FILTER (WHERE m.user_id IS NOT NULL), '[]') members,
    coalesce(json_agg(DISTINCT jsonb_build_object('id', c.id, 'title', c.title)) FILTER (WHERE c.id IS NOT NULL), '[]') challenges
    FROM planned_work_groups g JOIN planned_work_group_members mine ON mine.group_id = g.id AND mine.user_id = $1
    LEFT JOIN planned_work_group_members m ON m.group_id = g.id LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN planned_work_group_challenges gc ON gc.group_id = g.id LEFT JOIN challenges c ON c.id = gc.challenge_id
    GROUP BY g.id ORDER BY g.updated_at DESC`,
    [userId],
  );
  return rows;
}
export async function createGroup(userId: number, name: string) {
  return withTransaction(async (db) => {
    await assertParticipant(db, userId);
    const { rows } = await db.query(
      `INSERT INTO planned_work_groups (name,created_by) VALUES ($1,$2) RETURNING id,name`,
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
  input: { name?: string; devpostUrl?: string | null; presentationTimingPreference?: string },
) {
  return withTransaction(async (db) => {
    await assertParticipant(db, userId);
    await assertMember(db, id, userId);
    const { rows: before } = await db.query(
      `SELECT name,devpost_url,presentation_timing_preference FROM planned_work_groups WHERE id=$1 FOR UPDATE`,
      [id],
    );
    if (!before[0]) throw new NotFoundError("Work group not found");
    const b = before[0];
    const { rows } = await db.query(
      `UPDATE planned_work_groups SET name=$2,devpost_url=$3,presentation_timing_preference=$4 WHERE id=$1 RETURNING id,name,devpost_url,presentation_timing_preference`,
      [
        id,
        input.name ?? b.name,
        input.devpostUrl === undefined ? b.devpost_url : input.devpostUrl,
        input.presentationTimingPreference ?? b.presentation_timing_preference,
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
