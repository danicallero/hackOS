import { pool } from "../../src/db/pool.js";

/** challenges.author needs a sponsor -> enterprise chain owned by `ownerUserId`. */
export async function createSponsor(ownerUserId: number): Promise<number> {
  const enterprise = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
    `ent-${crypto.randomUUID()}`,
  ]);
  const sponsor = await pool.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
    [enterprise.rows[0].id, ownerUserId],
  );
  return sponsor.rows[0].id;
}

export async function createOwnedChallenge(ownerUserId: number, title: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO challenges (author, title) VALUES ($1, $2) RETURNING id`,
    [await createSponsor(ownerUserId), title],
  );
  return rows[0].id;
}

/** A repo with a completed queue entry for `challengeId`. */
export async function createEntrant(challengeId: number, repoName: string): Promise<number> {
  const repo = await pool.query(`INSERT INTO repos (name) VALUES ($1) RETURNING id`, [repoName]);
  await pool.query(
    `INSERT INTO queue_entries (challenge_id, repo_id, status) VALUES ($1, $2, 'completed')`,
    [challengeId, repo.rows[0].id],
  );
  return repo.rows[0].id;
}

export async function groupOf(challengeId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT queue_group_id FROM queue_group_challenges WHERE challenge_id = $1`,
    [challengeId],
  );
  return rows[0].queue_group_id;
}
