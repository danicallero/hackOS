import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

/** H46: internal winner ranking — admin/owning-sponsor only, open-ended placements. */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function getApp(): Promise<App> {
  if (!app) app = await buildTestApp();
  return app;
}

async function createOwnedChallenge(ownerUserId: number): Promise<number> {
  const enterprise = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
    `ent-${crypto.randomUUID()}`,
  ]);
  const sponsor = await pool.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
    [enterprise.rows[0].id, ownerUserId],
  );
  const challenge = await pool.query(
    `INSERT INTO challenges (author, title) VALUES ($1, 'Judged Challenge') RETURNING id`,
    [sponsor.rows[0].id],
  );
  return challenge.rows[0].id;
}

async function createEntrant(challengeId: number, repoName: string): Promise<number> {
  const repo = await pool.query(`INSERT INTO repos (name) VALUES ($1) RETURNING id`, [repoName]);
  await pool.query(
    `INSERT INTO queue_entries (challenge_id, repo_id, status) VALUES ($1, $2, 'completed')`,
    [challengeId, repo.rows[0].id],
  );
  return repo.rows[0].id;
}

/**
 * Two challenges of the SAME enterprise — the only shape 0410's guard trigger
 * lets share a queue group.
 */
async function createSiblingChallenges(ownerUserId: number): Promise<[number, number]> {
  const enterprise = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
    `ent-${crypto.randomUUID()}`,
  ]);
  const sponsor = await pool.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
    [enterprise.rows[0].id, ownerUserId],
  );
  const { rows } = await pool.query(
    `INSERT INTO challenges (author, title)
     VALUES ($1, 'Sibling A'), ($1, 'Sibling B')
     RETURNING id`,
    [sponsor.rows[0].id],
  );
  return [rows[0].id, rows[1].id];
}

