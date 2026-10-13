import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { firstNumericQuestionKey, type Question } from "@hackos/shared/questions";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { createAuthorizationContext, userHasCapability } from "../../lib/capabilities.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { assertWithinHackingWindow } from "../../lib/hacking-window.js";
import { broadcast } from "../../lib/sse.js";
import { hasEventAccess } from "../identity/role.js";
import {
  assertFixtureQueueScope,
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
import { GROUP_SIBLING_CHALLENGE_IDS_SQL } from "../queue/groups.js";
import { writeQueueHistory } from "../queue/history.js";
import { notifyChallengeQueueChanged, repoMemberIds } from "../queue/notify.js";
import { compactQueueGroupPositions, nextBottomPosition } from "../queue/ordering.js";
import { RESET_PRESENTATION_CLOCK_SQL } from "../queue/presentation-clock.js";
import { type RepositoryAccessScope, repositoryIdsForScope } from "./access.js";
import { assertProjectEditable, assertProjectParticipantWindow } from "./submission-state.js";

export interface ProjectMemberCandidate {
  id: number;
  email: string;
  name: string | null;
  surname: string | null;
}

/** Minimal account lookup for H21 membership edits; does not expose profile data. */
export async function listProjectMemberCandidates(
  query: string,
  limit: number,
  actorId?: number,
): Promise<ProjectMemberCandidate[]> {
  const filter = `%${query.trim()}%`;
  const fixtureMarker = actorId == null ? false : await isSyntheticOperator(pool, actorId);
  const { rows } = await pool.query(
    `SELECT id, email, name, surname
       FROM users
      WHERE account_state = 'active' AND anonymized_at IS NULL
        AND is_test_account = $3
        AND (unaccent(email) ILIKE unaccent($1) OR unaccent(name) ILIKE unaccent($1) OR unaccent(surname) ILIKE unaccent($1) OR unaccent(concat_ws(' ', name, surname)) ILIKE unaccent($1))
      ORDER BY name ASC NULLS LAST, surname ASC NULLS LAST, email ASC
      LIMIT $2`,
    [filter, limit, fixtureMarker],
  );
  return rows;
}

interface RepoRow {
  id: number;
  name: string;
  description: string;
  github_url: string | null;
  demo_url: string | null;
  presentation_timing_preference: string;
  submission_status: "draft" | "submitted";
  submitted_at: Date | null;
  submitted_via: "participant" | "admin" | null;
  locked_at: Date | null;
  lock_reason: "organizer_lock" | null;
}

interface RepoMember {
  userId: number;
  /** null when the caller is not entitled to a teammate's address (H20). */
  email: string | null;
  name: string | null;
  surname: string | null;
}

interface RepoChallenge {
  id: number;
  title: string;
  mandatory: boolean;
  /** Queue status; null until this challenge's queue is generated (H21). */
  status: string | null;
  position: number | null;
  assignedRoomId: number | null;
  assignedRoomName: string | null;
  etaMinutes: number | null;
  rooms: { id: number; name: string; location: string | null }[];
  /** H36 evaluation status — null both when unevaluated AND when the caller
   * has no visibility into this challenge (see visibleChallengeIds below). */
  reviewStatus: "draft" | "submitted" | null;
  nota: number | null;
}

interface RepoWithExtras extends RepoRow {
  members: RepoMember[];
  challenges: RepoChallenge[];
}

/**
 * PROJECTS_READ attachments: the active roster and the challenges a project
 * enters — its own selection (`project_challenges`) plus every mandatory
 * challenge — with live queue state where the queue is generated (#1006).
 *
 * `visibleChallengeIds` gates the H36 evaluation fields (reviewStatus/nota)
 * per challenge entry: "all" for full-access staff, or the exact set of
 * challenge ids the caller may see review data for (their own sponsor
 * enterprise's challenges, or the challenges they judge). Entries outside
 * that set come back with reviewStatus/nota = null — indistinguishable from
 * "not evaluated yet" — so a sponsor can't infer anything about another
 * company's judging progress from their own project view.
 */
async function attachMembersAndChallenges(
  repoRows: RepoRow[],
  visibleChallengeIds: number[] | "all" = "all",
  fixtureMarker = false,
): Promise<RepoWithExtras[]> {
  const ids = repoRows.map((r) => r.id);
  if (ids.length === 0) return [];
  const visibleSet = visibleChallengeIds === "all" ? null : new Set(visibleChallengeIds);

  const membersRes = await pool.query(
    `SELECT s.repo_id, u.id AS user_id, u.email, u.name, u.surname
       FROM submissions s
       JOIN users u ON u.id = s.user_id
      WHERE s.repo_id = ANY($1::int[])
        -- H19: a pending invite is not yet a member of the roster.
        AND s.status = 'active'
        AND u.account_state = 'active' AND u.anonymized_at IS NULL
        AND u.is_test_account = $2
      ORDER BY s.repo_id, u.name ASC NULLS LAST, u.surname ASC NULLS LAST, u.email ASC`,
    [ids, fixtureMarker],
  );
  const enteredRes = await pool.query(
    `SELECT r.id AS repo_id, c.id, c.title, c.mandatory
       FROM repos r
       JOIN challenges c ON c.is_test_account = $2 AND (
         c.mandatory
         OR EXISTS (SELECT 1 FROM project_challenges pc WHERE pc.repo_id = r.id AND pc.challenge_id = c.id)
         OR EXISTS (SELECT 1 FROM queue_entries qe WHERE qe.repo_id = r.id AND qe.challenge_id = c.id
                     AND qe.status NOT IN ('cancelled', 'disqualified'))
       )
      WHERE r.id = ANY($1::int[])
      ORDER BY r.id, c.title, c.id`,
    [ids, fixtureMarker],
  );
  const queueRes = await pool.query(
    `WITH waiting AS (
       SELECT DISTINCT ON (qgc.queue_group_id, e.repo_id)
              qgc.queue_group_id, e.repo_id, e.position, e.id
         FROM queue_entries e
         JOIN queue_group_challenges qgc ON qgc.challenge_id = e.challenge_id
         JOIN challenges ch ON ch.id = e.challenge_id AND ch.is_test_account = $2
         JOIN repos repo ON repo.id = e.repo_id AND repo.is_test_account = $2
        WHERE e.status = 'waiting'
        ORDER BY qgc.queue_group_id, e.repo_id, e.position ASC NULLS LAST, e.id
     ), ranked AS (
       SELECT *, row_number() OVER (PARTITION BY queue_group_id ORDER BY position ASC NULLS LAST, id)::int AS rank
         FROM waiting
     )
     SELECT qe.repo_id, qe.challenge_id AS id, c.title, c.mandatory, qe.status,
            CASE WHEN qe.status = 'waiting' THEN ranked.rank ELSE NULL END AS position,
            CASE WHEN qe.status = 'waiting' THEN round(ranked.rank * COALESCE(pace.minutes, 8))::int ELSE NULL END AS eta_minutes,
            COALESCE(pace.rooms, '[]'::jsonb) AS possible_rooms,
            qe.assigned_room_id, r.name AS assigned_room_name,
            c.judging_panel_criteria, ar.status AS review_status, ar.scores AS review_scores
       FROM queue_entries qe
       JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
       JOIN repos repo ON repo.id = qe.repo_id AND repo.is_test_account = $2
       JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
       LEFT JOIN ranked ON ranked.queue_group_id = qgc.queue_group_id AND ranked.repo_id = qe.repo_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('id', rm.id, 'name', rm.name, 'location', rm.location) ORDER BY rm.name) AS rooms,
                (SELECT estimated_cycle_minutes FROM queue_group_timing(qgc.queue_group_id)) /
                  greatest(1, count(rqs.room_id) FILTER (WHERE NOT rqs.is_paused)) AS minutes
           FROM room_queue_groups rqg
           JOIN rooms rm ON rm.id = rqg.room_id
           LEFT JOIN room_queue_state rqs ON rqs.room_id = rm.id
          WHERE rqg.queue_group_id = qgc.queue_group_id
            AND NOT EXISTS (
              SELECT 1 FROM room_queue_groups other
              JOIN queue_group_challenges sibling ON sibling.queue_group_id=other.queue_group_id
              JOIN challenges ch ON ch.id=sibling.challenge_id
              WHERE other.room_id=rm.id AND ch.is_test_account IS DISTINCT FROM $2
            )
       ) pace ON true
       LEFT JOIN rooms r ON r.id = qe.assigned_room_id
       LEFT JOIN attempt_review ar ON ar.attempt_id = qe.id
      WHERE qe.repo_id = ANY($1::int[])
        AND NOT EXISTS (
          SELECT 1 FROM queue_group_challenges sibling JOIN challenges ch ON ch.id=sibling.challenge_id
          WHERE sibling.queue_group_id=qgc.queue_group_id AND ch.is_test_account IS DISTINCT FROM $2
        )
      ORDER BY qe.repo_id, qe.position ASC NULLS LAST, qe.id ASC`,
    [ids, fixtureMarker],
  );

  const membersByRepo = new Map<number, RepoMember[]>();
  for (const row of membersRes.rows as Array<{
    repo_id: number;
    user_id: number;
    email: string;
    name: string | null;
    surname: string | null;
  }>) {
    const arr = membersByRepo.get(row.repo_id) ?? [];
    arr.push({ userId: row.user_id, email: row.email, name: row.name, surname: row.surname });
    membersByRepo.set(row.repo_id, arr);
  }

  const queueByKey = new Map<string, Omit<RepoChallenge, "id" | "title" | "mandatory">>();
  for (const row of queueRes.rows as Array<{
    repo_id: number;
    id: number;
    status: string;
    position: number | null;
    assigned_room_id: number | null;
    assigned_room_name: string | null;
    eta_minutes: number | null;
    possible_rooms: RepoChallenge["rooms"];
    judging_panel_criteria: unknown;
    review_status: "draft" | "submitted" | null;
    review_scores: Record<string, unknown> | null;
  }>) {
    if (row.status === "cancelled") continue;
    const canSeeReview = visibleSet === null || visibleSet.has(row.id);
    let nota: number | null = null;
    if (canSeeReview && row.review_scores && Array.isArray(row.judging_panel_criteria)) {
      const notaKey = firstNumericQuestionKey(row.judging_panel_criteria as Question[]);
      const value = notaKey ? row.review_scores[notaKey] : undefined;
      if (typeof value === "number") nota = value;
    }
    queueByKey.set(`${row.repo_id}:${row.id}`, {
      status: row.status,
      position: row.position,
      assignedRoomId: row.assigned_room_id,
      assignedRoomName: row.assigned_room_name,
      etaMinutes: row.eta_minutes,
      rooms: row.possible_rooms,
      reviewStatus: canSeeReview ? (row.review_status ?? null) : null,
      nota,
    });
  }

  const challengesByRepo = new Map<number, RepoChallenge[]>();
  for (const row of enteredRes.rows as Array<{
    repo_id: number;
    id: number;
    title: string;
    mandatory: boolean;
  }>) {
    const arr = challengesByRepo.get(row.repo_id) ?? [];
    arr.push({
      id: row.id,
      title: row.title,
      mandatory: row.mandatory,
      status: null,
      position: null,
      assignedRoomId: null,
      assignedRoomName: null,
      etaMinutes: null,
      rooms: [],
      reviewStatus: null,
      nota: null,
      ...queueByKey.get(`${row.repo_id}:${row.id}`),
    });
    challengesByRepo.set(row.repo_id, arr);
  }

  return repoRows.map((repo) => ({
    ...repo,
    members: membersByRepo.get(repo.id) ?? [],
    challenges: challengesByRepo.get(repo.id) ?? [],
  }));
}

const REPO_COLUMNS = `id, name, description, github_url, demo_url, presentation_timing_preference, submission_status, submitted_at, submitted_via, locked_at, lock_reason`;
const REPO_SELECT = `SELECT ${REPO_COLUMNS} FROM repos`;

/** PROJECTS_READ: projects with roster and challenges. */
export async function listRepos(fixtureMarker = false): Promise<RepoWithExtras[]> {
  const { rows } = await pool.query(`${REPO_SELECT} WHERE is_test_account = $1 ORDER BY name`, [
    fixtureMarker,
  ]);
  return attachMembersAndChallenges(rows, "all", fixtureMarker);
}

export async function getRepo(id: number, fixtureMarker = false): Promise<RepoWithExtras> {
  const { rows } = await pool.query(`${REPO_SELECT} WHERE is_test_account = $2 AND id = $1`, [
    id,
    fixtureMarker,
  ]);
  if (rows.length === 0) throw new NotFoundError(`Repo ${id} not found`);
  const [withExtras] = await attachMembersAndChallenges(rows, "all", fixtureMarker);
  if (!withExtras) throw new NotFoundError(`Repo ${id} not found`);
  return withExtras;
}

/** Repos visible under the shared repository policy's resolved scope. */
export async function listReposForScope(scope: RepositoryAccessScope): Promise<RepoWithExtras[]> {
  if (scope.fullAccess) return listRepos(scope.fixtureMarker === true);
  const repoIds = await repositoryIdsForScope(scope);
  if (repoIds.length === 0) return [];
  const { rows } = await pool.query(
    `${REPO_SELECT} WHERE is_test_account = $2 AND id = ANY($1::int[]) ORDER BY name`,
    [repoIds, scope.fixtureMarker === true],
  );
  // Evaluation visibility is capped to this caller's own challenges (their
  // sponsor enterprise's, or the ones they judge) — never another sponsor's.
  return attachMembersAndChallenges(rows, scope.challengeIds, scope.fixtureMarker === true);
}

/** A repository already authorized by the shared contextual policy. */
export async function getRepoForScope(
  id: number,
  scope: RepositoryAccessScope,
): Promise<RepoWithExtras> {
  if (scope.fullAccess) return getRepo(id, scope.fixtureMarker === true);
  const { rows } = await pool.query(`${REPO_SELECT} WHERE is_test_account = $2 AND id = $1`, [
    id,
    scope.fixtureMarker === true,
  ]);
  if (!rows[0]) throw new NotFoundError(`Repo ${id} not found`);
  const [repo] = await attachMembersAndChallenges(
    rows,
    scope.challengeIds,
    scope.fixtureMarker === true,
  );
  if (!repo) throw new NotFoundError(`Repo ${id} not found`);
  return repo;
}

/**
 * H55/nav: cheap existence check backing the "My project" nav item — same
 * membership definition as {@link myProjects}, without the roster join.
 */
export async function hasMyProject(userId: number, db: Queryable = pool): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM submissions s
        JOIN repos r ON r.id = s.repo_id
        JOIN users u ON u.id = s.user_id
        WHERE s.user_id = $1 AND s.status = 'active'
          AND r.is_test_account = u.is_test_account
     ) AS exists`,
    [userId],
  );
  return rows[0].exists as boolean;
}

/**
 * Participant self-view (H20): projects this user is an active member of,
 * with roster, challenges and queue status. A pending invite only shows via
 * {@link myPendingInvites} until accepted.
 */
export async function myProjects(userId: number): Promise<RepoWithExtras[]> {
  const { rows: userRows } = await pool.query<{ is_test_account: boolean }>(
    `SELECT is_test_account FROM users WHERE id = $1`,
    [userId],
  );
  const fixtureMarker = userRows[0]?.is_test_account === true;
  const { rows } = await pool.query(
    `SELECT ${REPO_COLUMNS}
       FROM repos r
      WHERE r.is_test_account = $2
        AND r.id IN (SELECT repo_id FROM submissions WHERE user_id = $1 AND status = 'active')
      ORDER BY r.name`,
    [userId, fixtureMarker],
  );
  // Participants never see judging internals.
  const repos = await attachMembersAndChallenges(rows, [], fixtureMarker);
  // A teammate's address is not the participant's to read: only the caller's
  // own email survives the self-view (H20).
  return repos.map((repo) => ({
    ...repo,
    members: repo.members.map((m) => (m.userId === userId ? m : { ...m, email: null })),
  }));
}

/**
 * H19 self-service eligibility: reuses the role-derived event-access check
 * verbatim. Holding any assigned, non-deleted event-bearing role is the
 * admission signal for the app, ticket and participant self-service surfaces.
 */
export async function isAdmittedParticipant(db: Queryable, userId: number): Promise<boolean> {
  return hasEventAccess(db, userId);
}

/** True when userId is an active (not merely invited) member of repoId (H19/H20). */
export async function isActiveProjectMember(
  db: Queryable,
  repoId: number,
  userId: number,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM submissions s
        JOIN repos r ON r.id = s.repo_id
        JOIN users u ON u.id = s.user_id
        WHERE s.repo_id = $1 AND s.user_id = $2 AND s.status = 'active'
          AND u.account_state = 'active' AND u.anonymized_at IS NULL
          AND r.is_test_account = u.is_test_account
     ) AS member`,
    [repoId, userId],
  );
  return rows[0]?.member === true;
}

