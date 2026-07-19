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

    const entrant = await client.query(
      `SELECT 1 FROM queue_entries WHERE challenge_id = $1 AND repo_id = $2`,
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