async function groupOf(challengeId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT queue_group_id FROM queue_group_challenges WHERE challenge_id = $1`,
    [challengeId],
  );
  return rows[0].queue_group_id;
}

/**
 * Moves `challengeId` into `targetChallengeId`'s queue group, simulating the
 * admin "merge these challenges into one shared queue" action that PR3 of the
 * room/judging redesign will ship. Done in raw SQL because no service or route
 * creates a multi-challenge group yet (0410 only auto-fills 1:1 groups).
 */
async function mergeIntoGroup(challengeId: number, targetChallengeId: number): Promise<void> {
  const orphan = await groupOf(challengeId);
  const target = await groupOf(targetChallengeId);
  await pool.query(`DELETE FROM queue_group_challenges WHERE challenge_id = $1`, [challengeId]);
  await pool.query(`DELETE FROM queue_groups WHERE id = $1`, [orphan]);
  await pool.query(
    `INSERT INTO queue_group_challenges (queue_group_id, challenge_id) VALUES ($1, $2)`,
    [target, challengeId],
  );
}

describe("challenge winners (H46)", () => {
  it("lets the owning sponsor and admins set, replace and remove winners", async () => {
    const server = await getApp();
    const owner = await createUser();
    const challengeId = await createOwnedChallenge(owner);
    const repoA = await createEntrant(challengeId, "Team A");
    const repoB = await createEntrant(challengeId, "Team B");

    const setFirst = await server.inject({
      method: "PUT",
      url: `/api/challenges/${challengeId}/winners/1`,
      headers: asUser(owner),
      payload: { repoId: repoA },
    });
    expect(setFirst.statusCode).toBe(200);
    expect(setFirst.json()).toMatchObject({ rank: 1, repoId: repoA, repoName: "Team A" });

    const admin = await createUserWithCapabilities([CAPABILITIES.QUEUE_ADMIN]);
    const setSpecial = await server.inject({
      method: "PUT",
      url: `/api/challenges/${challengeId}/winners/4`,
      headers: asUser(admin),
      payload: { repoId: repoB },
    });
    expect(setSpecial.statusCode).toBe(200);
    expect(setSpecial.json().rank).toBe(4);

    const list = await server.inject({
      method: "GET",
      url: `/api/challenges/${challengeId}/winners`,
      headers: asUser(owner),
    });
    expect(list.json().winners).toHaveLength(2);
    expect(list.json().winners.map((w: { rank: number }) => w.rank)).toEqual([1, 4]);

    // Replacing rank 1 clears the old occupant entirely (no auto-bump).
    const replace = await server.inject({
      method: "PUT",
      url: `/api/challenges/${challengeId}/winners/1`,
      headers: asUser(owner),
      payload: { repoId: repoB },
    });
    expect(replace.statusCode).toBe(200);
    const afterReplace = await server.inject({
      method: "GET",
      url: `/api/challenges/${challengeId}/winners`,
      headers: asUser(owner),
    });
    // repoB now only holds rank 1 (its old rank-4 slot was cleared since a
    // repo can't hold two placements at once).
    expect(afterReplace.json().winners).toEqual([
      expect.objectContaining({ rank: 1, repoId: repoB }),
    ]);

    const remove = await server.inject({
      method: "DELETE",
      url: `/api/challenges/${challengeId}/winners/1`,
      headers: asUser(owner),
    });
    expect(remove.statusCode).toBe(200);
    const afterRemove = await server.inject({
      method: "GET",
      url: `/api/challenges/${challengeId}/winners`,
      headers: asUser(owner),
    });
    expect(afterRemove.json().winners).toEqual([]);
  });

  it("lets a repo entered only via devpost prize mapping be set as winner (queue opt-out, H46)", async () => {
    const server = await getApp();
    const owner = await createUser();
    const enterprise = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
      `ent-${crypto.randomUUID()}`,
    ]);
    const sponsor = await pool.query(
      `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
      [enterprise.rows[0].id, owner],
    );
    const challenge = await pool.query(
      `INSERT INTO challenges (author, title, devpost_tags) VALUES ($1, 'Devpost-only Challenge', $2) RETURNING id`,
      [sponsor.rows[0].id, JSON.stringify(["Best Use of X"])],
    );
    const challengeId = challenge.rows[0].id;
    const repo = await pool.query(`INSERT INTO repos (name) VALUES ('Devpost Team') RETURNING id`);
    await pool.query(`INSERT INTO repo_devpost_prizes (repo_id, prize) VALUES ($1, $2)`, [
      repo.rows[0].id,
      "Best Use of X",
    ]);

    const res = await server.inject({
      method: "PUT",
      url: `/api/challenges/${challengeId}/winners/1`,
      headers: asUser(owner),
      payload: { repoId: repo.rows[0].id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ rank: 1, repoId: repo.rows[0].id });
  });

  it("rejects a repo that never entered the challenge", async () => {
    const server = await getApp();
    const owner = await createUser();
    const challengeId = await createOwnedChallenge(owner);
    const otherRepo = await pool.query(`INSERT INTO repos (name) VALUES ('Ghost') RETURNING id`);

    const res = await server.inject({
      method: "PUT",
      url: `/api/challenges/${challengeId}/winners/1`,
      headers: asUser(owner),
      payload: { repoId: otherRepo.rows[0].id },
    });
    expect(res.statusCode).toBe(400);
  });

  it("keeps 1:1 queue groups scoped to their own challenge (draft §5)", async () => {
    const server = await getApp();
    const owner = await createUser();
    const [challengeA, challengeB] = await createSiblingChallenges(owner);
    // Every challenge gets its own 1:1 group from 0410's trigger, so entering
    // A must not make the repo eligible for the unrelated challenge B.
    expect(await groupOf(challengeA)).not.toBe(await groupOf(challengeB));
    const repo = await createEntrant(challengeA, "Only In A");

    const inA = await server.inject({
      method: "PUT",
      url: `/api/challenges/${challengeA}/winners/1`,
      headers: asUser(owner),
      payload: { repoId: repo },
    });
    expect(inA.statusCode).toBe(200);

    const inB = await server.inject({
      method: "PUT",
      url: `/api/challenges/${challengeB}/winners/1`,
      headers: asUser(owner),
      payload: { repoId: repo },
    });
    expect(inB.statusCode).toBe(400);
  });

  it("lets a repo judged through a shared queue group win a sibling challenge (draft §5)", async () => {
    const server = await getApp();
    const owner = await createUser();
    const [challengeA, challengeB] = await createSiblingChallenges(owner);
    await mergeIntoGroup(challengeB, challengeA);
    // Entered only in B, but B shares A's queue group, so A's sponsor can
    // still award it — the win is recorded against A.
    const repo = await createEntrant(challengeB, "Shared Queue Team");

    const res = await server.inject({
      method: "PUT",
      url: `/api/challenges/${challengeA}/winners/1`,
      headers: asUser(owner),
      payload: { repoId: repo },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ rank: 1, repoId: repo });

    const stored = await pool.query(
      `SELECT challenge_id FROM challenge_winners WHERE repo_id = $1`,
      [repo],
    );
    expect(stored.rows).toEqual([{ challenge_id: challengeA }]);
  });

  it("still rejects a repo absent from every challenge in the group (draft §5)", async () => {
    const server = await getApp();
    const owner = await createUser();
    const [challengeA, challengeB] = await createSiblingChallenges(owner);
    await mergeIntoGroup(challengeB, challengeA);
    const outsider = await createOwnedChallenge(owner);
    const repo = await createEntrant(outsider, "Outsider");

    const res = await server.inject({
      method: "PUT",
      url: `/api/challenges/${challengeA}/winners/1`,
      headers: asUser(owner),
      payload: { repoId: repo },
    });
    expect(res.statusCode).toBe(400);
  });

  it("403s for a sponsor of a different challenge, and for judges/participants", async () => {
    const server = await getApp();
    const owner = await createUser();
    const challengeId = await createOwnedChallenge(owner);
    const repoA = await createEntrant(challengeId, "Team A");

    const otherOwner = await createUser();
    await createOwnedChallenge(otherOwner);
    const forbidden = await server.inject({
      method: "PUT",
      url: `/api/challenges/${challengeId}/winners/1`,
      headers: asUser(otherOwner),
      payload: { repoId: repoA },
    });
    expect(forbidden.statusCode).toBe(403);

    const bystander = await createUser();
    const bystanderRes = await server.inject({
      method: "GET",
      url: `/api/challenges/${challengeId}/winners`,
      headers: asUser(bystander),
    });
    expect(bystanderRes.statusCode).toBe(403);
  });
});
