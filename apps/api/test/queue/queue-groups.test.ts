import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { createUser, truncateAll } from "../helpers.js";

/**
 * Queue groups (H46): the enterprise-scoped grouping layer rooms and judging
 * queues attach to instead of a bare challenge_id. Nothing reads these tables
 * yet — these tests pin the schema invariants the follow-up routing PR relies
 * on: exactly one group per challenge, and a group never spanning enterprises.
 */

async function createEnterprise(): Promise<{ enterpriseId: number; sponsorId: number }> {
  const userId = await createUser();
  const { rows } = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
    `ent-${crypto.randomUUID()}`,
  ]);
  const sponsor = await pool.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
    [rows[0].id, userId],
  );
  return { enterpriseId: rows[0].id, sponsorId: sponsor.rows[0].id };
}

async function createChallengeFor(sponsorId: number, title: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO challenges (author, title) VALUES ($1, $2) RETURNING id`,
    [sponsorId, title],
  );
  return rows[0].id;
}

async function groupOf(challengeId: number) {
  const { rows } = await pool.query(
    `SELECT qg.id, qg.enterprise_id, qg.display_name
       FROM queue_group_challenges qgc
       JOIN queue_groups qg ON qg.id = qgc.queue_group_id
      WHERE qgc.challenge_id = $1`,
    [challengeId],
  );
  return rows;
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await pool.end();
});

describe("queue_groups auto-fill (H46)", () => {
  it("gives every new challenge exactly one 1:1 group named after it", async () => {
    const { enterpriseId, sponsorId } = await createEnterprise();
    const challengeId = await createChallengeFor(sponsorId, "Best Use of Widgets");

    const groups = await groupOf(challengeId);
    expect(groups).toHaveLength(1);
    expect(groups[0].enterprise_id).toBe(enterpriseId);
    expect(groups[0].display_name).toBe("Best Use of Widgets");
  });

  it("gives an enterprise with several challenges one group each, not one shared group", async () => {
    const { sponsorId } = await createEnterprise();
    const a = await createChallengeFor(sponsorId, "A");
    const b = await createChallengeFor(sponsorId, "B");

    const [groupA] = await groupOf(a);
    const [groupB] = await groupOf(b);
    expect(groupA.id).not.toBe(groupB.id);

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM queue_groups`);
    expect(rows[0].n).toBe(2);
  });

  it("keeps a challenge in at most one group", async () => {
    const { enterpriseId, sponsorId } = await createEnterprise();
    const challengeId = await createChallengeFor(sponsorId, "A");
    const other = await pool.query(
      `INSERT INTO queue_groups (enterprise_id, display_name) VALUES ($1, 'Shared') RETURNING id`,
      [enterpriseId],
    );

    await expect(
      pool.query(
        `INSERT INTO queue_group_challenges (queue_group_id, challenge_id) VALUES ($1,$2)`,
        [other.rows[0].id, challengeId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("deleting a group releases its challenges", async () => {
    const { sponsorId } = await createEnterprise();
    const challengeId = await createChallengeFor(sponsorId, "A");
    const [group] = await groupOf(challengeId);

    await pool.query(`DELETE FROM queue_groups WHERE id = $1`, [group.id]);
    expect(await groupOf(challengeId)).toHaveLength(0);
  });
});

describe("queue_groups enterprise boundary (H46)", () => {
  it("rejects a challenge owned by a different enterprise", async () => {
    const acme = await createEnterprise();
    const beta = await createEnterprise();
    const betaChallenge = await createChallengeFor(beta.sponsorId, "Beta challenge");
    await pool.query(`DELETE FROM queue_group_challenges WHERE challenge_id = $1`, [betaChallenge]);
    const acmeGroup = await pool.query(
      `INSERT INTO queue_groups (enterprise_id, display_name) VALUES ($1, 'ACME') RETURNING id`,
      [acme.enterpriseId],
    );

    await expect(
      pool.query(
        `INSERT INTO queue_group_challenges (queue_group_id, challenge_id) VALUES ($1,$2)`,
        [acmeGroup.rows[0].id, betaChallenge],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("accepts several challenges of the same enterprise in one shared group", async () => {
    const { enterpriseId, sponsorId } = await createEnterprise();
    const a = await createChallengeFor(sponsorId, "A");
    const b = await createChallengeFor(sponsorId, "B");
    await pool.query(`DELETE FROM queue_group_challenges WHERE challenge_id = ANY($1)`, [[a, b]]);
    const shared = await pool.query(
      `INSERT INTO queue_groups (enterprise_id, display_name) VALUES ($1, 'Shared') RETURNING id`,
      [enterpriseId],
    );

    await pool.query(
      `INSERT INTO queue_group_challenges (queue_group_id, challenge_id)
       VALUES ($1, $2), ($1, $3)`,
      [shared.rows[0].id, a, b],
    );

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM queue_group_challenges WHERE queue_group_id = $1`,
      [shared.rows[0].id],
    );
    expect(rows[0].n).toBe(2);
  });

  it("rejects moving a non-empty group to another enterprise", async () => {
    const acme = await createEnterprise();
    const beta = await createEnterprise();
    const challengeId = await createChallengeFor(acme.sponsorId, "A");
    const [group] = await groupOf(challengeId);

    await expect(
      pool.query(`UPDATE queue_groups SET enterprise_id = $1 WHERE id = $2`, [
        beta.enterpriseId,
        group.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