/** Active-member count for repoId; used by leave/delete to detect "last member" (H19/H20). */
export async function activeProjectMemberCount(db: Queryable, repoId: number): Promise<number> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n
       FROM submissions s
       JOIN repos r ON r.id = s.repo_id
       JOIN users u ON u.id = s.user_id
      WHERE s.repo_id = $1 AND s.status = 'active'
        AND u.account_state = 'active' AND u.anonymized_at IS NULL
        AND r.is_test_account = u.is_test_account`,
    [repoId],
  );
  return rows[0]?.n ?? 0;
}

export async function addRepoMember(actorId: number, repoId: number, userId: number) {
  return withTransaction(async (client) => {
    const user = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!user.rows[0]) throw new NotFoundError(`User ${userId} not found`);
    await assertFixtureSubjectScope(client, actorId, userId);
    await assertFixtureQueueScope(client, actorId, "repo", repoId);
    const repo = await client.query(`SELECT id FROM repos WHERE id = $1 FOR UPDATE`, [repoId]);
    if (!repo.rows[0]) throw new NotFoundError(`Repo ${repoId} not found`);

    const inserted = await client.query(
      `INSERT INTO submissions (repo_id, user_id, status, responded_at)
       VALUES ($1, $2, 'active', now())
       ON CONFLICT (repo_id, user_id) DO UPDATE SET status = 'active', responded_at = now()
         WHERE submissions.status = 'invited'
       RETURNING repo_id, user_id`,
      [repoId, userId],
    );

    await audit(client, {
      actorId,
      entityType: "submission",
      entityId: `${repoId}:${userId}`,
      action: "add_member",
      after: { repoId, userId, inserted: (inserted.rowCount ?? 0) > 0 },
      source: "admin",
    });

    return { repoId, userId, inserted: (inserted.rowCount ?? 0) > 0 };
  });
}

export async function removeRepoMember(actorId: number, repoId: number, userId: number) {
  return withTransaction(async (client) => {
    const user = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!user.rows[0]) throw new NotFoundError(`User ${userId} not found`);
    await assertFixtureSubjectScope(client, actorId, userId);
    await assertFixtureQueueScope(client, actorId, "repo", repoId);
    const existing = await client.query(
      `SELECT * FROM submissions WHERE repo_id = $1 AND user_id = $2 FOR UPDATE`,
      [repoId, userId],
    );
    if (!existing.rows[0]) throw new NotFoundError(`Repo member ${repoId}:${userId} not found`);

    await client.query(`DELETE FROM submissions WHERE repo_id = $1 AND user_id = $2`, [
      repoId,
      userId,
    ]);

    await audit(client, {
      actorId,
      entityType: "submission",
      entityId: `${repoId}:${userId}`,
      action: "remove_member",
      before: { repoId, userId },
      source: "admin",
    });
    return { repoId, userId, removed: true };
  });
}

interface EnqueueOutcome {
  entry: Record<string, unknown> & { id: number; challenge_id: number };
  inserted: boolean;
  revived: boolean;
}

/**
 * #1006: a challenge's queue counts as generated once any entry exists in
 * the queue group serving it. Before that, a project's challenge selection is
 * only recorded in `project_challenges`; generation turns it into entries.
 */
async function isChallengeQueueGenerated(client: Queryable, challengeId: number) {
  const { rows } = await client.query<{ generated: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM queue_entries
        WHERE challenge_id = $1 OR challenge_id IN (${GROUP_SIBLING_CHALLENGE_IDS_SQL})
     ) AS generated`,
    [challengeId],
  );
  return rows[0]?.generated === true;
}

