import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { projectDescriptionField } from "@hackos/shared/forms";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { deletePrefix } from "../../lib/storage.js";
import { validateResponses } from "../applications/service.js";
import { visibleWinnerRows } from "../challenges/winner-publication.js";
import { validateLibraryAnswers } from "../form-libraries/service.js";
import { hasEventAccess } from "../identity/role.js";
import {
  assertFixtureSubjectScope,
  isSyntheticOperator,
} from "../logistics/review-fixture-scope.js";
import { notify } from "../notifications/service.js";
import {
  broadcastQueueEvent,
  broadcastQueueEventWithMarker,
  queueFixtureMarker,
} from "../queue/broadcast.js";
import { assertQueueChallengeScope, assertQueueRepoScope } from "../queue/fixture-scope.js";
import { writeQueueHistory } from "../queue/history.js";
import { notifyChallengeQueueChanged } from "../queue/notify.js";
import { compactQueueGroupPositions, nextBottomPosition } from "../queue/ordering.js";
import { RESET_PRESENTATION_CLOCK_SQL } from "../queue/presentation-clock.js";
import { type RepositoryAccessScope, repositoryIdsForScope } from "./access.js";
import { nativeEditable, nativeForm, nativeProjects, snapshotProjectSubmission } from "./native.js";
import { assertProjectWindow, projectPhase } from "./policy.js";

interface EnqueueOutcome {
  entry: Record<string, unknown> & { id: number; challenge_id: number };
  inserted: boolean;
  revived: boolean;
}

/**
 * Core of H21's "apuntar un equipo a un reto": appends the repo at the
 * BOTTOM of the challenge's queue, reviving a terminal (cancelled /
 * disqualified / completed) entry instead of duplicating it. Writes exactly
 * one queue_history row + one audit row per mutation (plan/07 invariant 5).
 * Returns null when the repo is already actively queued (no-op). The caller
 * owns the transaction and must broadcast QUEUE_ENTRY_CHANGED + notify the
 * challenge AFTER commit for every non-null outcome.
 *
 * `challengeMarker`/`allocatePosition` let a bulk caller (H21 "enroll ALL
 * projects") hoist the challenge-scope check and the queue's bottom-position
 * lock out of the per-repo loop instead of re-running both once per repo —
 * see `bulkAddRepoChallenge`. Single-repo callers omit them and get the
 * original per-call behavior unchanged.
 */
export async function enqueueRepoOnChallenge(
  client: Queryable,
  actorId: number,
  repoId: number,
  challengeId: number,
  auditSource: string,
  challengeMarker?: boolean,
  allocatePosition: () => Promise<number> = () => nextBottomPosition(client, challengeId),
): Promise<EnqueueOutcome | null> {
  const repoMarker = await assertQueueRepoScope(client, actorId, repoId);
  const resolvedChallengeMarker =
    challengeMarker ?? (await assertQueueChallengeScope(client, actorId, challengeId));
  if (repoMarker !== resolvedChallengeMarker) {
    throw new ConflictError("Queue fixture markers must match", {
      code: "review_fixture_scope",
      repoId,
      challengeId,
    });
  }
  const existing = await client.query(
    `SELECT * FROM queue_entries WHERE repo_id = $1 AND challenge_id = $2 FOR UPDATE`,
    [repoId, challengeId],
  );
  if (existing.rows[0]) {
    const entry = existing.rows[0] as { id: number; status: string };
    if (!["cancelled", "disqualified", "completed"].includes(entry.status)) return null;
    const position = await allocatePosition();
    const revived = await client.query(
      `UPDATE queue_entries
          SET status = 'waiting', position = $1, assigned_room_id = NULL,
              called_at = NULL, precalled_at = NULL, presentation_started_at = NULL,
              ${RESET_PRESENTATION_CLOCK_SQL}, completed_at = NULL
        WHERE id = $2
        RETURNING *`,
      [position, entry.id],
    );
    await writeQueueHistory(client, {
      entryId: entry.id,
      actorId,
      previousStatus: entry.status,
      newStatus: "waiting",
      action: "re_enter",
      reason: "Added back to challenge",
      metadata: { position: "bottom" },
    });
    await audit(client, {
      actorId,
      entityType: "queue_entry",
      entityId: entry.id,
      action: "re_enter",
      before: { status: entry.status },
      after: { status: "waiting", position: "bottom" },
      reason: "Added back to challenge",
      source: auditSource,
    });
    return { entry: revived.rows[0], inserted: false, revived: true };
  }

  const position = await allocatePosition();
  const inserted = await client.query(
    `INSERT INTO queue_entries (challenge_id, repo_id, status, position)
     VALUES ($1, $2, 'waiting', $3)
     RETURNING *`,
    [challengeId, repoId, position],
  );
  const entry = inserted.rows[0];
  await client.query(
    `INSERT INTO queue_history
       (queue_entry_id, actor_id, previous_status, new_status, action, metadata)
     VALUES ($1, $2, 'none', 'waiting', 'enqueue', $3)`,
    [entry.id, actorId, JSON.stringify({ source: "project_edit" })],
  );
  await audit(client, {
    actorId,
    entityType: "queue_entry",
    entityId: entry.id,
    action: "add_challenge",
    after: { repoId, challengeId, status: "waiting", position },
    source: auditSource,
  });
  return { entry, inserted: true, revived: false };
}

