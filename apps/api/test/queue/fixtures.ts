import { pool } from "../../src/db/pool.js";
import { createUser } from "../helpers.js";

/** Queue-suite fixtures (WS-B2). Direct SQL inserts — other modules' routes are out of scope. */

export async function createChallenge(
  overrides: Partial<{
    title: string;
    judgingPanelCriteria: unknown;
    devpostTags: string[];
  }> = {},
): Promise<number> {
  const ownerId = await createUser();
  const enterprise = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
    `ent-${crypto.randomUUID()}`,
  ]);
  const sponsor = await pool.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
    [enterprise.rows[0].id, ownerId],
  );
  const { rows } = await pool.query(
    `INSERT INTO challenges (author, title, judging_panel_criteria, devpost_tags)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      sponsor.rows[0].id,
      overrides.title ?? `Challenge ${crypto.randomUUID().slice(0, 8)}`,
      overrides.judgingPanelCriteria ? JSON.stringify(overrides.judgingPanelCriteria) : null,
      JSON.stringify(overrides.devpostTags ?? []),
    ],
  );
  return rows[0].id;
}

/**
 * Several challenges authored by ONE enterprise — the only shape a shared
 * queue group can legally take (0410's cross-enterprise guard).
 */
export async function createEnterpriseChallenges(
  count: number,
  /** Per-challenge judging panels, index-aligned; omit for panel-less challenges. */
  panels: unknown[][] = [],
): Promise<{ enterpriseId: number; repId: number; challengeIds: number[] }> {
  const repId = await createUser();
  const enterprise = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
    `ent-${crypto.randomUUID()}`,
  ]);
  const enterpriseId = Number(enterprise.rows[0].id);
  const sponsor = await pool.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
    [enterpriseId, repId],
  );
  const challengeIds: number[] = [];
  for (let i = 0; i < count; i++) {
    const { rows } = await pool.query(
      `INSERT INTO challenges (author, title, devpost_tags, judging_panel_criteria)
       VALUES ($1, $2, '[]'::jsonb, $3) RETURNING id`,
      [
        sponsor.rows[0].id,
        `Challenge ${i + 1} ${crypto.randomUUID().slice(0, 8)}`,
        panels[i] ? JSON.stringify(panels[i]) : null,
      ],
    );
    challengeIds.push(Number(rows[0].id));
  }
  return { enterpriseId, repId, challengeIds };
}

export async function createRoom(
  overrides: Partial<{
    name: string;
    status: string;
    isPaused: boolean;
    maxInWaitingArea: number;
    desiredMinutesPerTeam: number;
  }> = {},
): Promise<number> {
  const name = overrides.name ?? `Room ${crypto.randomUUID().slice(0, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO rooms (name, slug, status) VALUES ($1, $2, $3) RETURNING id`,
    [name, `room-${crypto.randomUUID()}`, overrides.status ?? "active"],
  );
  const roomId = rows[0].id;
  await pool.query(
    `INSERT INTO room_queue_state (room_id, is_paused, max_in_waiting_area, desired_minutes_per_team)
     VALUES ($1, $2, $3, $4)`,
    [
      roomId,
      overrides.isPaused ?? false,
      overrides.maxInWaitingArea ?? 2,
      overrides.desiredMinutesPerTeam ?? 8,
    ],
  );
  return roomId;
}

/**
 * Point a room at the queue group the challenge feeds — the room->challenge
 * link now goes through `room_queue_groups`. Every challenge has exactly one
 * group (0410), so this remains "assign this challenge to this room". Also
 * pools the room into the challenge's enterprise (`room_enterprises`, 0413):
 * a room may only serve a queue_group belonging to the enterprise it is
 * pooled into, enforced by `room_queue_groups_enterprise_guard`.
 */
export async function assignChallengeToRoom(roomId: number, challengeId: number): Promise<void> {
  await pool.query(
    `INSERT INTO room_enterprises (room_id, enterprise_id)
     SELECT $1, qg.enterprise_id
       FROM queue_group_challenges qgc
       JOIN queue_groups qg ON qg.id = qgc.queue_group_id
      WHERE qgc.challenge_id = $2
     ON CONFLICT (room_id) DO UPDATE SET enterprise_id = EXCLUDED.enterprise_id`,
    [roomId, challengeId],
  );
  await pool.query(
    `INSERT INTO room_queue_groups (room_id, queue_group_id)
     SELECT $1, qgc.queue_group_id FROM queue_group_challenges qgc WHERE qgc.challenge_id = $2
     ON CONFLICT DO NOTHING`,
    [roomId, challengeId],
  );
}

/** The queue group a challenge feeds — its own 1:1 group unless merged. */
export async function queueGroupOf(challengeId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT queue_group_id FROM queue_group_challenges WHERE challenge_id = $1`,
    [challengeId],
  );
  return Number(rows[0].queue_group_id);
}

/**
 * Assign a room directly to a queue group (for merged, N>1 group tests).
 * Pools the room into the group's enterprise first (0413's guard requires
 * it) unless `skipPooling` is set, for tests that specifically exercise the
 * guard by pooling the room elsewhere first.
 */
export async function assignQueueGroupToRoom(
  roomId: number,
  queueGroupId: number,
  options: { skipPooling?: boolean } = {},
): Promise<void> {
  if (!options.skipPooling) {
    await pool.query(
      `INSERT INTO room_enterprises (room_id, enterprise_id)
       SELECT $1, qg.enterprise_id FROM queue_groups qg WHERE qg.id = $2
       ON CONFLICT (room_id) DO UPDATE SET enterprise_id = EXCLUDED.enterprise_id`,
      [roomId, queueGroupId],
    );
  }
  await pool.query(
    `INSERT INTO room_queue_groups (room_id, queue_group_id) VALUES ($1, $2)
     ON CONFLICT (room_id) DO UPDATE SET queue_group_id = EXCLUDED.queue_group_id`,
    [roomId, queueGroupId],
  );
}

/** Pool a room into an enterprise (`room_enterprises`, 0413) without touching its serving queue. */
export async function poolRoomToEnterprise(roomId: number, enterpriseId: number): Promise<void> {
  await pool.query(
    `INSERT INTO room_enterprises (room_id, enterprise_id) VALUES ($1, $2)
     ON CONFLICT (room_id) DO UPDATE SET enterprise_id = EXCLUDED.enterprise_id`,
    [roomId, enterpriseId],
  );
}

/**
 * Merge `challengeIds` into the queue group of the first one, simulating the
 * admin merge UI that does not exist yet — the only way to build an N>1 group
 * today. Returns that group's id.
 */
export async function mergeChallengesIntoOneGroup(challengeIds: number[]): Promise<number> {
  const [primary, ...rest] = challengeIds;
  const { rows } = await pool.query(
    `SELECT queue_group_id FROM queue_group_challenges WHERE challenge_id = $1`,
    [primary],
  );
  const groupId = Number(rows[0].queue_group_id);
  for (const challengeId of rest) {
    await pool.query(
      `UPDATE queue_group_challenges SET queue_group_id = $1 WHERE challenge_id = $2`,
      [groupId, challengeId],
    );
  }
  return groupId;
}

/**
 * Put `userId` on the judge roster of the enterprise that authored
 * `challengeId` — the only way a judge is granted judging access now that
 * `enterprise_judges` replaced `room_judges`.
 */
export async function addChallengeJudge(challengeId: number, userId: number): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO enterprise_judges (enterprise_id, user_id)
     SELECT author.enterprise_id, $2
       FROM challenges c JOIN sponsors author ON author.id = c.author
      WHERE c.id = $1
     ON CONFLICT (enterprise_id, user_id) DO NOTHING
     RETURNING enterprise_id`,
    [challengeId, userId],
  );
  return rows[0]?.enterprise_id;
}

/** Repo + submissions rows for each member (creates users when not given). */
export async function createRepoWithTeam(
  memberIds?: number[],
  name?: string,
): Promise<{ repoId: number; memberIds: number[] }> {
  const members = memberIds ?? [await createUser()];
  const { rows } = await pool.query(`INSERT INTO repos (name) VALUES ($1) RETURNING id`, [
    name ?? `repo-${crypto.randomUUID().slice(0, 8)}`,
  ]);
  const repoId = rows[0].id;
  for (const userId of members) {
    await pool.query(`INSERT INTO submissions (repo_id, user_id) VALUES ($1, $2)`, [
      repoId,
      userId,
    ]);
  }
  return { repoId, memberIds: members };
}

/** Direct waiting entry, bypassing the enqueue endpoint. */
export async function enqueueRepo(
  challengeId: number,
  repoId: number,
  position: number,
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO queue_entries (challenge_id, repo_id, status, position)
     VALUES ($1, $2, 'waiting', $3) RETURNING id`,
    [challengeId, repoId, position],
  );
  return rows[0].id;
}

export async function getEntry(entryId: number) {
  const { rows } = await pool.query(`SELECT * FROM queue_entries WHERE id = $1`, [entryId]);
  return rows[0];
}

export async function roomRow(roomId: number) {
  const { rows } = await pool.query(`SELECT * FROM rooms WHERE id = $1`, [roomId]);
  return rows[0];
}

export async function historyRows(entryId: number, action?: string) {
  const { rows } = await pool.query(
    `SELECT * FROM queue_history WHERE queue_entry_id = $1 ${action ? "AND action = $2" : ""} ORDER BY id ASC`,
    action ? [entryId, action] : [entryId],
  );
  return rows;
}

/**
 * Broadcast counter: sse.ts INCRs `sse:seq:<topic>` once per broadcast, so
 * the counter delta == number of broadcasts on that topic (invariant 5).
 */
export async function broadcastCount(topic: string): Promise<number> {
  const { valkey } = await import("../../src/lib/valkey.js");
  const v = await valkey.get(`sse:seq:${topic}`);
  return v ? Number(v) : 0;
}