async function assertMatchingMarkers(
  client: Queryable,
  actorId: number,
  repoId: number,
  challengeId: number,
  challengeMarker?: boolean,
) {
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
}

/**
 * Appends the repo at the BOTTOM of the challenge's queue, reviving a
 * terminal (cancelled / disqualified / completed) entry instead of
 * duplicating it, and records the challenge in the project's selection.
 * Writes exactly one queue_history row + one audit row per mutation (plan/07
 * invariant 5). Returns null when the repo is already actively queued
 * (no-op). The caller owns the transaction and must broadcast
 * QUEUE_ENTRY_CHANGED + notify the challenge AFTER commit for every non-null
 * outcome.
 *
 * `challengeMarker`/`allocatePosition` let a bulk caller hoist the
 * challenge-scope check and the queue's bottom-position lock out of the
 * per-repo loop — see `bulkAddRepoChallenge`.
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
  await assertMatchingMarkers(client, actorId, repoId, challengeId, challengeMarker);
  await client.query(
    `INSERT INTO project_challenges (repo_id, challenge_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [repoId, challengeId],
  );
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

/**
 * The single write path for a project entering a challenge (#1006, H21):
 * records the selection and, when the challenge's queue is already
 * generated, appends the project to it at once. Before generation the
 * selection alone is audited and queue generation creates the entry.
 */
export async function enterChallenge(
  client: Queryable,
  actorId: number,
  repoId: number,
  challengeId: number,
  auditSource: string,
  challengeMarker?: boolean,
  allocatePosition?: () => Promise<number>,
): Promise<EnqueueOutcome | null> {
  if (await isChallengeQueueGenerated(client, challengeId)) {
    return enqueueRepoOnChallenge(
      client,
      actorId,
      repoId,
      challengeId,
      auditSource,
      challengeMarker,
      allocatePosition,
    );
  }
  await assertMatchingMarkers(client, actorId, repoId, challengeId, challengeMarker);
  const inserted = await client.query(
    `INSERT INTO project_challenges (repo_id, challenge_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING repo_id`,
    [repoId, challengeId],
  );
  if (inserted.rows[0]) {
    await audit(client, {
      actorId,
      entityType: "repo",
      entityId: repoId,
      action: "challenge.enter",
      after: { challengeId },
      source: auditSource,
    });
  }
  return null;
}

async function announceEntered(result: { entry: EnqueueOutcome["entry"] | null }) {
  if (!result.entry) return;
  await broadcastQueueEvent(
    pool,
    "entry",
    result.entry.id,
    EVENTS.QUEUE_ENTRY_CHANGED,
    result.entry,
  );
  await notifyChallengeQueueChanged(pool, result.entry.challenge_id);
}

export async function addRepoChallenge(actorId: number, repoId: number, challengeId: number) {
  const result = await withTransaction(async (client) => {
    await assertMatchingMarkers(client, actorId, repoId, challengeId);
    const repo = await client.query(`SELECT id FROM repos WHERE id = $1 FOR UPDATE`, [repoId]);
    if (!repo.rows[0]) throw new NotFoundError(`Repo ${repoId} not found`);
    const challenge = await client.query(`SELECT id FROM challenges WHERE id = $1`, [challengeId]);
    if (!challenge.rows[0]) throw new NotFoundError(`Challenge ${challengeId} not found`);

    const outcome = await enterChallenge(client, actorId, repoId, challengeId, "admin");
    if (!outcome) return { repoId, challengeId, entry: null, inserted: false, revived: false };
    return { repoId, challengeId, ...outcome };
  });
  await announceEntered(result);
  return result;
}

/** Participant self-service enrollment closes when judging begins. Unlike the
 * hacking window, this deadline is specifically about changing the judging
 * lineup and applies equally to imported and native projects. */
async function assertJudgingHasNotStarted(client: Queryable) {
  const { rows } = await client.query<{ started: boolean }>(
    `SELECT COALESCE(schedule_start_at <= now(), false) AS started
       FROM queue_settings WHERE id = 1 FOR UPDATE`,
  );
  if (rows[0]?.started)
    throw new ForbiddenError("Challenges can no longer be changed after judging starts");
}

/** H20 participant counterpart to the operator's H21 enrollment action. */
export async function addMyProjectChallenge(userId: number, repoId: number, challengeId: number) {
  const result = await withTransaction(async (client) => {
    await assertFixtureSubjectScope(client, userId, userId);
    await assertFixtureQueueScope(client, userId, "repo", repoId);
    if (!(await isActiveProjectMember(client, repoId, userId))) {
      throw new ForbiddenError("Not a member of this project");
    }
    await assertProjectEditable(client, repoId);
    await assertJudgingHasNotStarted(client);
    const challenge = await client.query(
      `SELECT id FROM challenges WHERE id = $1 AND visibility = 'visible'`,
      [challengeId],
    );
    if (!challenge.rows[0]) throw new NotFoundError("Challenge not found");
    const outcome = await enterChallenge(client, userId, repoId, challengeId, "participant");
    if (!outcome) return { repoId, challengeId, entry: null, inserted: false, revived: false };
    return { repoId, challengeId, ...outcome };
  });
  await announceEntered(result);
  return result;
}

