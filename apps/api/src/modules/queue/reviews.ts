import { CAPABILITIES } from "@hackos/shared/capabilities";
import { firstNumericQuestionKey, type Question } from "@hackos/shared/questions";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { type AuthorizationContext, userHasCapability } from "../../lib/capabilities.js";
import { toCsv } from "../../lib/csv.js";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../../lib/errors.js";
import { isSyntheticOperator } from "../logistics/review-fixture-scope.js";
import { RESOLVED_PANEL_SQL } from "./criteria-merge.js";
import { assertQueueEntryScope } from "./fixture-scope.js";
import { QUEUE_GROUP_LABEL_JOIN, QUEUE_GROUP_LABEL_SQL } from "./groups.js";
import { notifyTeamMessage } from "./notify.js";

/**
 * H46 + confidentiality requirement: the reviews overview is NOT "anyone with
 * an export capability sees everything". Two strictly separate audiences:
 *  - admin (QUEUE_ADMIN): sees every review in the caller's fixture boundary;
 *    real admins see the real event graph and synthetic operators see only
 *    the marked review graph.
 *  - sponsor rep: sees ONLY their own enterprise's challenges — even with no
 *    challengeId filter, the query is always scoped to their own challenges,
 *    and an explicit filter for a challenge they don't own 403s. There is no
 *    "sees everything but can't export" middle tier.
 * Anyone else (judges, participants) is forbidden — this page is a
 * staff/sponsor tool, not part of the judging UI itself.
 */
export interface ReviewScope {
  actorId: number;
  isAdmin: boolean;
  /** Sponsor's own challenge ids. Irrelevant when isAdmin. */
  ownChallengeIds: number[];
  /** Synthetic callers may only see and mutate the marked review graph. */
  fixtureMarker: boolean;
}

export async function resolveReviewScope(context: AuthorizationContext): Promise<ReviewScope> {
  const userId = context.userId;
  if (userId == null) throw new UnauthorizedError();
  const fixtureMarker = await isSyntheticOperator(pool, userId);
  if (await userHasCapability(context, CAPABILITIES.QUEUE_ADMIN)) {
    return { actorId: userId, isAdmin: true, ownChallengeIds: [], fixtureMarker };
  }

  const isSponsor =
    (await pool.query(`SELECT 1 FROM sponsors WHERE user_id = $1 LIMIT 1`, [userId])).rowCount! > 0;
  if (!isSponsor) throw new ForbiddenError("Not allowed to view reviews");

  const { rows } = await pool.query(
    `SELECT DISTINCT c.id
       FROM challenges c
      JOIN sponsors author ON author.id = c.author
      JOIN sponsors mine ON mine.enterprise_id = author.enterprise_id
      WHERE mine.user_id = $1 AND c.is_test_account = $2`,
    [userId, fixtureMarker],
  );
  return {
    actorId: userId,
    isAdmin: false,
    ownChallengeIds: rows.map((r: { id: number }) => r.id),
    fixtureMarker,
  };
}

export interface ReviewFilters {
  challengeId?: number;
  roomId?: number;
  status?: "draft" | "submitted" | "none";
}

/** null = no challenge restriction (admin, unfiltered). Never null for a sponsor. */
function resolveChallengeFilter(
  scope: ReviewScope,
  requestedChallengeId?: number,
): number[] | null {
  if (scope.isAdmin) return requestedChallengeId != null ? [requestedChallengeId] : null;
  if (requestedChallengeId != null) {
    if (!scope.ownChallengeIds.includes(requestedChallengeId)) {
      throw new ForbiddenError("Not allowed to view this challenge's reviews", {
        challengeId: requestedChallengeId,
      });
    }
    return [requestedChallengeId];
  }
  return scope.ownChallengeIds;
}

export interface ReviewRow {
  entryId: number;
  challengeId: number;
  /** The queue group's display name, not an individual challenge title. */
  challengeTitle: string;
  appliedChallenges: Array<{ id: number; title: string }>;
  repoId: number;
  repoName: string;
  roomId: number | null;
  roomName: string | null;
  status: "draft" | "submitted" | null;
  nota: number | null;
  judges: string[];
  updatedAt: string | null;
}

