import type { Queryable } from "../../db/pool.js";

/**
 * Queue ordering helpers (plan/07 §4). `queue_entries.position` is a plain
 * sortable integer; ties (e.g. two rows pushed to the same "top" batch) are
 * broken by `id` (insertion order) at read time, so we never need to
 * renumber the whole queue — pushing to the top/bottom is just "one less
 * than the current min" / "one more than the current max".
 */

export type RequeuePosition = "top" | "bottom";

async function currentBounds(
  client: Queryable,
  challengeId: number,
): Promise<{ min: number; max: number }> {
  const { rows } = await client.query(
    `SELECT COALESCE(MIN(position), 0) AS min, COALESCE(MAX(position), 0) AS max
     FROM queue_entries WHERE challenge_id = $1`,
    [challengeId],
  );
  return { min: Number(rows[0].min), max: Number(rows[0].max) };
}

/** Position that sorts above every existing entry of the challenge's queue. */
export async function nextTopPosition(client: Queryable, challengeId: number): Promise<number> {
  const { min } = await currentBounds(client, challengeId);
  return min - 1;
}

/** Position that sorts below every existing entry of the challenge's queue. */
export async function nextBottomPosition(client: Queryable, challengeId: number): Promise<number> {
  const { max } = await currentBounds(client, challengeId);
  return max + 1;
}

/**
 * Assign top-of-queue positions to several entries at once while preserving
 * their *relative* arrival order (plan/07 §4: "el que más tiempo lleve en
 * called se pone al tope"). `orderedIds` must already be sorted so the entry
 * that should end up topmost is first.
 */
export async function assignTopPositionsBatch(
  client: Queryable,
  challengeId: number,
  orderedIds: number[],
): Promise<void> {
  if (orderedIds.length === 0) return;
  const { min } = await currentBounds(client, challengeId);
  const base = min - orderedIds.length;
  for (let i = 0; i < orderedIds.length; i++) {
    await client.query(`UPDATE queue_entries SET position = $1 WHERE id = $2`, [
      base + i,
      orderedIds[i],
    ]);
  }
}

/** Rebuilds active positions for a challenge so gaps close after removals. */
export async function compactChallengePositions(
  client: Queryable,
  challengeId: number,
): Promise<void> {
  const { rows } = await client.query(
    `SELECT id
       FROM queue_entries
      WHERE challenge_id = $1 AND status IN ('waiting', 'called')
      ORDER BY position ASC NULLS LAST, id ASC`,
    [challengeId],
  );
  for (let i = 0; i < rows.length; i++) {
    await client.query(`UPDATE queue_entries SET position = $1 WHERE id = $2`, [i + 1, rows[i].id]);
  }
}

export function resolveRequeuePosition(
  client: Queryable,
  challengeId: number,
  position: RequeuePosition,
): Promise<number> {
  return position === "top"
    ? nextTopPosition(client, challengeId)
    : nextBottomPosition(client, challengeId);
}
