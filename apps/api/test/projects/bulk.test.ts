import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { asUser, createUserWithCapabilities, useTestApp } from "../helpers.js";
import { createChallenge } from "./fixtures.js";

/** H21: bulk enroll/withdraw every project on a challenge, idempotently. */

const getApp = useTestApp();

async function createRepo(name: string): Promise<number> {
  const { rows } = await pool.query(`INSERT INTO repos (name) VALUES ($1) RETURNING id`, [name]);
  return rows[0].id;
}

describe("POST /api/challenges/:challengeId/repos/bulk-add|bulk-remove (H21)", () => {
  it("enrolls every repo, skipping ones already actively queued, idempotently", async () => {
    const server = await getApp();
    const challengeId = await createChallenge("Bulk Challenge");
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
    const challengeId = await createChallenge("Bulk Challenge");
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
    const challengeId = await createChallenge("Bulk Challenge");
    const bystander = await createUserWithCapabilities([]);
    const res = await server.inject({
      method: "POST",
      url: `/api/challenges/${challengeId}/repos/bulk-add`,
      headers: asUser(bystander),
    });
    expect(res.statusCode).toBe(403);
  });

  it("writes one history row and one audit row per entry, revives terminal entries at the bottom, and survives concurrent calls", async () => {
    const server = await getApp();
    const challengeId = await createChallenge("Bulk Challenge");
    const repoA = await createRepo("Repo A");
    const repoB = await createRepo("Repo B");
    const repoC = await createRepo("Repo C");
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT]);
    const call = (action: "bulk-add" | "bulk-remove") =>
      server.inject({
        method: "POST",
        url: `/api/challenges/${challengeId}/repos/${action}`,
        headers: asUser(operator),
      });

    // Two simultaneous bulk-adds: exactly one entry per repo, no duplicates.
    const [first, second] = await Promise.all([call("bulk-add"), call("bulk-add")]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const queued = await pool.query(
      `SELECT repo_id, position FROM queue_entries WHERE challenge_id = $1 ORDER BY position`,
      [challengeId],
    );
    expect(queued.rows.map((r: { repo_id: number }) => r.repo_id)).toEqual([repoA, repoB, repoC]);
    expect(queued.rows.map((r: { position: number }) => r.position)).toEqual([1, 2, 3]);
    const enqueues = await pool.query(
      `SELECT count(*)::int AS n FROM queue_history WHERE action = 'enqueue'`,
    );
    expect(enqueues.rows[0].n).toBe(3);

    // Withdraw all: one history + one audit row per entry, positions cleared.
    expect((await call("bulk-remove")).json()).toEqual({ total: 3, removed: 3, alreadySkipped: 0 });
    const removals = await pool.query(
      `SELECT count(*)::int AS n FROM queue_history WHERE action = 'remove_from_challenge'`,
    );
    expect(removals.rows[0].n).toBe(3);
    const removeAudits = await pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'challenge_remove'`,
    );
    expect(removeAudits.rows[0].n).toBe(3);

    // Re-adding revives the cancelled entries (same rows) at the bottom, in repo order.
    expect((await call("bulk-add")).json()).toEqual({ total: 3, added: 3, alreadyEnrolled: 0 });
    const revived = await pool.query(
      `SELECT repo_id, status, position FROM queue_entries WHERE challenge_id = $1 ORDER BY position`,
      [challengeId],
    );
    expect(revived.rows).toEqual([
      { repo_id: repoA, status: "waiting", position: 1 },
      { repo_id: repoB, status: "waiting", position: 2 },
      { repo_id: repoC, status: "waiting", position: 3 },
    ]);
    const reEnters = await pool.query(
      `SELECT count(*)::int AS n FROM queue_history WHERE action = 're_enter'`,
    );
    expect(reEnters.rows[0].n).toBe(3);
  });
});