/**
 * Transitions one queue entry out of a challenge (waiting/called -> cancelled,
 * anything further along -> disqualified), writing the matching history row
 * and audit entry. Shared by the single and bulk removal paths.
 */
async function terminateQueueEntry(
  client: Queryable,
  entry: { id: number; repo_id: number; status: string },
  actorId: number,
  options: { challengeId: number; reason: string; source?: "admin" | "participant" },
): Promise<Record<string, unknown>> {
  const nextStatus = ["waiting", "called"].includes(entry.status) ? "cancelled" : "disqualified";
  const updated = await client.query(
    `UPDATE queue_entries
        SET status = $1, assigned_room_id = NULL, position = NULL, called_at = NULL,
            precalled_at = NULL, presentation_started_at = NULL,
            ${RESET_PRESENTATION_CLOCK_SQL}, completed_at = NULL
      WHERE id = $2
      RETURNING *`,
    [nextStatus, entry.id],
  );
  await writeQueueHistory(client, {
    entryId: entry.id,
    actorId,
    previousStatus: entry.status,
    newStatus: nextStatus,
    action: "remove_from_challenge",
    reason: options.reason,
  });
  await audit(client, {
    actorId,
    entityType: "queue_entry",
    entityId: entry.id,
    action: "remove_from_challenge",
    before: { status: entry.status, challengeId: options.challengeId, repoId: entry.repo_id },
    after: { status: nextStatus },
    reason: options.reason,
    source: options.source ?? "admin",
  });
  return updated.rows[0];
}

export async function removeRepoChallenge(
  actorId: number,
  repoId: number,
  challengeId: number,
  participant = false,
) {
  const result = await withTransaction(async (client) => {
    if (participant) {
      await assertProjectEditable(client, repoId);
      if (!(await isActiveProjectMember(client, repoId, actorId)))
        throw new ForbiddenError("Not a member of this project");
      await assertJudgingHasNotStarted(client);
    }
    await assertMatchingMarkers(client, actorId, repoId, challengeId);
    await assertChallengeIsOptional(client, challengeId);
    const source = participant ? "participant" : "admin";
    const intent = await client.query(
      `DELETE FROM project_challenges WHERE repo_id = $1 AND challenge_id = $2 RETURNING repo_id`,
      [repoId, challengeId],
    );
    const entryRes = await client.query(
      `SELECT * FROM queue_entries WHERE repo_id = $1 AND challenge_id = $2
          AND status NOT IN ('cancelled', 'disqualified')
        FOR UPDATE`,
      [repoId, challengeId],
    );
    const entry = entryRes.rows[0];
    if (!entry) {
      if (!intent.rows[0]) throw new NotFoundError("Project is not entered in this challenge");
      await audit(client, {
        actorId,
        entityType: "repo",
        entityId: repoId,
        action: "challenge.withdraw",
        before: { challengeId },
        source,
      });
      return { repoId, challengeId, entry: null, removed: true };
    }

    const updatedEntry = await terminateQueueEntry(client, entry, actorId, {
      challengeId,
      reason: "Removed from challenge",
      source,
    });
    await compactQueueGroupPositions(client, challengeId);
    return { repoId, challengeId, entry: updatedEntry, removed: true };
  });
  if (result.entry)
    await broadcastQueueEvent(
      pool,
      "entry",
      Number(result.entry.id),
      EVENTS.QUEUE_ENTRY_CHANGED,
      result.entry,
    );
  if (result.entry) await notifyChallengeQueueChanged(pool, result.challengeId);
  return result;
}

/** H20: participant withdrawal uses the same audited queue transition as H21. */
export async function removeMyProjectChallenge(
  userId: number,
  repoId: number,
  challengeId: number,
) {
  return removeRepoChallenge(userId, repoId, challengeId, true);
}

export interface BulkAddResult {
  total: number;
  added: number;
  alreadyEnrolled: number;
}

export interface BulkRemoveResult {
  total: number;
  removed: number;
  alreadySkipped: number;
}

const ENTERED_REPO_IDS_SQL = `
  SELECT repo_id FROM project_challenges WHERE challenge_id = $1
  UNION
  SELECT repo_id FROM queue_entries
   WHERE challenge_id = $1 AND status NOT IN ('cancelled', 'disqualified')`;

/**
 * H21 "apuntar TODOS los proyectos a un reto" — enters every existing repo
 * into `challengeId` in one transaction through the same per-repo path as the
 * single add (`enterChallenge`), so idempotency and the queue-generated
 * behavior are identical. Repos already entered are skipped.
 */
export async function bulkAddRepoChallenge(
  actorId: number,
  challengeId: number,
): Promise<BulkAddResult> {
  const { outcomes, total, added } = await withTransaction(async (client) => {
    const challengeMarker = await assertQueueChallengeScope(client, actorId, challengeId);
    const challenge = await client.query(`SELECT id FROM challenges WHERE id = $1`, [challengeId]);
    if (!challenge.rows[0]) throw new NotFoundError(`Challenge ${challengeId} not found`);

    const repos = await client.query(
      `SELECT id FROM repos WHERE is_test_account = $1 ORDER BY id`,
      [await isSyntheticOperator(client, actorId)],
    );
    const repoIds = repos.rows.map((r: { id: number }) => r.id);
    const entered = new Set(
      (await client.query(ENTERED_REPO_IDS_SQL, [challengeId])).rows.map(
        (r: { repo_id: number }) => r.repo_id,
      ),
    );

    // One locked read of the group's current bottom position instead of one
    // per repo: the FOR UPDATE lock it takes is held for the rest of this
    // transaction, so each subsequent repo just takes the next in-memory slot.
    let nextPosition = await nextBottomPosition(client, challengeId);
    const allocatePosition = async () => nextPosition++;

    const outcomes: EnqueueOutcome[] = [];
    let added = 0;
    for (const repoId of repoIds) {
      if (entered.has(repoId)) continue;
      const outcome = await enterChallenge(
        client,
        actorId,
        repoId,
        challengeId,
        "admin",
        challengeMarker,
        allocatePosition,
      );
      if (outcome) outcomes.push(outcome);
      added += 1;
    }

    await audit(client, {
      actorId,
      entityType: "challenge",
      entityId: challengeId,
      action: "bulk_add_repos",
      after: { total: repoIds.length, added },
      source: "admin",
    });

    return { outcomes, total: repoIds.length, added };
  });

  await announceQueueOutcomes(outcomes);
  return { total, added, alreadyEnrolled: total - added };
}

/**
 * H21 "dar de baja TODOS los proyectos de un reto" — clears the challenge
 * from every project's selection and applies `removeRepoChallenge`'s
 * per-entry transition (waiting/called -> cancelled, anything else in
 * progress -> disqualified) to every active entry in one transaction, with a
 * single position compaction at the end.
 */
export async function bulkRemoveRepoChallenge(
  actorId: number,
  challengeId: number,
): Promise<BulkRemoveResult> {
  const { updatedEntries, total, removed } = await withTransaction(async (client) => {
    const fixtureMarker = await assertQueueChallengeScope(client, actorId, challengeId);
    const challenge = await client.query(`SELECT id FROM challenges WHERE id = $1`, [challengeId]);
    if (!challenge.rows[0]) throw new NotFoundError(`Challenge ${challengeId} not found`);
    await assertChallengeIsOptional(client, challengeId);

    const total = (
      await client.query(
        `SELECT count(*)::int AS n FROM repos WHERE is_test_account = $2 AND id IN (
           SELECT repo_id FROM project_challenges WHERE challenge_id = $1
           UNION SELECT repo_id FROM queue_entries WHERE challenge_id = $1)`,
        [challengeId, fixtureMarker],
      )
    ).rows[0].n as number;
    const withdrawn = new Set<number>(
      (
        await client.query(
          `DELETE FROM project_challenges WHERE challenge_id = $1 RETURNING repo_id`,
          [challengeId],
        )
      ).rows.map((r: { repo_id: number }) => r.repo_id),
    );
    const entriesRes = await client.query(
      `SELECT * FROM queue_entries WHERE challenge_id = $1
          AND status NOT IN ('cancelled', 'disqualified')
        FOR UPDATE`,
      [challengeId],
    );
    const removable = entriesRes.rows as Array<{ id: number; repo_id: number; status: string }>;

    const updatedEntries: Array<Record<string, unknown> & { challenge_id: number }> = [];
    for (const entry of removable) {
      withdrawn.add(entry.repo_id);
      const updatedEntry = await terminateQueueEntry(client, entry, actorId, {
        challengeId,
        reason: "Removed from challenge (bulk)",
      });
      updatedEntries.push(updatedEntry as Record<string, unknown> & { challenge_id: number });
    }
    if (removable.length > 0) await compactQueueGroupPositions(client, challengeId);

    await audit(client, {
      actorId,
      entityType: "challenge",
      entityId: challengeId,
      action: "bulk_remove_repos",
      after: { total, removed: withdrawn.size },
      source: "admin",
    });

    return { updatedEntries, total, removed: withdrawn.size };
  });

  for (const entry of updatedEntries) {
    await broadcastQueueEvent(pool, "entry", Number(entry.id), EVENTS.QUEUE_ENTRY_CHANGED, entry);
  }
  if (updatedEntries.length > 0) await notifyChallengeQueueChanged(pool, challengeId);

  return { total, removed, alreadySkipped: total - removed };
}

