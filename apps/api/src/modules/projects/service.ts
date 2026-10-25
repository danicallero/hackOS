import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { projectDescriptionField } from "@hackos/shared/forms";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit, auditMany } from "../../lib/audit.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { sharedCache } from "../../lib/shared-cache.js";
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
  queueEntryFixtureMarkers,
} from "../queue/broadcast.js";
import { assertQueueChallengeScope, assertQueueRepoScope } from "../queue/fixture-scope.js";
import { writeQueueHistory } from "../queue/history.js";
import { notifyChallengeQueueChanged } from "../queue/notify.js";
import { compactQueueGroupPositions, nextBottomPosition } from "../queue/ordering.js";
import { RESET_PRESENTATION_CLOCK_SQL } from "../queue/presentation-clock.js";
import { type RepositoryAccessScope, repositoryIdsForScope } from "./access.js";
import { nativeEditable, nativeForm, nativeProjects, snapshotProjectSubmission } from "./native.js";
import { assertProjectWindow, canViewGallery, projectPhase } from "./policy.js";

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

export async function announceQueueOutcomes(
  outcomes: EnqueueOutcome[],
  /** Fixture marker the caller already resolved; skips one marker lookup per entry. */
  marker?: boolean,
): Promise<void> {
  await Promise.all(
    outcomes.map((outcome) =>
      marker === undefined
        ? broadcastQueueEvent(
            pool,
            "entry",
            outcome.entry.id,
            EVENTS.QUEUE_ENTRY_CHANGED,
            outcome.entry,
          )
        : broadcastQueueEventWithMarker(marker, EVENTS.QUEUE_ENTRY_CHANGED, outcome.entry),
    ),
  );
  const challengeIds = new Set(outcomes.map((outcome) => outcome.entry.challenge_id));
  await Promise.all(
    [...challengeIds].map((challengeId) => notifyChallengeQueueChanged(pool, challengeId)),
  );
}

/**
 * Set-based form of `enqueueRepoOnChallenge` for one challenge (H21 bulk
 * enroll). Callers have already validated fixture scope and hold the repo row
 * locks. Locks the existing entries in id order, skips actively queued repos,
 * revives terminal entries and inserts the rest at the BOTTOM in `repoIds`
 * order, with one queue_history row + one audit row per entry (plan/07
 * invariant 5) written by multi-row statements. Outcomes follow `repoIds`.
 */
