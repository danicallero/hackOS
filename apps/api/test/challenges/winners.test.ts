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