async function assertChallengeIsOptional(client: Queryable, challengeId: number): Promise<void> {
  const { rows } = await client.query(`SELECT mandatory FROM challenges WHERE id = $1`, [
    challengeId,
  ]);
  if (rows[0]?.mandatory === true) {
    throw new ConflictError("Projects cannot be removed from a mandatory challenge", {
      challengeId,
    });
  }
}

// ── project lifecycle (H19-H21) ────────────────────────────────────────────

export interface NativeRepoInput {
  name: string;
  description: string;
  githubUrl: string | null;
  demoUrl: string | null;
  challengeIds: number[];
}

interface EnqueuedChallenge {
  challengeId: number;
  entryId: number;
  position: number | null;
}

function toEnqueuedChallenge(outcome: EnqueueOutcome): EnqueuedChallenge {
  return {
    challengeId: outcome.entry.challenge_id,
    entryId: outcome.entry.id,
    position: (outcome.entry.position as number | null) ?? null,
  };
}

/** Enqueued entries a caller must announce (SSE + notify) after commit. */
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

/**
 * `visibleOnly` is the participant path (H19): they can only pick challenges
 * the public site shows, and an unpublished id reads as "not found" so its
 * existence never leaks.
 */
async function assertChallengesExist(
  client: Queryable,
  challengeIds: number[],
  visibleOnly = false,
  fixtureMarker = false,
): Promise<void> {
  if (challengeIds.length === 0) return;
  const { rows } = await client.query(
    `SELECT id FROM challenges WHERE id = ANY($1::int[]) AND is_test_account = $2
      ${visibleOnly ? `AND visibility = 'visible'` : ""}`,
    [challengeIds, fixtureMarker],
  );
  const found = new Set(rows.map((r: { id: number }) => r.id));
  const missing = challengeIds.filter((id) => !found.has(id));
  if (missing.length > 0) throw new NotFoundError(`Challenge ${missing.join(", ")} not found`);
}

/**
 * Issue #851: mandatory participation is materialized as ordinary queue
 * entries, so queue generation, participant notifications and operational
 * participant counts retain one authoritative source. The enqueue primitive
 * preserves the unique (challenge, repo) entry and revives terminal entries.
 */
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
      const outcome = await enterChallenge(
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

/** Staff-created projects start submitted; participant projects start as drafts (#1006). */
async function insertRepo(
  client: Queryable,
  input: NativeRepoInput,
  createdBy: number,
  fixtureMarker: boolean,
  status: "draft" | "submitted",
): Promise<RepoRow> {
  const { rows } = await client.query(
    `INSERT INTO repos (name, description, github_url, demo_url, created_by, is_test_account,
                        submission_status, submitted_via, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             CASE WHEN $7 = 'submitted' THEN 'admin' END,
             CASE WHEN $7 = 'submitted' THEN now() END)
     RETURNING ${REPO_COLUMNS}`,
    [
      input.name,
      input.description,
      input.githubUrl,
      input.demoUrl,
      createdBy,
      fixtureMarker,
      status,
    ],
  );
  return rows[0];
}

/**
 * H21: staff create a project on a team's behalf, with team members and
 * challenge lineup in ONE transaction — challenges are appended at the bottom
 * of any already-generated queues exactly like a hot edit.
 */
export async function createRepoNative(
  actorId: number,
  input: NativeRepoInput & { memberUserIds: number[] },
): Promise<{ repo: RepoRow; memberUserIds: number[]; challenges: EnqueuedChallenge[] }> {
  const memberUserIds = [...new Set(input.memberUserIds)];
  const challengeIds = [...new Set(input.challengeIds)];
  const { repo, outcomes } = await withTransaction(async (client) => {
    const fixtureMarker = await isSyntheticOperator(client, actorId);
    if (memberUserIds.length > 0) {
      const { rows } = await client.query(
        `SELECT id, is_test_account FROM users
          WHERE id = ANY($1::int[])
            AND account_state = 'active' AND anonymized_at IS NULL
          ORDER BY id
          FOR UPDATE`,
        [memberUserIds],
      );
      const found = new Set(rows.map((r: { id: number }) => r.id));
      const missing = memberUserIds.filter((id) => !found.has(id));
      if (missing.length > 0) throw new NotFoundError(`User ${missing.join(", ")} not found`);
      for (const userId of memberUserIds) {
        await assertFixtureSubjectScope(client, actorId, userId);
      }
    }
    await assertChallengesExist(client, challengeIds, false, fixtureMarker);

    const created = await insertRepo(client, input, actorId, fixtureMarker, "submitted");
    for (const userId of memberUserIds) {
      await client.query(
        `INSERT INTO submissions (repo_id, user_id, status, responded_at)
         VALUES ($1, $2, 'active', now())`,
        [created.id, userId],
      );
    }
    const enqueued: EnqueueOutcome[] = [];
    for (const challengeId of challengeIds) {
      const outcome = await enterChallenge(client, actorId, created.id, challengeId, "admin");
      if (outcome) enqueued.push(outcome);
    }
    enqueued.push(...(await enrollReposInMandatoryChallenges(client, actorId, [created.id])));
    await audit(client, {
      actorId,
      entityType: "repo",
      entityId: created.id,
      action: "create",
      after: { name: created.name, memberUserIds, challengeIds },
      source: "admin",
    });
    return { repo: created, outcomes: enqueued };
  });
  await announceQueueOutcomes(outcomes);
  return {
    repo,
    memberUserIds,
    challenges: outcomes.map(toEnqueuedChallenge),
  };
}

export interface UpdateRepoPatch {
  name?: string;
  description?: string;
  githubUrl?: string | null;
  demoUrl?: string | null;
  presentationTimingPreference?: string;
}

/**
 * Shared metadata-update core for both the staff PATCH (`updateRepo`, H21)
 * and the participant self-edit (`updateMyProject`, H20) — same fields,
 * different callers audit it with their own actor/source. Locks the row
 * first so a concurrent edit can't interleave with the read-modify-write.
 */
async function applyRepoUpdate(
  client: Queryable,
  repoId: number,
  patch: UpdateRepoPatch,
): Promise<{ before: RepoRow; after: RepoRow }> {
  const existing = await client.query(`${REPO_SELECT} WHERE id = $1 FOR UPDATE`, [repoId]);
  const before = existing.rows[0] as RepoRow | undefined;
  if (!before) throw new NotFoundError(`Repo ${repoId} not found`);
  if (
    patch.presentationTimingPreference !== undefined &&
    patch.presentationTimingPreference !== before.presentation_timing_preference
  ) {
    const generated = await client.query(`SELECT 1 FROM queue_entries WHERE repo_id = $1 LIMIT 1`, [
      repoId,
    ]);
    if (generated.rows[0])
      throw new ConflictError("Presentation timing cannot be changed after queues are generated");
  }

  const next = {
    name: patch.name ?? before.name,
    description: patch.description ?? before.description,
    github_url: patch.githubUrl === undefined ? before.github_url : patch.githubUrl,
    demo_url: patch.demoUrl === undefined ? before.demo_url : patch.demoUrl,
    presentation_timing_preference:
      patch.presentationTimingPreference ?? before.presentation_timing_preference,
  };
  const { rows } = await client.query(
    `UPDATE repos SET name = $2, description = $3, github_url = $4, demo_url = $5,
            presentation_timing_preference = $6
      WHERE id = $1
      RETURNING ${REPO_COLUMNS}`,
    [
      repoId,
      next.name,
      next.description,
      next.github_url,
      next.demo_url,
      next.presentation_timing_preference,
    ],
  );
  return { before, after: rows[0] as RepoRow };
}

function repoAuditFields(repo: RepoRow) {
  return {
    name: repo.name,
    description: repo.description,
    githubUrl: repo.github_url,
    demoUrl: repo.demo_url,
    presentationTimingPreference: repo.presentation_timing_preference,
  };
}

/** H21: staff edit any project's metadata (title, description, links). Audited. */
export async function updateRepo(actorId: number, repoId: number, patch: UpdateRepoPatch) {
  return withTransaction(async (client) => {
    await assertFixtureQueueScope(client, actorId, "repo", repoId);
    const { before, after } = await applyRepoUpdate(client, repoId, patch);
    await audit(client, {
      actorId,
      entityType: "repo",
      entityId: repoId,
      action: "update",
      before: repoAuditFields(before),
      after: repoAuditFields(after),
      source: "admin",
    });
    return after;
  });
}

/**
 * H20: a member edits their own project's metadata while the participant
 * window is open, whether the project is a draft or already submitted; a
 * resubmission records the new version (#1006).
 */
export async function updateMyProject(
  userId: number,
  repoId: number,
  patch: UpdateRepoPatch,
): Promise<RepoRow> {
  return withTransaction(async (client) => {
    await assertProjectEditable(client, repoId);
    const { rows: userRows } = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!userRows[0]) throw new NotFoundError("User not found");
    await assertFixtureSubjectScope(client, userId, userId);
    await assertFixtureQueueScope(client, userId, "repo", repoId);
    await assertProjectParticipantWindow(client, repoId);
    if (!(await isActiveProjectMember(client, repoId, userId))) {
      throw new ForbiddenError("Not a member of this project");
    }
    const { before, after } = await applyRepoUpdate(client, repoId, patch);
    await audit(client, {
      actorId: userId,
      entityType: "repo",
      entityId: repoId,
      action: "update",
      before: repoAuditFields(before),
      after: repoAuditFields(after),
      source: "participant",
    });
    return after;
  });
}