async function enqueueReposOnChallenge(
  client: Queryable,
  actorId: number,
  repoIds: number[],
  challengeId: number,
  auditSource: string,
): Promise<EnqueueOutcome[]> {
  if (repoIds.length === 0) return [];
  const { rows: existingRows } = await client.query(
    `SELECT id, repo_id, status FROM queue_entries
      WHERE challenge_id = $1 AND repo_id = ANY($2::int[])
      ORDER BY id FOR UPDATE`,
    [challengeId, repoIds],
  );
  const existing = new Map<number, { id: number; status: string }>(
    existingRows.map((r: { id: number; repo_id: number; status: string }) => [
      Number(r.repo_id),
      { id: Number(r.id), status: r.status },
    ]),
  );
  const terminal = ["cancelled", "disqualified", "completed"];
  const revive: Array<{ repoId: number; entryId: number; previous: string }> = [];
  const create: number[] = [];
  for (const repoId of repoIds) {
    const entry = existing.get(repoId);
    if (!entry) create.push(repoId);
    else if (terminal.includes(entry.status))
      revive.push({ repoId, entryId: entry.id, previous: entry.status });
  }
  if (revive.length === 0 && create.length === 0) return [];

  // Bottom positions in repo order: revivals and inserts share one sequence.
  const start = await nextBottomPosition(client, challengeId);
  const order = new Map<number, number>();
  for (const [i, repoId] of repoIds.entries()) order.set(repoId, i);
  const slots = [...revive.map((r) => r.repoId), ...create].sort(
    (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
  );
  const positionOf = new Map<number, number>(slots.map((repoId, i) => [repoId, start + i]));

  const byRepo = new Map<number, EnqueueOutcome>();
  const historyRows: Array<{
    entryId: number;
    previous: string;
    action: string;
    reason: string | null;
    metadata: string;
  }> = [];
  const auditEntries: Parameters<typeof auditMany>[1][number][] = [];

  if (revive.length > 0) {
    const { rows } = await client.query(
      `UPDATE queue_entries
          SET status = 'waiting', position = t.new_position, assigned_room_id = NULL,
              called_at = NULL, precalled_at = NULL, presentation_started_at = NULL,
              ${RESET_PRESENTATION_CLOCK_SQL}, completed_at = NULL
         FROM unnest($1::int[], $2::int[]) AS t(entry_id, new_position)
        WHERE queue_entries.id = t.entry_id
        RETURNING queue_entries.*`,
      [revive.map((r) => r.entryId), revive.map((r) => positionOf.get(r.repoId))],
    );
    for (const row of rows) {
      byRepo.set(Number(row.repo_id), { entry: row, inserted: false, revived: true });
    }
    for (const r of revive) {
      historyRows.push({
        entryId: r.entryId,
        previous: r.previous,
        action: "re_enter",
        reason: "Added back to challenge",
        metadata: JSON.stringify({ position: "bottom" }),
      });
      auditEntries.push({
        actorId,
        entityType: "queue_entry",
        entityId: r.entryId,
        action: "re_enter",
        before: { status: r.previous },
        after: { status: "waiting", position: "bottom" },
        reason: "Added back to challenge",
        source: auditSource,
      });
    }
  }
  if (create.length > 0) {
    const { rows } = await client.query(
      `INSERT INTO queue_entries (challenge_id, repo_id, status, position)
       SELECT $1, t.repo_id, 'waiting', t.new_position
         FROM unnest($2::int[], $3::int[]) AS t(repo_id, new_position)
       RETURNING *`,
      [challengeId, create, create.map((repoId) => positionOf.get(repoId))],
    );
    for (const row of rows) {
      const repoId = Number(row.repo_id);
      byRepo.set(repoId, { entry: row, inserted: true, revived: false });
      historyRows.push({
        entryId: row.id,
        previous: "none",
        action: "enqueue",
        reason: null,
        metadata: JSON.stringify({ source: "project_edit" }),
      });
      auditEntries.push({
        actorId,
        entityType: "queue_entry",
        entityId: row.id,
        action: "add_challenge",
        after: { repoId, challengeId, status: "waiting", position: row.position },
        source: auditSource,
      });
    }
  }
  await client.query(
    `INSERT INTO queue_history
       (queue_entry_id, actor_id, previous_status, new_status, action, reason, metadata)
     SELECT t.entry_id, $1, t.previous, 'waiting', t.action, t.reason, t.metadata::jsonb
       FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[])
            AS t(entry_id, previous, action, reason, metadata)`,
    [
      actorId,
      historyRows.map((h) => h.entryId),
      historyRows.map((h) => h.previous),
      historyRows.map((h) => h.action),
      historyRows.map((h) => h.reason),
      historyRows.map((h) => h.metadata),
    ],
  );
  await auditMany(client, auditEntries);
  return repoIds.flatMap((repoId) => {
    const outcome = byRepo.get(repoId);
    return outcome ? [outcome] : [];
  });
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
  const { rows: submittedRows } = await client.query(
    `SELECT id FROM repos WHERE id=ANY($1::int[]) AND submission_status='submitted'`,
    [uniqueRepoIds],
  );
  const submittedRepoIds = new Set<number>(submittedRows.map((r: { id: number }) => Number(r.id)));
  const outcomes: EnqueueOutcome[] = [];
  for (const row of rows as Array<{ id: number; mandatory: boolean }>) {
    if (row.mandatory !== true) continue;
    const challengeId = Number(row.id);
    let nextPosition = await nextBottomPosition(client, challengeId);
    const allocatePosition = async () => nextPosition++;
    await client.query(
      `INSERT INTO project_challenges(repo_id,challenge_id) SELECT r,$2 FROM unnest($1::int[]) AS r ON CONFLICT DO NOTHING`,
      [uniqueRepoIds, challengeId],
    );
    for (const repoId of uniqueRepoIds) {
      if (!submittedRepoIds.has(repoId)) continue;
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
  // Identical for every viewer except whether published winners are shown (H45, H60).
  const winnersVisible = await canViewGallery(pool, userId);
  return sharedCache("public-content", `challenges:${winnersVisible}`, 15, () =>
    computePublicChallenges(winnersVisible),
  );
}
async function computePublicChallenges(winnersVisible: boolean): Promise<PublicChallenge[]> {
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

  const winners = winnersVisible ? await visibleWinnerRows(pool, null, undefined, true) : [];
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
    if (!participant && patch.githubUrl !== undefined) {
      // A repository entered by hand replaces the App link: its tracked activity belongs to another repo.
      const dropped = await db.query(
        `DELETE FROM github_repo_links WHERE repo_id=$1 AND lower($2::text) IS DISTINCT FROM lower('https://github.com/'||full_name) RETURNING full_name`,
        [id, patch.githubUrl],
      );
      if (dropped.rowCount) {
        await db.query(`DELETE FROM github_commits WHERE repo_id=$1`, [id]);
        await db.query(`DELETE FROM github_pull_requests WHERE repo_id=$1`, [id]);
        await audit(db, {
          actorId,
          entityType: "project_github_link",
          entityId: id,
          action: "unlink",
          before: { fullName: dropped.rows[0].full_name },
          source: "admin",
        });
      }
    }
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
    await nativeEditable(db, userId, id, { allowSubmitted: true });
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
    if (participant) await nativeEditable(db, actorId, id, { allowSubmitted: true });
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
  const marker = await isSyntheticOperator(pool, actorId);
  const { outcomes, total, added } = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT r.id,
              EXISTS(SELECT 1 FROM queue_entries qe
                      WHERE qe.repo_id=r.id AND qe.challenge_id=$1
                        AND qe.status NOT IN('cancelled','disqualified','completed')) AS queued
         FROM repos r
        WHERE r.submission_status='submitted' AND r.is_test_account=$2
        ORDER BY r.id`,
      [challengeId, marker],
    );
    const candidates: number[] = rows.filter((r) => !r.queued).map((r) => Number(r.id));
    // Lock in id order, then re-read the queue state a concurrent bulk call may have changed.
    await db.query(`SELECT id FROM repos WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE`, [
      candidates,
    ]);
    const { rows: active } = await db.query(
      `SELECT repo_id FROM queue_entries
        WHERE challenge_id=$1 AND repo_id=ANY($2::int[])
          AND status NOT IN('cancelled','disqualified','completed')`,
      [challengeId, candidates],
    );
    const activeIds = new Set<number>(active.map((r: { repo_id: number }) => Number(r.repo_id)));
    const repoIds = candidates.filter((id) => !activeIds.has(id));
    if (repoIds.length > 0) {
      // Entries of a repo on a differently-scoped queue must never be touched.
      const { rows: mismatched } = await db.query(
        `SELECT 1 FROM queue_entries qe JOIN challenges c ON c.id=qe.challenge_id
          WHERE qe.repo_id=ANY($1::int[]) AND c.is_test_account<>$2 LIMIT 1`,
        [repoIds, marker],
      );
      if (mismatched.length > 0)
        throw new ConflictError("Queue fixture markers must match", {
          code: "review_fixture_scope",
          challengeId,
        });
      await db.query(
        `INSERT INTO project_challenges(repo_id,challenge_id)
         SELECT r,$2 FROM unnest($1::int[]) AS r ON CONFLICT DO NOTHING`,
        [repoIds, challengeId],
      );
      await auditMany(
        db,
        repoIds.map((id) => ({
          actorId,
          entityType: "project",
          entityId: id,
          action: "challenge_add",
          after: { challengeId },
        })),
      );
    }
    const generated = await db.query(`SELECT 1 FROM queue_group_challenges WHERE challenge_id=$1`, [
      challengeId,
    ]);
    const outcomes = generated.rowCount
      ? await enqueueReposOnChallenge(db, actorId, repoIds, challengeId, "admin")
      : [];
    return { outcomes, total: rows.length, added: repoIds.length };
  });
  await announceQueueOutcomes(outcomes, marker);
  return { total, added, alreadyEnrolled: total - added };
}
export async function bulkRemoveRepoChallenge(actorId: number, challengeId: number) {
  await assertBulkChallenge(actorId, challengeId);
  const marker = await isSyntheticOperator(pool, actorId);
  const { updated, total, removed } = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT r.id AS repo_id,
              (EXISTS(SELECT 1 FROM project_challenges pc WHERE pc.repo_id=r.id AND pc.challenge_id=$1)
               OR EXISTS(SELECT 1 FROM queue_entries qe WHERE qe.repo_id=r.id AND qe.challenge_id=$1
                           AND qe.status NOT IN('cancelled','disqualified'))) AS active
         FROM repos r
        WHERE r.is_test_account=$2
          AND (EXISTS(SELECT 1 FROM project_challenges pc WHERE pc.repo_id=r.id AND pc.challenge_id=$1)
            OR EXISTS(SELECT 1 FROM queue_entries qe WHERE qe.repo_id=r.id AND qe.challenge_id=$1))
        ORDER BY r.id`,
      [challengeId, marker],
    );
    const repoIds: number[] = rows.filter((r) => r.active).map((r) => Number(r.repo_id));
    const result = {
      updated: [] as Array<Record<string, unknown>>,
      total: rows.length,
      removed: repoIds.length,
    };
    if (repoIds.length === 0) return result;
    await db.query(`SELECT id FROM repos WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE`, [
      repoIds,
    ]);
    const challenge = await db.query(`SELECT mandatory FROM challenges WHERE id=$1 FOR SHARE`, [
      challengeId,
    ]);
    if (challenge.rows[0]?.mandatory)
      throw new ConflictError("Mandatory challenge cannot be withdrawn");
    await db.query(
      `DELETE FROM project_challenges WHERE challenge_id=$1 AND repo_id=ANY($2::int[])`,
      [challengeId, repoIds],
    );
    const { rows: old } = await db.query(
      `SELECT id,status FROM queue_entries
        WHERE challenge_id=$1 AND repo_id=ANY($2::int[]) ORDER BY id FOR UPDATE`,
      [challengeId, repoIds],
    );
    await auditMany(
      db,
      repoIds.map((id) => ({
        actorId,
        entityType: "project",
        entityId: id,
        action: "challenge_remove",
        before: { challengeId },
      })),
    );
    if (old.length === 0) return result;
    const next = old.map((o: { status: string }) =>
      ["waiting", "called"].includes(o.status) ? "cancelled" : "disqualified",
    );
    const { rows: entries } = await db.query(
      `UPDATE queue_entries
          SET status=t.new_status::queue_status, assigned_room_id=NULL, position=NULL,
              called_at=NULL, precalled_at=NULL, presentation_started_at=NULL,
              ${RESET_PRESENTATION_CLOCK_SQL}, completed_at=NULL
         FROM unnest($1::int[], $2::text[]) AS t(entry_id, new_status)
        WHERE queue_entries.id=t.entry_id
        RETURNING queue_entries.*`,
      [old.map((o: { id: number }) => o.id), next],
    );
    await db.query(
      `INSERT INTO queue_history
         (queue_entry_id, actor_id, previous_status, new_status, action)
       SELECT t.entry_id, $1, t.previous, t.new_status, 'remove_from_challenge'
         FROM unnest($2::int[], $3::text[], $4::text[]) AS t(entry_id, previous, new_status)`,
      [
        actorId,
        old.map((o: { id: number }) => o.id),
        old.map((o: { status: string }) => o.status),
        next,
      ],
    );
    await compactQueueGroupPositions(db, challengeId);
    result.updated = entries;
    return result;
  });
  await Promise.all(
    updated.map((entry) =>
      broadcastQueueEventWithMarker(marker, EVENTS.QUEUE_ENTRY_CHANGED, entry),
    ),
  );
  if (updated.length > 0) await notifyChallengeQueueChanged(pool, challengeId);
  return { total, removed, alreadySkipped: total - removed };
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
    const memberUserIds = [...new Set(input.memberUserIds)];
    const users = await db.query(
      `SELECT id FROM users WHERE id=ANY($1::int[]) AND account_state='active' AND anonymized_at IS NULL AND is_test_account=$2`,
      [memberUserIds, marker],
    );
    if (users.rowCount !== memberUserIds.length)
      throw new NotFoundError("Project member not found");
    const requestedChallengeIds = [...new Set(input.challengeIds)];
    const challenges = await db.query(
      `SELECT id FROM challenges WHERE id=ANY($1::int[]) AND is_test_account=$2`,
      [requestedChallengeIds, marker],
    );
    if (challenges.rowCount !== requestedChallengeIds.length)
      throw new NotFoundError("Challenge not found");
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
    if (memberUserIds.length > 0)
      await db.query(
        `INSERT INTO submissions(repo_id,user_id,status) SELECT $1::int,u,'active' FROM unnest($2::int[]) AS u`,
        [id, memberUserIds],
      );
    const challengeIds = new Set(input.challengeIds);
    const mandatory = await db.query(
      `SELECT id FROM challenges WHERE mandatory AND is_test_account=$1`,
      [marker],
    );
    for (const row of mandatory.rows) challengeIds.add(row.id);
    const outcomes: EnqueueOutcome[] = [];
    if (challengeIds.size > 0)
      await db.query(
        `INSERT INTO project_challenges(repo_id,challenge_id) SELECT $1::int,c FROM unnest($2::int[]) AS c`,
        [id, [...challengeIds]],
      );
    for (const challengeId of challengeIds) {
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
      await nativeEditable(db, actorId, id, { allowSubmitted: true });
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
    const entryMarkers = await queueEntryFixtureMarkers(
      db,
      entries.map((entry) => entry.id),
    );
    for (const entry of entries)
      if (entryMarkers.get(entry.id) !== marker)
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
  }
  // Several entries on one challenge need a single refresh.
  for (const challengeId of new Set(deleted.entries.map((entry) => entry.challenge_id)))
    await notifyChallengeQueueChanged(pool, challengeId);
  return { deleted: true };
}
export async function deleteMyProject(userId: number, id: number) {
  return deleteRepo(userId, id, true);
}
