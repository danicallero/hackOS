import { CAPABILITIES } from "@hackos/shared/capabilities";
import { firstNumericQuestionKey, type Question } from "@hackos/shared/questions";
import { pool } from "../../db/pool.js";
import { userHasCapability } from "../../lib/capabilities.js";
import { toCsv } from "../../lib/csv.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";

/**
 * H46 + confidentiality requirement: the reviews overview is NOT "anyone with
 * an export capability sees everything". Two strictly separate audiences:
 *  - admin (QUEUE_ADMIN): sees every challenge's reviews, no restriction.
 *  - sponsor rep: sees ONLY their own enterprise's challenges — even with no
 *    challengeId filter, the query is always scoped to their own challenges,
 *    and an explicit filter for a challenge they don't own 403s. There is no
 *    "sees everything but can't export" middle tier.
 * Anyone else (judges, participants) is forbidden — this page is a
 * staff/sponsor tool, not part of the judging UI itself.
 */
export interface ReviewScope {
  isAdmin: boolean;
  /** Sponsor's own challenge ids. Irrelevant when isAdmin. */
  ownChallengeIds: number[];
}

export async function resolveReviewScope(userId: number | null): Promise<ReviewScope> {
  if (userId == null) throw new UnauthorizedError();
  if (await userHasCapability(userId, CAPABILITIES.QUEUE_ADMIN)) {
    return { isAdmin: true, ownChallengeIds: [] };
  }

  const isSponsor =
    (await pool.query(`SELECT 1 FROM sponsors WHERE user_id = $1 LIMIT 1`, [userId])).rowCount! > 0;
  if (!isSponsor) throw new ForbiddenError("Not allowed to view reviews");

  const { rows } = await pool.query(
    `SELECT DISTINCT c.id
       FROM challenges c
       JOIN sponsors author ON author.id = c.author
       JOIN sponsors mine ON mine.enterprise_id = author.enterprise_id
      WHERE mine.user_id = $1`,
    [userId],
  );
  return { isAdmin: false, ownChallengeIds: rows.map((r: { id: number }) => r.id) };
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
  challengeTitle: string;
  repoId: number;
  repoName: string;
  roomId: number | null;
  roomName: string | null;
  status: "draft" | "submitted" | null;
  nota: number | null;
  judges: string[];
  updatedAt: string | null;
}

export async function listReviews(
  scope: ReviewScope,
  filters: ReviewFilters,
): Promise<ReviewRow[]> {
  const challengeIds = resolveChallengeFilter(scope, filters.challengeId);
  if (challengeIds !== null && challengeIds.length === 0) return [];

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (challengeIds !== null) {
    params.push(challengeIds);
    conditions.push(`qe.challenge_id = ANY($${params.length}::int[])`);
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
    `SELECT qe.id AS entry_id, qe.challenge_id, c.title AS challenge_title, c.judging_panel_criteria,
            qe.repo_id, r.name AS repo_name,
            qe.assigned_room_id, room.name AS room_name,
            ar.status, ar.scores, ar.updated_at,
            COALESCE(judges.names, '{}') AS judges
       FROM queue_entries qe
       JOIN challenges c ON c.id = qe.challenge_id
       JOIN repos r ON r.id = qe.repo_id
       LEFT JOIN rooms room ON room.id = qe.assigned_room_id
       LEFT JOIN attempt_review ar ON ar.attempt_id = qe.id
       LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT trim(concat(u.name, ' ', u.surname))) AS names
           FROM attempt_review_versions v
           JOIN users u ON u.id = v.author_id
          WHERE v.attempt_id = qe.id
       ) judges ON true
       ${where}
      ORDER BY c.title, r.name`,
    params,
  );

  return rows.map(
    (row: {
      entry_id: number;
      challenge_id: number;
      challenge_title: string;
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

export async function exportReviewsCsv(
  scope: ReviewScope,
  filters: ReviewFilters,
): Promise<string> {
  const rows = await listReviews(scope, filters);
  const header = ["challenge", "room", "project", "status", "nota", "judges", "updated_at"];
  return toCsv(
    header,
    rows.map((r) => [
      r.challengeTitle,
      r.roomName ?? "",
      r.repoName,
      r.status ?? "not_evaluated",
      r.nota ?? "",
      r.judges.join("; "),
      r.updatedAt ?? "",
    ]),
  );
}