/** True when the event's H19 policy switch allows participant self-creation. */
export async function participantsCanCreateProjects(): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT participants_can_create_projects FROM event_config WHERE id = 1`,
  );
  return rows[0]?.participants_can_create_projects === true;
}

/**
 * H19/H20: whether userId may self-create a project right now — the event
 * policy is on, they're an admitted participant, and the hacking window is
 * open. No longer also requires "doesn't already belong to a project": since
 * self-service allows multiple memberships, GET /api/me/projects.canCreate
 * must reflect exactly the same gate createMyProject enforces, not a
 * leftover "one project only" restriction.
 */
export async function canCreateMyProject(userId: number, db: Queryable = pool): Promise<boolean> {
  const { rows } = await db.query<{ allowed: boolean }>(
    `SELECT (
       ec.participants_can_create_projects IS TRUE
       AND COALESCE(ec.participant_self_service_starts_at, ec.hacking_starts_at) IS NOT NULL
       AND COALESCE(ec.participant_self_service_ends_at, ec.hacking_ends_at) IS NOT NULL
       AND now() BETWEEN COALESCE(ec.participant_self_service_starts_at, ec.hacking_starts_at)
                     AND COALESCE(ec.participant_self_service_ends_at, ec.hacking_ends_at)
       AND EXISTS (
         SELECT 1
           FROM users u
           JOIN user_event_access uea ON uea.user_id = u.id
          WHERE u.id = $1
       )
     ) AS allowed
       FROM event_config ec
      WHERE ec.id = 1`,
    [userId],
  );
  return rows[0]?.allowed === true;
}

/**
 * H19: a participant creates their own project as a draft — only while the
 * event policy (event_config.participants_can_create_projects) is enabled,
 * for admitted participants, inside the participant window. A person may
 * belong to more than one project. The creator becomes the first member;
 * chosen challenges are entered exactly like a hot edit.
 */
export async function createMyProject(
  userId: number,
  input: NativeRepoInput,
): Promise<{ repo: RepoRow; challenges: EnqueuedChallenge[] }> {
  const challengeIds = [...new Set(input.challengeIds)];
  const { repo, outcomes } = await withTransaction(async (client) => {
    const user = await client.query<{ is_test_account: boolean }>(
      `SELECT is_test_account FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!user.rows[0]) throw new NotFoundError("User not found");
    const fixtureMarker = user.rows[0].is_test_account === true;
    // Serialized per-user — harmless now that multiple projects are allowed,
    // kept for symmetry with the rest of this transaction's row locks.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('my_project_create'), $1)`, [userId]);

    const policy = await client.query(
      `SELECT participants_can_create_projects FROM event_config WHERE id = 1`,
    );
    if (policy.rows[0]?.participants_can_create_projects !== true) {
      throw new ForbiddenError("Participant project creation is disabled for this event");
    }

    if (!(await isAdmittedParticipant(client, userId))) {
      throw new ForbiddenError("Only admitted participants can create a project");
    }
    await assertWithinHackingWindow(client);

    await assertChallengesExist(client, challengeIds, true, fixtureMarker);

    const created = await insertRepo(client, input, userId, fixtureMarker, "draft");
    await client.query(
      `INSERT INTO submissions (repo_id, user_id, status, responded_at)
       VALUES ($1, $2, 'active', now())`,
      [created.id, userId],
    );
    const enqueued: EnqueueOutcome[] = [];
    for (const challengeId of challengeIds) {
      const outcome = await enterChallenge(client, userId, created.id, challengeId, "web");
      if (outcome) enqueued.push(outcome);
    }
    enqueued.push(...(await enrollReposInMandatoryChallenges(client, userId, [created.id])));
    await audit(client, {
      actorId: userId,
      entityType: "repo",
      entityId: created.id,
      action: "create",
      after: { name: created.name, createdBy: userId, challengeIds },
      source: "web",
    });
    return { repo: created, outcomes: enqueued };
  });
  await announceQueueOutcomes(outcomes);
  return {
    repo,
    challenges: outcomes.map(toEnqueuedChallenge),
  };
}

// ── H19/H20 self-service membership: invite, accept/decline, leave, delete ──

function displayName(row: {
  name?: string | null;
  surname?: string | null;
  email: string;
}): string {
  const full = [row.name, row.surname].filter(Boolean).join(" ").trim();
  return full || row.email;
}

/**
 * H19/H20: an active member invites a teammate by email. The invitee must be
 * an account holder AND an admitted participant, and must not already be an
 * active member of this exact project. The invite is a pending `submissions`
 * row (status='invited') until the invitee accepts or declines it.
 */
export async function inviteProjectMember(
  userId: number,
  repoId: number,
  email: string,
): Promise<{ invited: true }> {
  return withTransaction(async (client) => {
    await assertProjectEditable(client, repoId);
    const inviterUser = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!inviterUser.rows[0]) throw new NotFoundError("User not found");
    await assertFixtureSubjectScope(client, userId, userId);
    await assertFixtureQueueScope(client, userId, "repo", repoId);
    await assertProjectParticipantWindow(client, repoId);
    if (!(await isActiveProjectMember(client, repoId, userId))) {
      throw new ForbiddenError("Not a member of this project");
    }

    const repoRes = await client.query(`SELECT id, name FROM repos WHERE id = $1`, [repoId]);
    const repo = repoRes.rows[0] as { id: number; name: string } | undefined;
    if (!repo) throw new NotFoundError(`Repo ${repoId} not found`);

    const inviteeRes = await client.query(
      `SELECT id FROM users
        WHERE lower(email) = lower($1)
          AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [email],
    );
    const inviteeId = inviteeRes.rows[0]?.id as number | undefined;
    if (!inviteeId) throw new NotFoundError(`No account for ${email}`);
    await assertFixtureSubjectScope(client, userId, inviteeId);

    if (!(await isAdmittedParticipant(client, inviteeId))) {
      throw new ForbiddenError(`${email} is not an admitted participant`);
    }
    if (await isActiveProjectMember(client, repoId, inviteeId)) {
      throw new ConflictError(`${email} is already a member of this project`);
    }

    // A prior still-pending invite to the same person is idempotent success,
    // not an error — ON CONFLICT DO NOTHING covers the (repo_id, user_id)
    // primary key without a duplicate row or a spurious 409.
    await client.query(
      `INSERT INTO submissions (repo_id, user_id, status, invited_by)
       VALUES ($1, $2, 'invited', $3)
       ON CONFLICT (repo_id, user_id) DO NOTHING
       RETURNING repo_id`,
      [repoId, inviteeId, userId],
    );

    await audit(client, {
      actorId: userId,
      entityType: "repo",
      entityId: repoId,
      action: "member.invite",
      after: { invitedUserId: inviteeId, email },
      source: "participant",
    });

    const inviterRes = await client.query(
      `SELECT name, surname, email FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
      [userId],
    );
    const inviter = inviterRes.rows[0] as
      | { name: string | null; surname: string | null; email: string }
      | undefined;
    await notify(client, {
      userId: inviteeId,
      category: "project",
      actorId: userId,
      payload: {
        template: "project.invite",
        vars: { projectName: repo.name, inviterName: inviter ? displayName(inviter) : "" },
      },
    });

    return { invited: true };
  });
}