export async function announceQueueOutcomes(outcomes: EnqueueOutcome[]): Promise<void> {
  await Promise.all(
    outcomes.map((outcome) =>
      broadcastQueueEvent(
        pool,
        "entry",
        outcome.entry.id,
        EVENTS.QUEUE_ENTRY_CHANGED,
        outcome.entry,
      ),
    ),
  );
  const challengeIds = new Set(outcomes.map((outcome) => outcome.entry.challenge_id));
  await Promise.all(
    [...challengeIds].map((challengeId) => notifyChallengeQueueChanged(pool, challengeId)),
  );
}

export async function enrollReposInMandatoryChallenges(
  client: Queryable,
  actorId: number,
  repoIds: number[],
  onlyChallengeIds?: number[],
): Promise<EnqueueOutcome[]> {
  const uniqueRepoIds = [...new Set(repoIds)];
  if (uniqueRepoIds.length === 0) return [];
  const fixtureMarker = await isSyntheticOperator(client, actorId);
  const { rows } = await client.query(
    `SELECT id, mandatory FROM challenges
      WHERE is_test_account = $1
        ${onlyChallengeIds ? "AND id = ANY($2::int[])" : ""}
      ORDER BY id FOR SHARE`,
    onlyChallengeIds ? [fixtureMarker, onlyChallengeIds] : [fixtureMarker],
  );
  const outcomes: EnqueueOutcome[] = [];
  for (const row of rows as Array<{ id: number; mandatory: boolean }>) {
    if (row.mandatory !== true) continue;
    const challengeId = Number(row.id);
    let nextPosition = await nextBottomPosition(client, challengeId);
    const allocatePosition = async () => nextPosition++;
    for (const repoId of uniqueRepoIds) {
      await client.query(
        `INSERT INTO project_challenges(repo_id,challenge_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
        [repoId, challengeId],
      );
      const project = await client.query(`SELECT submission_status FROM repos WHERE id=$1`, [
        repoId,
      ]);
      if (project.rows[0]?.submission_status !== "submitted") continue;
      const outcome = await enqueueRepoOnChallenge(
        client,
        actorId,
        repoId,
        challengeId,
        "mandatory_challenge",
        fixtureMarker,
        allocatePosition,
      );
      if (outcome) outcomes.push(outcome);
    }
  }
  return outcomes;
}

export interface PublicChallenge {
  id: number;
  title: Record<string, string>;
  description: Record<string, string>;
  criteria: Record<string, string>;
  prizes: unknown;
  availableFrom: string | null;
  enterprise: {
    id: number;
    name: string;
    logoUrl: string | null;
    logoNegativeUrl: string | null;
    website: string | null;
  };
}

function translationsOf(i18n: unknown, fallback: string | null): Record<string, string> {
  const translations: Record<string, string> = {};
  if (i18n && typeof i18n === "object" && !Array.isArray(i18n)) {
    for (const [locale, value] of Object.entries(i18n as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) translations[locale] = value;
    }
  }
  if (Object.keys(translations).length === 0 && fallback?.trim()) translations.en = fallback;
  return translations;
}

export async function listPublicChallenges(
  userId: number | null = null,
): Promise<PublicChallenge[]> {
  const { rows } = await pool.query(
    `SELECT c.id,
            c.title,
            c.title_i18n,
            c.description,
            c.description_i18n,
            c.criteria,
            c.criteria_i18n,
            c.prizes,
            c.available_from,
            e.id AS enterprise_id,
            e.name AS enterprise_name,
            e.logo_url AS enterprise_logo_url,
            COALESCE(e.logo_negative_url, e.logo_url) AS enterprise_logo_negative_url,
            e.website AS enterprise_website
       FROM challenges c
       JOIN sponsors s ON s.id = c.author
       JOIN enterprises e ON e.id = s.enterprise_id
      WHERE c.visibility = 'visible' AND c.is_test_account = false
      ORDER BY c.available_from NULLS FIRST, c.id ASC`,
  );

  const winners = await visibleWinnerRows(pool, userId);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    ...(winners.some((w) => w.challengeId === Number(r.id))
      ? { winners: winners.filter((w) => w.challengeId === Number(r.id)) }
      : {}),
    title: translationsOf(r.title_i18n, String(r.title ?? "")),
    description: translationsOf(r.description_i18n, String(r.description ?? "")),
    criteria: translationsOf(r.criteria_i18n, (r.criteria as string | null) ?? null),
    prizes: r.prizes ?? [],
    availableFrom:
      r.available_from instanceof Date
        ? r.available_from.toISOString()
        : (r.available_from as null),
    enterprise: {
      id: Number(r.enterprise_id),
      name: String(r.enterprise_name),
      logoUrl: (r.enterprise_logo_url as string | null) ?? null,
      logoNegativeUrl: (r.enterprise_logo_negative_url as string | null) ?? null,
      website: (r.enterprise_website as string | null) ?? null,
    },
  }));
}

// Public sponsors moved to the sponsors module (enterprise-driven reveal,
// H45). See apps/api/src/modules/sponsors/service.ts#listPublicSponsors.

export { createNativeDraft as createMyProject } from "./native.js";
export async function isAdmittedParticipant(db: Queryable, userId: number) {
  return hasEventAccess(db, userId);
}
export async function isActiveProjectMember(db: Queryable, repoId: number, userId: number) {
  return !!(
    await db.query(
      `SELECT 1 FROM submissions s JOIN users u ON u.id=s.user_id WHERE repo_id=$1 AND user_id=$2 AND status='active' AND u.account_state='active' AND u.anonymized_at IS NULL`,
      [repoId, userId],
    )
  ).rowCount;
}
export async function activeProjectMemberCount(db: Queryable, repoId: number) {
  return Number(
    (
      await db.query(`SELECT count(*) FROM submissions WHERE repo_id=$1 AND status='active'`, [
        repoId,
      ])
    ).rows[0].count,
  );
}
export async function hasMyProject(userId: number, db: Queryable = pool) {
  return !!(
    await db.query(`SELECT 1 FROM submissions WHERE user_id=$1 AND status='active' LIMIT 1`, [
      userId,
    ])
  ).rowCount;
}
export async function canCreateMyProject(userId: number, db: Queryable = pool) {
  return (await projectPhase(db)).editing && (await hasEventAccess(db, userId));
}
export async function myProjects(userId: number) {
  const { rows } = await pool.query(
    `SELECT s.repo_id FROM submissions s JOIN repos r ON r.id=s.repo_id JOIN users u ON u.id=s.user_id WHERE s.user_id=$1 AND s.status='active' AND r.is_test_account=u.is_test_account ORDER BY s.repo_id`,
    [userId],
  );
  return nativeProjects(
    userId,
    rows.map((row) => row.repo_id),
  );
}
export async function listReposForScope(scope: RepositoryAccessScope) {
  const ids = scope.fullAccess
    ? (
        await pool.query(`SELECT id FROM repos WHERE is_test_account=$1 ORDER BY id`, [
          scope.fixtureMarker === true,
        ])
      ).rows.map((row) => row.id)
    : await repositoryIdsForScope(scope);
  return Promise.all(ids.map((id) => staffProject(id, scope)));
}
export async function getRepoForScope(id: number, scope: RepositoryAccessScope) {
  return staffProject(id, scope);
}
async function staffProject(id: number, scope: RepositoryAccessScope) {
  const exists = await pool.query(`SELECT id FROM repos WHERE id=$1 AND is_test_account=$2`, [
    id,
    scope.fixtureMarker === true,
  ]);
  if (!exists.rowCount) throw new NotFoundError("Project not found");
  return {
    ...(await nativeProjects(null, [id], { staff: scope.fullAccess }))[0],
    canInspect: true,
    canEdit: scope.canEdit === true,
    canSubmit: false,
    canInvite: false,
  };
}
export async function listProjectMemberCandidates(q: string, limit: number, actorId: number) {
  const marker = await isSyntheticOperator(pool, actorId);
  return (
    await pool.query(
      `SELECT id,email,name,surname FROM users WHERE is_test_account=$3 AND account_state='active' AND anonymized_at IS NULL AND (email ILIKE '%'||$1||'%' OR name ILIKE '%'||$1||'%') ORDER BY id LIMIT $2`,
      [q, limit, marker],
    )
  ).rows;
}
export async function addRepoMember(actorId: number, id: number, userId: number) {
  return withTransaction(async (db) => {
    await db.query(`SELECT id FROM repos WHERE id=$1 FOR UPDATE`, [id]);
    await assertQueueRepoScope(db, actorId, id);
    await assertFixtureSubjectScope(db, actorId, userId);
    await db.query(
      `INSERT INTO submissions(repo_id,user_id,status) VALUES($1,$2,'active') ON CONFLICT(repo_id,user_id) DO UPDATE SET status='active'`,
      [id, userId],
    );
    await audit(db, {
      actorId,
      entityType: "project",
      entityId: id,
      action: "member_add",
      after: { userId },
    });
    return { repoId: id, userId };
  });
}
export async function removeRepoMember(actorId: number, id: number, userId: number) {
  return withTransaction(async (db) => {
    await db.query(`SELECT id FROM repos WHERE id=$1 FOR UPDATE`, [id]);
    await assertQueueRepoScope(db, actorId, id);
    await db.query(`DELETE FROM submissions WHERE repo_id=$1 AND user_id=$2`, [id, userId]);
    await audit(db, {
      actorId,
      entityType: "project",
      entityId: id,
      action: "member_remove",
      before: { userId },
    });
    return { removed: true };
  });
}
export async function updateRepo(
  actorId: number,
  id: number,
  patch: UpdateRepoPatch,
  participant = false,
) {
  return withTransaction(async (db) => {
    const before = participant
      ? await nativeEditable(db, actorId, id)
      : (await db.query(`SELECT * FROM repos WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!before) throw new NotFoundError("Project not found");
    if (!participant) await assertQueueRepoScope(db, actorId, id);
    if (
      patch.presentationTimingPreference !== undefined &&
      patch.presentationTimingPreference !== before.presentation_timing_preference &&
      (await db.query(`SELECT 1 FROM queue_entries WHERE repo_id=$1 LIMIT 1`, [id])).rowCount
    )
      throw new ConflictError("Judging preference is locked after queue generation");
    await db.query(
      `UPDATE repos SET name=$2,description=$3,github_url=$4,demo_url=$5,presentation_timing_preference=$6 WHERE id=$1`,
      [
        id,
        patch.name ?? before.name,
        patch.description ?? before.description,
        patch.githubUrl === undefined ? before.github_url : patch.githubUrl,
        patch.demoUrl === undefined ? before.demo_url : patch.demoUrl,
        patch.presentationTimingPreference ?? before.presentation_timing_preference,
      ],
    );
    if (!participant && before.submission_status === "submitted")
      await snapshotProjectSubmission(
        db,
        actorId,
        id,
        (await nativeForm(db))?.version ?? null,
        "admin",
      );
    await audit(db, {
      actorId,
      entityType: "project",
      entityId: id,
      action: "update",
      before,
      after: patch,
      source: participant ? "participant" : "admin",
    });
    return (
      await db.query(`SELECT id,name,description,github_url,demo_url FROM repos WHERE id=$1`, [id])
    ).rows[0];
  });
}
export interface UpdateRepoPatch {
  name?: string;
  description?: string;
  githubUrl?: string | null;
  demoUrl?: string | null;
  presentationTimingPreference?: string;
}
export async function updateMyProject(userId: number, id: number, patch: UpdateRepoPatch) {
  return updateRepo(userId, id, patch, true);
}
export async function inviteProjectMember(
  actorId: number,
  id: number,
  invitee: { email?: string; userId?: number },
) {
  return withTransaction(async (db) => {
    await nativeEditable(db, actorId, id);
    // H19: a user id is only accepted for the inviter's own diary contacts, so
    // ids cannot be used to reach people the inviter never met.
    const { rows } =
      invitee.userId !== undefined
        ? await db.query(
            `SELECT u.id FROM users u JOIN diary_entries d ON d.target_user_id=u.id AND d.owner_id=$2 WHERE u.id=$1 AND u.account_state='active' AND u.anonymized_at IS NULL`,
            [invitee.userId, actorId],
          )
        : await db.query(
            `SELECT id FROM users WHERE lower(email)=lower($1) AND account_state='active' AND anonymized_at IS NULL`,
            [invitee.email],
          );
    if (!rows[0]) throw new NotFoundError("Account not found");
    const userId = rows[0].id;
    await assertFixtureSubjectScope(db, actorId, userId);
    if (await isActiveProjectMember(db, id, userId))
      throw new ConflictError("Already an active project member");
    if (!(await hasEventAccess(db, userId))) throw new ForbiddenError("Invitee needs event access");
    await db.query(
      `INSERT INTO submissions(repo_id,user_id,status,invited_by) VALUES($1,$2,'invited',$3) ON CONFLICT(repo_id,user_id) DO UPDATE SET status=CASE WHEN submissions.status='active' THEN 'active' ELSE 'invited' END,invited_by=$3`,
      [id, userId, actorId],
    );
    await audit(db, {
      actorId,
      entityType: "project",
      entityId: id,
      action: "invite",
      after: { userId },
    });
    await notify(db, {
      userId,
      category: "project",
      actorId,
      payload: {
        template: "project.invite",
        vars: {
          projectName: (await db.query("SELECT name FROM repos WHERE id=$1", [id])).rows[0].name,
          inviterName:
            (await db.query("SELECT name FROM users WHERE id=$1", [actorId])).rows[0].name ?? "",
        },
      },
    });
    return { id, projectId: id, userId };
  });
}
export async function myPendingInvites(userId: number) {
  return (
    await pool.query(
      `SELECT r.id,r.id AS "projectId",r.name,NULLIF(trim(concat_ws(' ',inviter.name,inviter.surname)), '') AS "invitedBy" FROM submissions s JOIN repos r ON r.id=s.repo_id LEFT JOIN users inviter ON inviter.id=s.invited_by AND inviter.account_state='active' AND inviter.anonymized_at IS NULL WHERE s.user_id=$1 AND s.status='invited' ORDER BY s.created_at DESC`,
      [userId],
    )
  ).rows;
}
async function respondInvite(userId: number, id: number, status: "active" | "declined") {
  return withTransaction(async (db) => {
    await db.query(`SELECT id FROM repos WHERE id=$1 FOR UPDATE`, [id]);
    const invited = await db.query(
      `SELECT 1 FROM submissions WHERE repo_id=$1 AND user_id=$2 AND status='invited'`,
      [id, userId],
    );
    if (!invited.rowCount) throw new NotFoundError("Invitation not found");
    await assertProjectWindow(db);
    if (!(await hasEventAccess(db, userId))) throw new ForbiddenError("Event access required");
    if (status === "active") {
      const size = await db.query(`SELECT project_max_team_size FROM event_config WHERE id=1`);
      if (
        size.rows[0]?.project_max_team_size &&
        (await activeProjectMemberCount(db, id)) >= size.rows[0].project_max_team_size
      )
        throw new ConflictError("Project team is full");
      await assertFixtureSubjectScope(
        db,
        userId,
        (
          await db.query(
            `SELECT user_id FROM submissions WHERE repo_id=$1 AND status='active' ORDER BY user_id LIMIT 1`,
            [id],
          )
        ).rows[0]?.user_id ?? userId,
      );
    }
    const result = await db.query(
      `UPDATE submissions SET status=$3,responded_at=now() WHERE repo_id=$1 AND user_id=$2 AND status='invited' RETURNING user_id`,
      [id, userId, status],
    );
    if (!result.rowCount) throw new NotFoundError("Invitation not found");
    await audit(db, {
      actorId: userId,
      entityType: "project",
      entityId: id,
      action: "invite_response",
      after: { status },
    });
    return { id, status };
  });
}
export async function acceptProjectInvite(userId: number, id: number) {
  return respondInvite(userId, id, "active");
}
export async function declineProjectInvite(userId: number, id: number) {
  return respondInvite(userId, id, "declined");
}
export async function leaveMyProject(userId: number, id: number) {
  return withTransaction(async (db) => {
    await nativeEditable(db, userId, id);
    if ((await activeProjectMemberCount(db, id)) <= 1)
      throw new ConflictError("Last member must delete the project");
    await db.query(`DELETE FROM submissions WHERE repo_id=$1 AND user_id=$2`, [id, userId]);
    await audit(db, { actorId: userId, entityType: "project", entityId: id, action: "leave" });
    return { left: true };
  });
}
export async function addRepoChallenge(
  actorId: number,
  id: number,
  challengeId: number,
  participant = false,
) {
  const result = await withTransaction(async (db) => {
    if (participant) await nativeEditable(db, actorId, id);
    else await db.query(`SELECT id FROM repos WHERE id=$1 FOR UPDATE`, [id]);
    const challenge = await db.query(
      `SELECT id,visibility,is_test_account FROM challenges WHERE id=$1`,
      [challengeId],
    );
    if (!challenge.rows[0] || (participant && challenge.rows[0].visibility !== "visible"))
      throw new NotFoundError("Challenge not found");
    const marker = await assertQueueRepoScope(db, actorId, id);
    if (marker !== challenge.rows[0].is_test_account)
      throw new ForbiddenError("Project and challenge scope differ");
    await db.query(
      `INSERT INTO project_challenges(repo_id,challenge_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
      [id, challengeId],
    );
    await audit(db, {
      actorId,
      entityType: "project",
      entityId: id,
      action: "challenge_add",
      after: { challengeId },
    });
    const generated = await db.query(`SELECT 1 FROM queue_group_challenges WHERE challenge_id=$1`, [
      challengeId,
    ]);
    const submitted =
      (await db.query(`SELECT submission_status FROM repos WHERE id=$1`, [id])).rows[0]
        ?.submission_status === "submitted";
    return generated.rowCount && (submitted || !participant)
      ? await enqueueRepoOnChallenge(
          db,
          actorId,
          id,
          challengeId,
          participant ? "participant" : "admin",
        )
      : null;
  });
  if (result) await announceQueueOutcomes([result]);
  return {
    repoId: id,
    challengeId,
    entry: result?.entry ?? null,
    inserted: result?.inserted ?? false,
    revived: result?.revived ?? false,
  };
}
export async function addMyProjectChallenge(userId: number, id: number, challengeId: number) {
  return addRepoChallenge(userId, id, challengeId, true);
}
export async function removeRepoChallenge(
  actorId: number,
  id: number,
  challengeId: number,
  participant = false,
) {
  const entry = await withTransaction(async (db) => {
    if (participant) await nativeEditable(db, actorId, id);
    else await db.query(`SELECT id FROM repos WHERE id=$1 FOR UPDATE`, [id]);
    await assertQueueRepoScope(db, actorId, id);
    await assertQueueChallengeScope(db, actorId, challengeId);
    const challenge = await db.query(`SELECT mandatory FROM challenges WHERE id=$1 FOR SHARE`, [
      challengeId,
    ]);
    if (challenge.rows[0]?.mandatory)
      throw new ConflictError("Mandatory challenge cannot be withdrawn");
    await db.query(`DELETE FROM project_challenges WHERE repo_id=$1 AND challenge_id=$2`, [
      id,
      challengeId,
    ]);
    const old = await db.query(
      `SELECT * FROM queue_entries WHERE repo_id=$1 AND challenge_id=$2 FOR UPDATE`,
      [id, challengeId],
    );
    await audit(db, {
      actorId,
      entityType: "project",
      entityId: id,
      action: "challenge_remove",
      before: { challengeId },
    });
    if (!old.rows[0]) return null;
    const status = ["waiting", "called"].includes(old.rows[0].status)
      ? "cancelled"
      : "disqualified";
    const updated = await db.query(
      `UPDATE queue_entries SET status=$2,assigned_room_id=NULL,position=NULL,called_at=NULL,precalled_at=NULL,presentation_started_at=NULL,${RESET_PRESENTATION_CLOCK_SQL},completed_at=NULL WHERE id=$1 RETURNING *`,
      [old.rows[0].id, status],
    );
    await writeQueueHistory(db, {
      entryId: old.rows[0].id,
      actorId,
      previousStatus: old.rows[0].status,
      newStatus: status,
      action: "remove_from_challenge",
    });
    await compactQueueGroupPositions(db, challengeId);
    return updated.rows[0];
  });
  if (entry) {
    await broadcastQueueEvent(pool, "entry", entry.id, EVENTS.QUEUE_ENTRY_CHANGED, entry);
    await notifyChallengeQueueChanged(pool, challengeId);
  }
  return { removed: true };
}
export async function removeMyProjectChallenge(userId: number, id: number, challengeId: number) {
  return removeRepoChallenge(userId, id, challengeId, true);
}
export async function bulkAddRepoChallenge(actorId: number, challengeId: number) {
  await assertBulkChallenge(actorId, challengeId);
  const { rows } = await pool.query(
    `SELECT id,EXISTS(SELECT 1 FROM queue_entries qe WHERE qe.repo_id=r.id AND qe.challenge_id=$1 AND qe.status NOT IN('cancelled','disqualified','completed')) AS queued FROM repos r WHERE submission_status='submitted' AND is_test_account=$2 ORDER BY id`,
    [challengeId, await isSyntheticOperator(pool, actorId)],
  );
  let added = 0;
  for (const row of rows)
    if (!row.queued) {
      await addRepoChallenge(actorId, row.id, challengeId);
      added++;
    }
  return { total: rows.length, added, alreadyEnrolled: rows.length - added };
}
export async function bulkRemoveRepoChallenge(actorId: number, challengeId: number) {
  await assertBulkChallenge(actorId, challengeId);
  const { rows } = await pool.query(
    `SELECT r.id AS repo_id,
            (EXISTS(SELECT 1 FROM project_challenges pc WHERE pc.repo_id=r.id AND pc.challenge_id=$1)
             OR EXISTS(SELECT 1 FROM queue_entries qe WHERE qe.repo_id=r.id AND qe.challenge_id=$1
                         AND qe.status NOT IN('cancelled','disqualified'))) AS active
       FROM repos r
      WHERE r.is_test_account=$2
        AND (EXISTS(SELECT 1 FROM project_challenges pc WHERE pc.repo_id=r.id AND pc.challenge_id=$1)
          OR EXISTS(SELECT 1 FROM queue_entries qe WHERE qe.repo_id=r.id AND qe.challenge_id=$1))
      ORDER BY r.id`,
    [challengeId, await isSyntheticOperator(pool, actorId)],
  );
  const active = rows.filter((row) => row.active);
  for (const row of active) await removeRepoChallenge(actorId, row.repo_id, challengeId);
  return {
    total: rows.length,
    removed: active.length,
    alreadySkipped: rows.length - active.length,
  };
}
async function assertBulkChallenge(actorId: number, challengeId: number) {
  await assertQueueChallengeScope(pool, actorId, challengeId);
  const challenge = await pool.query(`SELECT id FROM challenges WHERE id=$1`, [challengeId]);
  if (!challenge.rows[0]) throw new NotFoundError(`Challenge ${challengeId} not found`);
}
export async function createRepoNative(
  actorId: number,
  input: {
    name: string;
    description: string;
    githubUrl: string | null;
    demoUrl: string | null;
    memberUserIds: number[];
    challengeIds: number[];
    responses?: Record<string, unknown>;
  },
) {
  const result = await withTransaction(async (db) => {
    const marker = await isSyntheticOperator(db, actorId);
    const responses = input.responses ?? {};
    const form = await nativeForm(db);
    validateResponses(
      (form?.template ?? []).map((field: import("@hackos/shared/forms").TemplateField) => ({
        ...field,
        required: false,
      })),
      responses,
    );
    await validateLibraryAnswers(db, form?.template ?? [], responses, actorId);
    const descriptionField = projectDescriptionField(form?.template ?? []);
    const descriptionAnswer = descriptionField ? responses[descriptionField.key] : undefined;
    const description =
      typeof descriptionAnswer === "string" ? descriptionAnswer.trim() : input.description;
    for (const userId of new Set(input.memberUserIds)) {
      const user = await db.query(
        `SELECT id FROM users WHERE id=$1 AND account_state='active' AND anonymized_at IS NULL AND is_test_account=$2`,
        [userId, marker],
      );
      if (!user.rowCount) throw new NotFoundError("Project member not found");
    }
    for (const challengeId of new Set(input.challengeIds)) {
      const challenge = await db.query(
        `SELECT id FROM challenges WHERE id=$1 AND is_test_account=$2`,
        [challengeId, marker],
      );
      if (!challenge.rowCount) throw new NotFoundError("Challenge not found");
    }
    const { rows } = await db.query(
      `INSERT INTO repos(name,description,github_url,demo_url,created_by,submission_status,submitted_via,submitted_at,is_test_account,responses) VALUES($1,$2,$3,$4,$5,'submitted','admin',now(),$6,$7) RETURNING id`,
      [
        input.name,
        description,
        input.githubUrl,
        input.demoUrl,
        actorId,
        marker,
        JSON.stringify(responses),
      ],
    );
    const id = rows[0].id;
    for (const userId of new Set(input.memberUserIds))
      await db.query(`INSERT INTO submissions(repo_id,user_id,status) VALUES($1,$2,'active')`, [
        id,
        userId,
      ]);
    const challengeIds = new Set(input.challengeIds);
    const mandatory = await db.query(
      `SELECT id FROM challenges WHERE mandatory AND is_test_account=$1`,
      [marker],
    );
    for (const row of mandatory.rows) challengeIds.add(row.id);
    const outcomes: EnqueueOutcome[] = [];
    for (const challengeId of challengeIds) {
      await db.query(`INSERT INTO project_challenges(repo_id,challenge_id) VALUES($1,$2)`, [
        id,
        challengeId,
      ]);
      const outcome = await enqueueRepoOnChallenge(db, actorId, id, challengeId, "admin");
      if (outcome) outcomes.push(outcome);
    }
    await snapshotProjectSubmission(db, actorId, id, form?.version ?? null, "admin");
    await audit(db, {
      actorId,
      entityType: "project",
      entityId: id,
      action: "create",
      after: input,
    });
    return { id, outcomes };
  });
  await announceQueueOutcomes(result.outcomes);
  return { id: result.id };
}
export async function deleteRepo(actorId: number, id: number, participant = false) {
  const deleted = await withTransaction(async (db) => {
    if (participant) {
      await nativeEditable(db, actorId, id);
      if ((await activeProjectMemberCount(db, id)) > 1)
        throw new ConflictError("Only sole member may delete a project");
    } else await db.query(`SELECT id FROM repos WHERE id=$1 FOR UPDATE`, [id]);
    const marker = await assertQueueRepoScope(db, actorId, id);
    const entries = (
      await db.query(
        `SELECT id,challenge_id,repo_id FROM queue_entries WHERE repo_id=$1 ORDER BY id FOR UPDATE`,
        [id],
      )
    ).rows;
    for (const entry of entries)
      if ((await queueFixtureMarker(db, "entry", entry.id)) !== marker)
        throw new ConflictError("Queue fixture markers must match");
    const memberIds = (
      await db.query(
        `SELECT s.user_id FROM submissions s JOIN users u ON u.id=s.user_id WHERE s.repo_id=$1 AND s.status='active' AND u.is_test_account=$2`,
        [id, marker],
      )
    ).rows.map((row) => row.user_id);
    await audit(db, { actorId, entityType: "project", entityId: id, action: "delete" });
    for (const table of ["attempt_review_versions", "attempt_review"])
      await db.query(
        `DELETE FROM ${table} WHERE attempt_id IN(SELECT id FROM queue_entries WHERE repo_id=$1)`,
        [id],
      );
    await db.query(
      `DELETE FROM judging_session WHERE queue_entry_id IN(SELECT id FROM queue_entries WHERE repo_id=$1)`,
      [id],
    );
    await db.query(
      `DELETE FROM queue_history WHERE queue_entry_id IN(SELECT id FROM queue_entries WHERE repo_id=$1)`,
      [id],
    );
    await db.query(`DELETE FROM challenge_winners WHERE repo_id=$1`, [id]);
    await db.query(`DELETE FROM queue_entries WHERE repo_id=$1`, [id]);
    await db.query(`DELETE FROM submissions WHERE repo_id=$1`, [id]);
    await deletePrefix(`projects/${id}/`);
    await db.query(`DELETE FROM repos WHERE id=$1`, [id]);
    return { entries, memberIds, marker };
  });
  for (const entry of deleted.entries) {
    await broadcastQueueEventWithMarker(deleted.marker, EVENTS.QUEUE_ENTRY_CHANGED, {
      ...entry,
      deleted: true,
    });
    for (const memberId of deleted.memberIds)
      await broadcast(`${SSE_TOPICS.USER_PREFIX}${memberId}`, EVENTS.USER_QUEUE_CHANGED, {
        challengeId: entry.challenge_id,
      });
    await notifyChallengeQueueChanged(pool, entry.challenge_id);
  }
  return { deleted: true };
}
export async function deleteMyProject(userId: number, id: number) {
  return deleteRepo(userId, id, true);
}