/** All non-cancelled challenge applications in this project's queue group. */
function appliedChallengesSql(fixtureMarkerParam: number): string {
  return `COALESCE(
    (SELECT jsonb_agg(
              jsonb_build_object('id', applied.id, 'title', applied.title)
              ORDER BY applied.title, applied.id
            )
       FROM (
         SELECT DISTINCT applied_challenge.id, applied_challenge.title
           FROM queue_entries applied_entry
           JOIN queue_group_challenges applied_qgc
             ON applied_qgc.challenge_id = applied_entry.challenge_id
            AND applied_qgc.queue_group_id = qgc_label.queue_group_id
           JOIN challenges applied_challenge
             ON applied_challenge.id = applied_entry.challenge_id
            AND applied_challenge.is_test_account = $${fixtureMarkerParam}
          WHERE applied_entry.repo_id = qe.repo_id
            AND applied_entry.status NOT IN ('cancelled', 'disqualified')
       ) applied
    ), '[]'::jsonb)`;
}

export async function listReviews(
  scope: ReviewScope,
  filters: ReviewFilters,
): Promise<ReviewRow[]> {
  const challengeIds = resolveChallengeFilter(scope, filters.challengeId);
  if (challengeIds !== null && challengeIds.length === 0) return [];

  const conditions: string[] = ["c.is_test_account = $1", "r.is_test_account = $1"];
  const params: unknown[] = [scope.fixtureMarker];
  if (challengeIds !== null) {
    params.push(challengeIds);
    conditions.push(`EXISTS (
      SELECT 1
        FROM queue_entries filter_entry
        JOIN queue_group_challenges filter_qgc
          ON filter_qgc.challenge_id = filter_entry.challenge_id
         AND filter_qgc.queue_group_id = qgc_label.queue_group_id
       WHERE filter_entry.repo_id = qe.repo_id
         AND filter_entry.status NOT IN ('cancelled', 'disqualified')
         AND filter_entry.challenge_id = ANY($${params.length}::int[])
    )`);
  }
  if (filters.roomId != null) {
    params.push(filters.roomId);
    conditions.push(`qe.assigned_room_id = $${params.length}`);
  }
  if (filters.status === "none") {
    conditions.push(`ar.status IS NULL`);
  } else if (filters.status != null) {
    params.push(filters.status);
    conditions.push(`ar.status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (qe.repo_id, qgc_label.queue_group_id)
              qe.id AS entry_id, qe.challenge_id, ${QUEUE_GROUP_LABEL_SQL} AS challenge_title,
              ${appliedChallengesSql(1)} AS applied_challenges,
              ${RESOLVED_PANEL_SQL} AS judging_panel_criteria,
              qe.repo_id, r.name AS repo_name,
              qe.assigned_room_id, room.name AS room_name,
              ar.status, ar.scores, ar.updated_at,
              COALESCE(judges.names, '{}') AS judges
         FROM queue_entries qe
         JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $1
         ${QUEUE_GROUP_LABEL_JOIN}
         JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = $1
         LEFT JOIN rooms room ON room.id = qe.assigned_room_id
         LEFT JOIN attempt_review ar ON ar.attempt_id = qe.id
         LEFT JOIN LATERAL (
           SELECT array_agg(DISTINCT trim(concat(u.name, ' ', u.surname))) AS names
             FROM attempt_review_versions v
             JOIN users u ON u.id = v.author_id
                AND u.account_state = 'active' AND u.anonymized_at IS NULL
                AND u.is_test_account = $1
            WHERE v.attempt_id = qe.id
         ) judges ON true
        ${where}
        ORDER BY qe.repo_id, qgc_label.queue_group_id,
                 CASE WHEN ar.status IS NULL THEN 1 ELSE 0 END,
                 ar.updated_at DESC NULLS LAST,
                 qe.id DESC
     ) listed
      ORDER BY listed.challenge_title, listed.repo_name`,
    params,
  );

  return rows.map(
    (row: {
      entry_id: number;
      challenge_id: number;
      challenge_title: string;
      applied_challenges: Array<{ id: number; title: string }>;
      judging_panel_criteria: unknown;
      repo_id: number;
      repo_name: string;
      assigned_room_id: number | null;
      room_name: string | null;
      status: "draft" | "submitted" | null;
      scores: Record<string, unknown> | null;
      updated_at: Date | null;
      judges: string[];
    }) => {
      const criteria = Array.isArray(row.judging_panel_criteria)
        ? (row.judging_panel_criteria as Question[])
        : [];
      const notaKey = firstNumericQuestionKey(criteria);
      const notaValue = notaKey ? row.scores?.[notaKey] : undefined;
      return {
        entryId: row.entry_id,
        challengeId: row.challenge_id,
        challengeTitle: row.challenge_title,
        appliedChallenges: row.applied_challenges ?? [],
        repoId: row.repo_id,
        repoName: row.repo_name,
        roomId: row.assigned_room_id,
        roomName: row.room_name,
        status: row.status ?? null,
        nota: typeof notaValue === "number" ? notaValue : null,
        judges: row.judges ?? [],
        updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
      };
    },
  );
}

/**
 * Same scoping as listReviews, but for a single entry: an admin reaches any
 * entry in the caller's fixture boundary, a sponsor rep only entries of their
 * own enterprise's challenges.
 * Returns the row's context so callers don't re-query it.
 */
export async function assertEntryInScope(
  scope: ReviewScope,
  entryId: number,
): Promise<{ challengeId: number; repoId: number }> {
  // Review routes are also queue-resource routes: validate the complete
  // challenge/repository/group graph before loading any review projection.
  // This prevents a synthetic QUEUE_ADMIN from using a real entry id to
  // bypass the marker boundary (H54).
  await assertQueueEntryScope(pool, scope.actorId, entryId);
  const { rows } = await pool.query(
    `SELECT qe.challenge_id, qe.repo_id
       FROM queue_entries qe
       JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
       JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = $2
      WHERE qe.id = $1`,
    [entryId, scope.fixtureMarker],
  );
  if (rows.length === 0) throw new NotFoundError("Queue entry not found", { entryId });
  const challengeId: number = rows[0].challenge_id;
  if (!scope.isAdmin && !scope.ownChallengeIds.includes(challengeId)) {
    throw new ForbiddenError("Not allowed to view this challenge's reviews", { challengeId });
  }
  return { challengeId, repoId: rows[0].repo_id };
}

export interface ReviewDetail {
  entryId: number;
  status: string;
  calledAt: string | null;
  presentationStartedAt: string | null;
  completedAt: string | null;
  challenge: {
    id: number;
    title: string;
    appliedChallenges: Array<{ id: number; title: string }>;
    criteria: Question[];
  };
  room: { id: number; name: string; location: string | null } | null;
  project: {
    id: number;
    name: string;
    description: string;
    githubUrl: string | null;
    devpostUrl: string | null;
    demoUrl: string | null;
    members: Array<{ id: number | null; name: string; email: string | null }>;
  };
  review: {
    status: "draft" | "submitted" | null;
    scores: Record<string, unknown>;
    notes: string | null;
    updatedAt: string | null;
  };
  versions: Array<{
    id: number;
    authorName: string;
    changedFields: string[];
    createdAt: string;
  }>;
}

/** Full ficha behind a reviews-overview row: project, panel questions, answers, history. */
export async function getReviewDetail(scope: ReviewScope, entryId: number): Promise<ReviewDetail> {
  await assertEntryInScope(scope, entryId);

  const { rows } = await pool.query(
    `SELECT qe.id AS entry_id, qe.status, qe.called_at, qe.presentation_started_at, qe.completed_at,
            c.id AS challenge_id, ${QUEUE_GROUP_LABEL_SQL} AS challenge_title,
            ${appliedChallengesSql(2)} AS applied_challenges,
            ${RESOLVED_PANEL_SQL} AS judging_panel_criteria,
            r.id AS repo_id, r.name AS repo_name, r.description, r.github_url, r.devpost_url, r.demo_url,
            room.id AS room_id, room.name AS room_name, room.location AS room_location,
            ar.status AS review_status, ar.scores, ar.notes, ar.updated_at
       FROM queue_entries qe
       JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
       ${QUEUE_GROUP_LABEL_JOIN}
       JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = $2
       LEFT JOIN rooms room ON room.id = qe.assigned_room_id
       LEFT JOIN attempt_review ar ON ar.attempt_id = qe.id
      WHERE qe.id = $1`,
    [entryId, scope.fixtureMarker],
  );
  const row = rows[0];

  // Same union as notify.repoMemberIds, plus the Devpost-only rows that never
  // matched a user — the panel still wants to show who is on the team.
  const { rows: memberRows } = await pool.query(
    `SELECT u.id, trim(concat(u.name, ' ', u.surname)) AS name, u.email
       FROM submissions s JOIN users u ON u.id = s.user_id
      WHERE s.repo_id = $1
        AND s.status = 'active' AND u.account_state = 'active' AND u.anonymized_at IS NULL
        AND u.is_test_account = $2
       UNION
       SELECT u.id, trim(concat(u.name, ' ', u.surname)) AS name, u.email
       FROM devpost_participants dp JOIN users u ON u.id = dp.user_id
      WHERE dp.repo_id = $1
        AND u.account_state = 'active' AND u.anonymized_at IS NULL
        AND u.is_test_account = $2
       UNION
       SELECT NULL::int AS id, trim(concat(dp.name, ' ', dp.surname)) AS name, dp.email
       FROM devpost_participants dp
      WHERE dp.repo_id = $1 AND dp.user_id IS NULL
      ORDER BY name`,
    [row.repo_id, scope.fixtureMarker],
  );

  const { rows: versionRows } = await pool.query(
    `SELECT v.id, v.changed_fields, v.created_at, trim(concat(u.name, ' ', u.surname)) AS author_name
       FROM attempt_review_versions v
       JOIN users u ON u.id = v.author_id
          AND u.account_state = 'active' AND u.anonymized_at IS NULL
          AND u.is_test_account = $2
      WHERE v.attempt_id = $1
      ORDER BY v.created_at ASC`,
    [entryId, scope.fixtureMarker],
  );

  const criteria = Array.isArray(row.judging_panel_criteria)
    ? (row.judging_panel_criteria as Question[])
    : [];

  return {
    entryId: row.entry_id,
    status: row.status,
    calledAt: row.called_at?.toISOString() ?? null,
    presentationStartedAt: row.presentation_started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    challenge: {
      id: row.challenge_id,
      title: row.challenge_title,
      appliedChallenges: row.applied_challenges ?? [],
      criteria,
    },
    room: row.room_id
      ? { id: row.room_id, name: row.room_name, location: row.room_location ?? null }
      : null,
    project: {
      id: row.repo_id,
      name: row.repo_name,
      description: row.description ?? "",
      githubUrl: row.github_url,
      devpostUrl: row.devpost_url,
      demoUrl: row.demo_url,
      members: memberRows.map((m: { id: number | null; name: string; email: string | null }) => ({
        id: m.id,
        name: m.name?.trim() || (m.email ?? ""),
        email: m.email,
      })),
    },
    review: {
      status: row.review_status ?? null,
      scores: (row.scores as Record<string, unknown> | null) ?? {},
      notes: row.notes ?? null,
      updatedAt: row.updated_at?.toISOString() ?? null,
    },
    versions: versionRows.map(
      (v: {
        id: number;
        changed_fields: string[];
        created_at: Date;
        author_name: string | null;
      }) => ({
        id: v.id,
        authorName: v.author_name?.trim() ?? "",
        changedFields: v.changed_fields,
        createdAt: v.created_at.toISOString(),
      }),
    ),
  };
}

/**
 * Message the team behind an evaluation (H46 + H29 channel): reaches every
 * member through the mandatory `queue` notification category, exactly like a
 * call does, and is audited (H53) because it is staff-authored content sent
 * to participants in the event's name.
 */
export async function sendReviewMessage(
  scope: ReviewScope,
  entryId: number,
  actorId: number,
  message: string,
): Promise<{ recipients: number }> {
  const { challengeId, repoId } = await assertEntryInScope(scope, entryId);

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT trim(concat(name, ' ', surname)) AS full_name
         FROM users WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
      [actorId],
    );
    const senderName: string = rows[0]?.full_name?.trim() || "";

    const recipients = await notifyTeamMessage(client, {
      entryId,
      challengeId,
      repoId,
      senderName,
      message,
    });
    await audit(client, {
      actorId,
      entityType: "queue_entry",
      entityId: entryId,
      action: "review.message_team",
      after: { message, recipients, repoId, challengeId },
    });
    return { recipients };
  });
}

export async function exportReviewsCsv(
  scope: ReviewScope,
  filters: ReviewFilters,
): Promise<string> {
  const rows = await listReviews(scope, filters);
  const header = [
    "queue",
    "challenges",
    "room",
    "project",
    "status",
    "nota",
    "judges",
    "updated_at",
  ];
  return toCsv(
    header,
    rows.map((r) => [
      r.challengeTitle,
      r.appliedChallenges.map((challenge) => challenge.title).join("; "),
      r.roomName ?? "",
      r.repoName,
      r.status ?? "not_evaluated",
      r.nota ?? "",
      r.judges.join("; "),
      r.updatedAt ?? "",
    ]),
  );
}
