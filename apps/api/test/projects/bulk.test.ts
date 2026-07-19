import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { asUser, buildTestApp, createUserWithCapabilities, truncateAll } from "../helpers.js";
import { createChallenge } from "./fixtures.js";

/** H21: bulk enroll/withdraw every project on a challenge, idempotently. */

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

async function createRepo(name: string): Promise<number> {
  const { rows } = await pool.query(`INSERT INTO repos (name) VALUES ($1) RETURNING id`, [name]);
  return rows[0].id;
}

describe("POST /api/challenges/:challengeId/repos/bulk-add|bulk-remove (H21)", () => {
  it("enrolls every repo, skipping ones already actively queued, idempotently", async () => {
    const server = await getApp();
    const challengeId = await createChallenge("Bulk Challenge", []);
    const repoA = await createRepo("Repo A");
    const repoB = await createRepo("Repo B");
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT]);

    // Repo A is already enrolled before the bulk call.
    await server.inject({
      method: "POST",
      url: `/api/repos/${repoA}/challenges`,
      headers: asUser(operator),
      payload: { challengeId },
    });

    const bulk = await server.inject({
      method: "POST",
      url: `/api/challenges/${challengeId}/repos/bulk-add`,
      headers: asUser(operator),
    });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json()).toEqual({ total: 2, added: 1, alreadyEnrolled: 1 });

    const entries = await pool.query(
      `SELECT repo_id, status FROM queue_entries WHERE challenge_id = $1`,
      [challengeId],
    );
    expect(entries.rows).toHaveLength(2);
    expect(entries.rows.every((r: { status: string }) => r.status === "waiting")).toBe(true);

    // Calling again is a full no-op: no duplicates, nothing newly added.
    const again = await server.inject({
      method: "POST",
      url: `/api/challenges/${challengeId}/repos/bulk-add`,
      headers: asUser(operator),
    });
    expect(again.json()).toEqual({ total: 2, added: 0, alreadyEnrolled: 2 });
    const stillTwo = await pool.query(`SELECT id FROM queue_entries WHERE challenge_id = $1`, [
      challengeId,
    ]);
    expect(stillTwo.rows).toHaveLength(2);

    void repoB;
  });

  it("404s for a nonexistent challenge", async () => {
    const server = await getApp();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT]);
    const res = await server.inject({
      method: "POST",
      url: "/api/challenges/999999/repos/bulk-add",
      headers: asUser(operator),
    });
    expect(res.statusCode).toBe(404);
  });

  it("bulk-removes every active entry, disqualifying in-progress ones instead of just cancelling", async () => {
    const server = await getApp();
    const challengeId = await createChallenge("Bulk Challenge", []);
    const repoA = await createRepo("Repo A");
    const repoB = await createRepo("Repo B");
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT]);

    await server.inject({
      method: "POST",
      url: `/api/challenges/${challengeId}/repos/bulk-add`,
      headers: asUser(operator),
    });
    // Simulate repoB being mid-presentation when the operator bulk-removes.
    await pool.query(
      `UPDATE queue_entries SET status = 'in_room' WHERE challenge_id = $1 AND repo_id = $2`,
      [challengeId, repoB],
    );

    const bulk = await server.inject({
      method: "POST",
      url: `/api/challenges/${challengeId}/repos/bulk-remove`,
      headers: asUser(operator),
    });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json()).toEqual({ total: 2, removed: 2, alreadySkipped: 0 });

    const entries = await pool.query(
      `SELECT repo_id, status FROM queue_entries WHERE challenge_id = $1 ORDER BY repo_id`,
      [challengeId],
    );
    const byRepo = Object.fromEntries(
      entries.rows.map((r: { repo_id: number; status: string }) => [r.repo_id, r.status]),
    );
    expect(byRepo[repoA]).toBe("cancelled");
    expect(byRepo[repoB]).toBe("disqualified");

    // Calling again is a no-op — both entries are already terminal.
    const again = await server.inject({
      method: "POST",
      url: `/api/challenges/${challengeId}/repos/bulk-remove`,
      headers: asUser(operator),
    });
    expect(again.json()).toEqual({ total: 2, removed: 0, alreadySkipped: 2 });
  });

  it("requires PROJECTS_EDIT", async () => {
    const server = await getApp();
    const challengeId = await createChallenge("Bulk Challenge", []);
    const bystander = await createUserWithCapabilities([]);
    const res = await server.inject({
      method: "POST",
      url: `/api/challenges/${challengeId}/repos/bulk-add`,
      headers: asUser(bystander),
    });
    expect(res.statusCode).toBe(403);
  });
});