export interface PendingInvite {
  repoId: number;
  repoName: string;
  invitedByName: string | null;
  invitedAt: Date;
}

/** H19/H20: pending invites addressed to userId, newest first. */
export async function myPendingInvites(userId: number): Promise<PendingInvite[]> {
  const { rows: userRows } = await pool.query<{ is_test_account: boolean }>(
    `SELECT is_test_account FROM users WHERE id = $1`,
    [userId],
  );
  const fixtureMarker = userRows[0]?.is_test_account === true;
  const { rows } = await pool.query(
    `SELECT s.repo_id, r.name AS repo_name, u.name AS inviter_name, u.surname AS inviter_surname,
            u.email AS inviter_email, s.created_at AS invited_at
       FROM submissions s
       JOIN repos r ON r.id = s.repo_id AND r.is_test_account = $2
       LEFT JOIN users u ON u.id = s.invited_by
          AND u.account_state = 'active' AND u.anonymized_at IS NULL
      WHERE s.user_id = $1 AND s.status = 'invited'
      ORDER BY s.created_at DESC`,
    [userId, fixtureMarker],
  );
  return (
    rows as Array<{
      repo_id: number;
      repo_name: string;
      inviter_name: string | null;
      inviter_surname: string | null;
      inviter_email: string | null;
      invited_at: Date;
    }>
  ).map((row) => ({
    repoId: row.repo_id,
    repoName: row.repo_name,
    invitedByName: row.inviter_email
      ? displayName({
          name: row.inviter_name,
          surname: row.inviter_surname,
          email: row.inviter_email,
        })
      : null,
    invitedAt: row.invited_at,
  }));
}

/** H19/H20: the invited user accepts, becoming an active member. */
export async function acceptProjectInvite(
  userId: number,
  repoId: number,
): Promise<{ accepted: true }> {
  return withTransaction(async (client) => {
    const user = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!user.rows[0]) throw new NotFoundError("User not found");
    await assertFixtureSubjectScope(client, userId, userId);
    await assertFixtureQueueScope(client, userId, "repo", repoId);
    await assertProjectParticipantWindow(client, repoId);
    await assertProjectEditable(client, repoId);
    const { rows } = await client.query(
      `UPDATE submissions SET status = 'active', responded_at = now()
        WHERE repo_id = $1 AND user_id = $2 AND status = 'invited'
        RETURNING repo_id`,
      [repoId, userId],
    );
    if (!rows[0]) throw new NotFoundError(`No pending invite to repo ${repoId}`);
    await audit(client, {
      actorId: userId,
      entityType: "repo",
      entityId: repoId,
      action: "member.invite_accept",
      after: { userId },
      source: "participant",
    });
    return { accepted: true };
  });
}

/** H19/H20: the invited user declines; the pending row is removed entirely. */
export async function declineProjectInvite(
  userId: number,
  repoId: number,
): Promise<{ declined: true }> {
  return withTransaction(async (client) => {
    const user = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!user.rows[0]) throw new NotFoundError("User not found");
    await assertFixtureSubjectScope(client, userId, userId);
    await assertFixtureQueueScope(client, userId, "repo", repoId);
    await assertProjectParticipantWindow(client, repoId);
    await assertProjectEditable(client, repoId);
    const { rows } = await client.query(
      `DELETE FROM submissions WHERE repo_id = $1 AND user_id = $2 AND status = 'invited'
       RETURNING repo_id`,
      [repoId, userId],
    );
    if (!rows[0]) throw new NotFoundError(`No pending invite to repo ${repoId}`);
    await audit(client, {
      actorId: userId,
      entityType: "repo",
      entityId: repoId,
      action: "member.invite_decline",
      before: { userId },
      source: "participant",
    });
    return { declined: true };
  });
}

/**
 * H19/H20: an active member leaves their own project. The last member can't
 * leave (they must delete the project instead) — that keeps a project from
 * silently becoming memberless while still enqueued for judging.
 */
export async function leaveMyProject(userId: number, repoId: number): Promise<{ left: true }> {
  return withTransaction(async (client) => {
    await assertProjectEditable(client, repoId);
    const user = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!user.rows[0]) throw new NotFoundError("User not found");
    await assertFixtureSubjectScope(client, userId, userId);
    await assertFixtureQueueScope(client, userId, "repo", repoId);
    await assertProjectParticipantWindow(client, repoId);
    if (!(await isActiveProjectMember(client, repoId, userId))) {
      throw new ForbiddenError("Not a member of this project");
    }
    const count = await activeProjectMemberCount(client, repoId);
    if (count <= 1) {
      throw new ConflictError("You are the last member; delete the project instead");
    }

    await client.query(
      `DELETE FROM submissions WHERE repo_id = $1 AND user_id = $2 AND status = 'active'`,
      [repoId, userId],
    );
    await audit(client, {
      actorId: userId,
      entityType: "repo",
      entityId: repoId,
      action: "member.leave",
      before: { userId },
      source: "participant",
    });
    return { left: true };
  });
}

interface DeletedQueueEntry {
  id: number;
  challenge_id: number;
  repo_id: number;
  fixtureMarker: boolean | null;
}

/**
 * Deletes every row that transitively references repoId before the repo row
 * itself — none of the FKs onto `repos`/`queue_entries` cascade, and
 * `deleteMyProject` only ever reaches here once the caller has confirmed
 * they're the project's sole member.
 *
 * H19/H20 + H38/H41: queue entries and their active repo members disappear in
 * this transaction, so ids, marker-scoped broadcast topics, and personal
 * invalidation recipients must be captured before the delete. The caller emits
 * those notifications only after this transaction commits; the delayed worker
 * cannot rediscover a member from queue rows that no longer exist.
 */
async function deleteRepoCascade(
  client: Queryable,
  repoId: number,
  fixtureMarker: boolean,
): Promise<{ queueEntries: DeletedQueueEntry[]; memberIds: number[] }> {
  const memberIds = await repoMemberIds(client, repoId, fixtureMarker);
  const queueEntriesRes = await client.query<{
    id: number;
    challenge_id: number;
    repo_id: number;
    challenge_is_test_account: boolean;
    repo_is_test_account: boolean;
  }>(
    `SELECT qe.id, qe.challenge_id, qe.repo_id,
            c.is_test_account AS challenge_is_test_account,
            r.is_test_account AS repo_is_test_account
       FROM queue_entries qe
       JOIN challenges c ON c.id = qe.challenge_id
       JOIN repos r ON r.id = qe.repo_id
      WHERE qe.repo_id = $1
      ORDER BY qe.id
      FOR UPDATE OF qe`,
    [repoId],
  );
  const queueEntries = queueEntriesRes.rows.map((entry) => ({
    id: Number(entry.id),
    challenge_id: Number(entry.challenge_id),
    repo_id: Number(entry.repo_id),
    // A mixed queue graph is an isolation violation; fail closed instead of
    // putting a deleted fixture payload on the real operator stream (H54).
    fixtureMarker:
      entry.challenge_is_test_account === entry.repo_is_test_account
        ? entry.challenge_is_test_account === true
        : null,
  }));

  // The caller checked the repository graph before locking it, but a stale
  // or direct-SQL queue row can still be introduced before this transaction
  // acquires the entry locks. Re-resolve every locked entry's complete group
  // and room graph before any destructive delete so self-service cannot turn
  // a raced mixed fixture into a real-topic invalidation (H19/H20, H54).
  for (const entry of queueEntries) {
    let resolvedMarker: boolean | null;
    try {
      resolvedMarker = await queueFixtureMarker(client, "entry", entry.id);
    } catch {
      resolvedMarker = null;
    }
    if (resolvedMarker === null || resolvedMarker !== fixtureMarker) {
      throw new ConflictError("Queue fixture markers must match", {
        code: "review_fixture_scope",
        resource: "repo",
        resourceId: repoId,
      });
    }
    entry.fixtureMarker = resolvedMarker;
  }

  await client.query(
    `DELETE FROM attempt_review_versions WHERE attempt_id IN
       (SELECT id FROM queue_entries WHERE repo_id = $1)`,
    [repoId],
  );
  await client.query(
    `DELETE FROM attempt_review WHERE attempt_id IN
       (SELECT id FROM queue_entries WHERE repo_id = $1)`,
    [repoId],
  );
  await client.query(
    `DELETE FROM judging_session WHERE queue_entry_id IN
       (SELECT id FROM queue_entries WHERE repo_id = $1)`,
    [repoId],
  );
  await client.query(
    `DELETE FROM queue_history WHERE queue_entry_id IN
       (SELECT id FROM queue_entries WHERE repo_id = $1)`,
    [repoId],
  );
  await client.query(`DELETE FROM challenge_winners WHERE repo_id = $1`, [repoId]);
  await client.query(`DELETE FROM queue_entries WHERE repo_id = $1`, [repoId]);
  await client.query(`DELETE FROM submissions WHERE repo_id = $1`, [repoId]);
  await client.query(`DELETE FROM repos WHERE id = $1`, [repoId]);
  return { queueEntries, memberIds };
}

