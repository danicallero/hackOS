import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";

/**
 * H46: internal winner ranking. Open-ended placements — `rank` is a free
 * integer chosen by the sponsor/admin (1st, 2nd, 3rd, a "special prize" at
 * rank 4, etc.), not a fixed top-3. Never surfaced publicly or to other
 * sponsors — access is gated by the same `assertCanEditChallenge` check used
 * for editing the challenge itself (admin, or the owning sponsor rep).
 */

export interface ChallengeWinner {
  rank: number;
  repoId: number;
  repoName: string;
  setBy: number;
  updatedAt: string;
}

export async function getChallengeWinners(challengeId: number): Promise<ChallengeWinner[]> {
  const { rows } = await pool.query(
    `SELECT w.rank, w.repo_id, r.name AS repo_name, w.set_by, w.updated_at
       FROM challenge_winners w
       JOIN repos r ON r.id = w.repo_id
      WHERE w.challenge_id = $1
      ORDER BY w.rank ASC`,
    [challengeId],
  );
  return rows.map((row: Record<string, unknown>) => ({
    rank: row.rank as number,
    repoId: row.repo_id as number,
    repoName: row.repo_name as string,
    setBy: row.set_by as number,
    updatedAt: (row.updated_at as Date).toISOString(),
  }));
}

/**
 * Sets `rank` to `repoId` as an atomic replace: any prior occupant of that
 * rank is cleared (not bumped to another rank — re-ranking is an explicit
 * choice, never automatic), and if `repoId` already held a different rank on
 * this challenge, that old rank is cleared too so a repo never holds two
 * placements at once.
 */
export async function setChallengeWinner(
  actorId: number,
  challengeId: number,
  rank: number,
  repoId: number,
): Promise<ChallengeWinner> {
  return withTransaction(async (client) => {
    const challenge = await client.query(`SELECT id FROM challenges WHERE id = $1 FOR UPDATE`, [
      challengeId,
    ]);
    if (challenge.rowCount === 0) throw new NotFoundError("Challenge not found", { challengeId });

    // H46: a sponsor may opt out of the queue system entirely, so a repo can
    // be a legitimate winner candidate either through a queue entry or
    // through the devpost prize-tag mapping (repo_devpost_prizes / challenge
    // devpost_tags), same "entered" test loadEligibleRepos uses on the web.
    //
    // Eligibility is scoped to the challenge's *queue group*, not the bare
    // challenge id: challenges merged into one shared queue are judged
    // together, so a repo evaluated through that queue counts as entered in
    // every challenge the group feeds (draft §5). Since 0410 every challenge
    // sits in its own 1:1 group, so today the group resolves to exactly
    // `challengeId` and this behaves identically to the pre-group check; the
    // `UNION SELECT $1` keeps that true even for a challenge with no group
    // row at all. The win is still recorded against the challenge_id the
    // sponsor is picking for — `challenge_winners` is unchanged.
    //
    // NOTE: when a repo qualifies via several challenges in one group, the
    // draft's §5 picker (asking which challenge_id to attribute the win to)
    // is deliberately deferred to the PR that ships queue-group merging UI.
    // No group can hold more than one challenge yet, so there is nothing
    // ambiguous to resolve; only this eligibility check has to be N-correct.
    const entrant = await client.query(
      `WITH group_challenges AS (
         SELECT sibling.challenge_id
           FROM queue_group_challenges self
           JOIN queue_group_challenges sibling
             ON sibling.queue_group_id = self.queue_group_id
          WHERE self.challenge_id = $1
         UNION
         SELECT $1::integer
       )
       SELECT 1 FROM queue_entries q
         JOIN group_challenges g ON g.challenge_id = q.challenge_id
        WHERE q.repo_id = $2
       UNION
       SELECT 1 FROM repo_devpost_prizes p
         JOIN challenges c ON c.id IN (SELECT challenge_id FROM group_challenges)
        WHERE p.repo_id = $2 AND p.prize IN (SELECT jsonb_array_elements_text(c.devpost_tags))`,
      [challengeId, repoId],
    );
    if (entrant.rowCount === 0) {
      throw new BadRequestError("Repo is not entered in this challenge", { challengeId, repoId });
    }

    const before = await client.query(
      `SELECT rank, repo_id FROM challenge_winners WHERE challenge_id = $1 AND (rank = $2 OR repo_id = $3)`,
      [challengeId, rank, repoId],
    );

    await client.query(
      `DELETE FROM challenge_winners WHERE challenge_id = $1 AND (rank = $2 OR repo_id = $3)`,
      [challengeId, rank, repoId],
    );
    const { rows } = await client.query(
      `INSERT INTO challenge_winners (challenge_id, rank, repo_id, set_by)
       VALUES ($1, $2, $3, $4)
       RETURNING rank, repo_id, set_by, updated_at`,
      [challengeId, rank, repoId, actorId],
    );

    await audit(client, {
      actorId,
      entityType: "challenge_winner",
      entityId: challengeId,
      action: "set",
      before: before.rows,
      after: { rank, repoId },
    });

    const repoName = (await client.query(`SELECT name FROM repos WHERE id = $1`, [repoId])).rows[0]
      .name;
    return {
      rank: rows[0].rank,
      repoId: rows[0].repo_id,
      repoName,
      setBy: rows[0].set_by,
      updatedAt: rows[0].updated_at.toISOString(),
    };
  });
}

export async function removeChallengeWinner(
  actorId: number,
  challengeId: number,
  rank: number,
): Promise<void> {
  await withTransaction(async (client) => {
    const existing = await client.query(
      `DELETE FROM challenge_winners WHERE challenge_id = $1 AND rank = $2 RETURNING repo_id`,
      [challengeId, rank],
    );
    if (existing.rowCount === 0) {
      throw new NotFoundError("No winner set at this rank", { challengeId, rank });
    }
    await audit(client, {
      actorId,
      entityType: "challenge_winner",
      entityId: challengeId,
      action: "remove",
      before: { rank, repoId: existing.rows[0].repo_id },
    });
  });
}
