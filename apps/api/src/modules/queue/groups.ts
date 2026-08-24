import { pool, type Queryable } from "../../db/pool.js";

/**
 * Queue-group routing helpers (H46). A room is linked to one `queue_groups`
 * row (`room_queue_groups`), and a group gathers 1..N of one enterprise's
 * challenges (`queue_group_challenges`). Every join that used to read
 * `room_challenges.challenge_id` directly now takes the two hops through here.
 *
 * Today every group is 1:1 with a challenge (0410's backfill + trigger), so
 * every helper below returns exactly what the old single-challenge lookup did.
 * They are written for the N>1 case regardless, because the merge UI that
 * creates shared groups is the next step.
 */

/**
 * Every challenge sharing a queue_group with `$1`, always including `$1`
 * itself. The `UNION` self-row is a safety net, not decoration: a challenge
 * with no group row (impossible today, but only because of a trigger) must
 * still order and read as its own single-challenge queue rather than silently
 * resolving to the empty set.
 */
export const GROUP_SIBLING_CHALLENGE_IDS_SQL = `
  SELECT sibling.challenge_id
    FROM queue_group_challenges self
    JOIN queue_group_challenges sibling ON sibling.queue_group_id = self.queue_group_id
   WHERE self.challenge_id = $1
   UNION
  SELECT $1::int`;

/** Every challenge the room currently serves, via its queue_group. */
export const ROOM_CHALLENGE_IDS_SQL = `
  SELECT qgc.challenge_id
    FROM room_queue_groups rqg
    JOIN queue_group_challenges qgc ON qgc.queue_group_id = rqg.queue_group_id
   WHERE rqg.room_id = $1`;

/** Every room currently serving the queue_group that `$1` belongs to. */
export const CHALLENGE_ROOM_IDS_SQL = `
  SELECT rqg.room_id
    FROM queue_group_challenges self
    JOIN room_queue_groups rqg ON rqg.queue_group_id = self.queue_group_id
   WHERE self.challenge_id = $1`;

export async function roomChallengeIds(client: Queryable, roomId: number): Promise<number[]> {
  const { rows } = await client.query(`${ROOM_CHALLENGE_IDS_SQL} ORDER BY qgc.challenge_id ASC`, [
    roomId,
  ]);
  return rows.map((row: { challenge_id: number }) => Number(row.challenge_id));
}

/** The queue_group a challenge feeds. Never null in practice (0410's trigger). */
export async function challengeQueueGroupId(
  client: Queryable,
  challengeId: number,
): Promise<number | null> {
  const { rows } = await client.query(
    `SELECT queue_group_id FROM queue_group_challenges WHERE challenge_id = $1`,
    [challengeId],
  );
  return rows[0] ? Number(rows[0].queue_group_id) : null;
}

/** The queue_group a room serves, or null when the room is unassigned. */
export async function roomQueueGroupId(client: Queryable, roomId: number): Promise<number | null> {
  const { rows } = await client.query(
    `SELECT queue_group_id FROM room_queue_groups WHERE room_id = $1`,
    [roomId],
  );
  return rows[0] ? Number(rows[0].queue_group_id) : null;
}

/** The enterprise a queue_group belongs to (groups never span enterprises). */
export async function queueGroupEnterpriseId(
  client: Queryable,
  queueGroupId: number,
): Promise<number | null> {
  const { rows } = await client.query(`SELECT enterprise_id FROM queue_groups WHERE id = $1`, [
    queueGroupId,
  ]);
  return rows[0] ? Number(rows[0].enterprise_id) : null;
}

/** The enterprise a room currently judges for, or null when unassigned. */
export async function roomEnterpriseId(client: Queryable, roomId: number): Promise<number | null> {
  const { rows } = await client.query(
    `SELECT qg.enterprise_id
       FROM room_queue_groups rqg
       JOIN queue_groups qg ON qg.id = rqg.queue_group_id
      WHERE rqg.room_id = $1`,
    [roomId],
  );
  return rows[0] ? Number(rows[0].enterprise_id) : null;
}

/**
 * The single challenge a room serves, for the read surfaces that still label
 * a room with one challenge (the judging panel's read-only header, the pace
 * ceiling). Picks the lowest challenge id in the group, which is the room's
 * only challenge for every group that exists today.
 *
 * N>1 revisit: once the merge UI ships, a shared-group room has no single
 * challenge, and these surfaces should show `queue_groups.display_name` and
 * the group's aggregate limits instead of one member challenge's.
 */
export async function roomPrimaryChallengeId(roomId: number): Promise<number | null> {
  const { rows } = await pool.query(`${ROOM_CHALLENGE_IDS_SQL} ORDER BY qgc.challenge_id ASC`, [
    roomId,
  ]);
  return rows[0] ? Number(rows[0].challenge_id) : null;
}