/**
 * H19/H20: the last remaining member deletes their own project outright.
 * Re-checks the caller is both a member and the SOLE member inside the
 * transaction before touching anything irreversible.
 */
export async function deleteMyProject(userId: number, repoId: number): Promise<{ deleted: true }> {
  const { queueEntries, memberIds } = await withTransaction(async (client) => {
    const user = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!user.rows[0]) throw new NotFoundError("User not found");
    await assertFixtureSubjectScope(client, userId, userId);
    await assertQueueRepoScope(client, userId, repoId);
    await assertProjectParticipantWindow(client, repoId);
    await assertProjectEditable(client, repoId);
    const history = await client.query(
      `SELECT 1 FROM project_submission_versions WHERE repo_id=$1 LIMIT 1`,
      [repoId],
    );
    if (history.rows[0])
      throw new ConflictError(
        "A previously submitted project must be retained; ask organizers to withdraw it",
      );
    await assertJudgingHasNotStarted(client);
    if (!(await isActiveProjectMember(client, repoId, userId))) {
      throw new ForbiddenError("Not a member of this project");
    }
    const count = await activeProjectMemberCount(client, repoId);
    if (count > 1) {
      throw new ConflictError("Remove other members first, or ask queue management");
    }

    const repoRes = await client.query(
      `SELECT id, name, is_test_account FROM repos WHERE id = $1 FOR UPDATE`,
      [repoId],
    );
    const repo = repoRes.rows[0] as
      | { id: number; name: string; is_test_account: boolean }
      | undefined;
    if (!repo) throw new NotFoundError(`Repo ${repoId} not found`);

    const deleted = await deleteRepoCascade(client, repoId, repo.is_test_account === true);

    await audit(client, {
      actorId: userId,
      entityType: "repo",
      entityId: repoId,
      action: "delete",
      before: { name: repo.name },
      source: "participant",
    });
    return deleted;
  });

  // The queue rows no longer exist, so resolve each topic from the marker
  // captured inside the transaction. These are best-effort notifications on
  // top of the committed deletion; they must not become part of its rollback
  // boundary or the idempotent request response (H19/H20, H38/H41).
  for (const entry of queueEntries) {
    await broadcastQueueEventWithMarker(entry.fixtureMarker, EVENTS.QUEUE_ENTRY_CHANGED, {
      id: entry.id,
      challenge_id: entry.challenge_id,
      repo_id: entry.repo_id,
      deleted: true,
    });
  }

  // Queue rows are gone by this point, so the delayed challenge worker cannot
  // discover the deleted team's recipients. Refresh each marker-matched
  // member directly; the payload is only the challenge id and never queue data.
  const participantChallenges = new Set(
    queueEntries.filter((entry) => entry.fixtureMarker !== null).map((entry) => entry.challenge_id),
  );
  await Promise.all(
    [...participantChallenges].flatMap((challengeId) =>
      memberIds.map((memberId) =>
        broadcast(`${SSE_TOPICS.USER_PREFIX}${memberId}`, EVENTS.USER_QUEUE_CHANGED, {
          challengeId,
        }),
      ),
    ),
  );

  const affectedChallenges = [...new Set(queueEntries.map((entry) => entry.challenge_id))];
  for (const challengeId of affectedChallenges) {
    await notifyChallengeQueueChanged(pool, challengeId);
  }

  return { deleted: true };
}

/** H21: project editors can remove any project, even after judging has
 * started. The cascade and subsequent queue invalidations intentionally match
 * the participant delete path, but no membership/window rule applies. */
export async function deleteRepo(actorId: number, repoId: number): Promise<{ deleted: true }> {
  const { queueEntries, memberIds } = await withTransaction(async (client) => {
    const fixtureMarker = await assertQueueRepoScope(client, actorId, repoId);
    const repoRes = await client.query(
      `SELECT id, name, is_test_account FROM repos WHERE id = $1 FOR UPDATE`,
      [repoId],
    );
    const repo = repoRes.rows[0] as
      | { id: number; name: string; is_test_account: boolean }
      | undefined;
    if (!repo) throw new NotFoundError(`Repo ${repoId} not found`);
    if (fixtureMarker !== (repo.is_test_account === true)) {
      throw new ConflictError("Queue fixture markers must match", {
        code: "review_fixture_scope",
        repoId,
      });
    }
    const deleted = await deleteRepoCascade(client, repoId, repo.is_test_account === true);
    await audit(client, {
      actorId,
      entityType: "repo",
      entityId: repoId,
      action: "delete",
      before: { name: repo.name },
      source: "admin",
    });
    return deleted;
  });
  for (const entry of queueEntries) {
    await broadcastQueueEventWithMarker(entry.fixtureMarker, EVENTS.QUEUE_ENTRY_CHANGED, {
      id: entry.id,
      challenge_id: entry.challenge_id,
      repo_id: entry.repo_id,
      deleted: true,
    });
  }
  const challengeIds = [...new Set(queueEntries.map((entry) => entry.challenge_id))];
  await Promise.all(
    challengeIds.flatMap((challengeId) =>
      memberIds.map((memberId) =>
        broadcast(`${SSE_TOPICS.USER_PREFIX}${memberId}`, EVENTS.USER_QUEUE_CHANGED, {
          challengeId,
        }),
      ),
    ),
  );
  for (const challengeId of challengeIds) await notifyChallengeQueueChanged(pool, challengeId);
  return { deleted: true };
}

/**
 * Expected participation per challenge for staff with project-read access and
 * for sponsor representatives (their own enterprise's challenges only): every
 * project that entered the challenge, by selection, mandatory participation
 * or a live queue entry, and the distinct active members behind them (#1006).
 */
export async function challengeEstimates(userId: number) {
  const staff = await userHasCapability(
    createAuthorizationContext(userId),
    CAPABILITIES.PROJECTS_READ,
  );
  const sponsor = await pool.query(`SELECT 1 FROM sponsors WHERE user_id = $1 LIMIT 1`, [userId]);
  if (!staff && !sponsor.rows[0])
    throw new ForbiddenError("Not allowed to read challenge participation estimates");
  const { rows } = await pool.query(
    `WITH allowed AS (
       SELECT c.id, c.title, c.mandatory FROM challenges c JOIN sponsors author ON author.id = c.author
        WHERE c.is_test_account = false AND ($2 OR EXISTS (
          SELECT 1 FROM sponsors mine WHERE mine.enterprise_id = author.enterprise_id AND mine.user_id = $1
        ))
     ), entered AS (
       SELECT c.id AS challenge_id, r.id AS repo_id
         FROM allowed c JOIN repos r ON r.is_test_account = false AND (
           c.mandatory
           OR EXISTS (SELECT 1 FROM project_challenges pc WHERE pc.repo_id = r.id AND pc.challenge_id = c.id)
           OR EXISTS (SELECT 1 FROM queue_entries qe WHERE qe.repo_id = r.id AND qe.challenge_id = c.id
                       AND qe.status NOT IN ('cancelled', 'disqualified'))
         )
     )
     SELECT c.id AS "challengeId", c.title,
       (SELECT count(*)::int FROM entered e WHERE e.challenge_id = c.id) AS "projectCount",
       (SELECT count(DISTINCT s.user_id)::int FROM entered e
          JOIN submissions s ON s.repo_id = e.repo_id AND s.status = 'active'
         WHERE e.challenge_id = c.id) AS "participantCount"
       FROM allowed c ORDER BY c.title`,
    [userId, staff],
  );
  return rows;
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

export async function listPublicChallenges(): Promise<PublicChallenge[]> {
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

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
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
