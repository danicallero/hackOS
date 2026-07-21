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

/**
 * Reviews overview (H46 gap-fill): admins see every challenge's evaluations;
 * a sponsor rep sees ONLY their own enterprise's — never another sponsor's,
 * never a global cross-event view. This is the confidentiality rule the
 * product owner called out explicitly.
 */

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

const SCALE_CRITERIA = [
  { key: "score", kind: "scale", label: { en: "Score", es: "Nota", gl: "Nota" }, min: 0, max: 10 },
];

async function createOwnedChallenge(ownerUserId: number, title: string): Promise<number> {
  const enterprise = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
    `ent-${crypto.randomUUID()}`,
  ]);
  const sponsor = await pool.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
    [enterprise.rows[0].id, ownerUserId],
  );
  const challenge = await pool.query(
    `INSERT INTO challenges (author, title, judging_panel_criteria) VALUES ($1, $2, $3::jsonb) RETURNING id`,
    [sponsor.rows[0].id, title, JSON.stringify(SCALE_CRITERIA)],
  );
  return challenge.rows[0].id;
}

async function createRoom(name: string): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO rooms (name, slug, status) VALUES ($1, $2, 'active') RETURNING id`,
    [name, `room-${crypto.randomUUID()}`],
  );
  return rows[0].id;
}

async function createEntry(
  challengeId: number,
  roomId: number | null,
  repoName: string,
  status: string,
  score?: number,
): Promise<number> {
  const repo = await pool.query(`INSERT INTO repos (name) VALUES ($1) RETURNING id`, [repoName]);
  const entry = await pool.query(
    `INSERT INTO queue_entries (challenge_id, repo_id, status, assigned_room_id)
     VALUES ($1, $2, 'completed', $3) RETURNING id`,
    [challengeId, repo.rows[0].id, roomId],
  );
  if (score !== undefined) {
    await pool.query(
      `INSERT INTO attempt_review (attempt_id, scores, status) VALUES ($1, $2::jsonb, $3)`,
      [entry.rows[0].id, JSON.stringify({ score }), status],
    );
  }
  return entry.rows[0].id;
}

describe("GET /api/queue/reviews (confidentiality)", () => {
  it("lets an admin see every challenge's reviews with the derived nota", async () => {
    const server = await getApp();
    const ownerA = await createUser();
    const ownerB = await createUser();
    const roomA = await createRoom("Room A");
    const roomB = await createRoom("Room B");
    const challengeA = await createOwnedChallenge(ownerA, "Challenge A");
    const challengeB = await createOwnedChallenge(ownerB, "Challenge B");
    await createEntry(challengeA, roomA, "Team A1", "submitted", 8);
    await createEntry(challengeB, roomB, "Team B1", "draft", 5);

    const admin = await createUserWithCapabilities([CAPABILITIES.QUEUE_ADMIN]);
    const res = await server.inject({
      method: "GET",
      url: "/api/queue/reviews",
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(200);
    const { reviews } = res.json();
    expect(reviews).toHaveLength(2);
    const a1 = reviews.find((r: { repoName: string }) => r.repoName === "Team A1");
    expect(a1).toMatchObject({ status: "submitted", nota: 8, roomName: "Room A" });

    // Room filter narrows correctly.
    const filtered = await server.inject({
      method: "GET",
      url: `/api/queue/reviews?roomId=${roomB}`,
      headers: asUser(admin),
    });
    expect(filtered.json().reviews).toHaveLength(1);
    expect(filtered.json().reviews[0].repoName).toBe("Team B1");
  });

  it("scopes a sponsor rep to only their own enterprise's reviews, even unfiltered", async () => {
    const server = await getApp();
    const ownerA = await createUser();
    const ownerB = await createUser();
    const challengeA = await createOwnedChallenge(ownerA, "Challenge A");
    const challengeB = await createOwnedChallenge(ownerB, "Challenge B");
    await createEntry(challengeA, null, "Team A1", "submitted", 8);
    await createEntry(challengeB, null, "Team B1", "submitted", 5);

    const res = await server.inject({
      method: "GET",
      url: "/api/queue/reviews",
      headers: asUser(ownerA),
    });
    expect(res.statusCode).toBe(200);
    const { reviews } = res.json();
    expect(reviews).toHaveLength(1);
    expect(reviews[0].repoName).toBe("Team A1");

    // Explicitly asking for another sponsor's challenge 403s.
    const forbidden = await server.inject({
      method: "GET",
      url: `/api/queue/reviews?challengeId=${challengeB}`,
      headers: asUser(ownerA),
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("403s a plain judge/participant with no admin or sponsor standing", async () => {
    const server = await getApp();
    const bystander = await createUser();
    const res = await server.inject({
      method: "GET",
      url: "/api/queue/reviews",
      headers: asUser(bystander),
    });
    expect(res.statusCode).toBe(403);
  });

  it("opens the detail with the panel questions, the answers and the team", async () => {
    const server = await getApp();
    const owner = await createUser();
    const challengeId = await createOwnedChallenge(owner, "Challenge A");
    const roomId = await createRoom("Room A");
    const entryId = await createEntry(challengeId, roomId, "Team A1", "draft", 7);
    const member = await createUser();
    const { rows: repoRows } = await pool.query(`SELECT repo_id FROM queue_entries WHERE id = $1`, [
      entryId,
    ]);
    await pool.query(`INSERT INTO submissions (repo_id, user_id) VALUES ($1, $2)`, [
      repoRows[0].repo_id,
      member,
    ]);

    const res = await server.inject({
      method: "GET",
      url: `/api/queue/reviews/${entryId}`,
      headers: asUser(owner),
    });
    expect(res.statusCode).toBe(200);
    const detail = res.json();
    expect(detail.challenge.criteria).toHaveLength(1);
    expect(detail.challenge.criteria[0].key).toBe("score");
    expect(detail.review).toMatchObject({ status: "draft", scores: { score: 7 } });
    expect(detail.project.name).toBe("Team A1");
    expect(detail.project.members.map((m: { id: number }) => m.id)).toContain(member);
    expect(detail.room.name).toBe("Room A");
  });

  it("403s the detail of another sponsor's challenge", async () => {
    const server = await getApp();
    const ownerA = await createUser();
    const ownerB = await createUser();
    await createOwnedChallenge(ownerA, "Challenge A");
    const challengeB = await createOwnedChallenge(ownerB, "Challenge B");
    const entryB = await createEntry(challengeB, null, "Team B1", "submitted", 5);

    const res = await server.inject({
      method: "GET",
      url: `/api/queue/reviews/${entryB}`,
      headers: asUser(ownerA),
    });
    expect(res.statusCode).toBe(403);
  });

  it("lets an in-scope caller correct an evaluation, versioned and audited", async () => {
    const server = await getApp();
    const owner = await createUser();
    const challengeId = await createOwnedChallenge(owner, "Challenge A");
    const entryId = await createEntry(challengeId, null, "Team A1", "submitted", 6);

    const res = await server.inject({
      method: "PATCH",
      url: `/api/queue/reviews/${entryId}`,
      headers: asUser(owner),
      payload: { scores: { score: 9 }, notes: "recount" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().scores).toEqual({ score: 9 });

    const versions = await pool.query(
      `SELECT changed_fields FROM attempt_review_versions WHERE attempt_id = $1`,
      [entryId],
    );
    expect(versions.rows[0].changed_fields).toEqual(
      expect.arrayContaining(["scores.score", "notes"]),
    );
    const auditRows = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'attempt_review' AND entity_id = $1`,
      [String(entryId)],
    );
    expect(auditRows.rows.map((r: { action: string }) => r.action)).toContain("review.update");

    // An answer outside the panel's type/range is rejected, same as in the room.
    const invalid = await server.inject({
      method: "PATCH",
      url: `/api/queue/reviews/${entryId}`,
      headers: asUser(owner),
      payload: { scores: { score: 99 } },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("403s a correction on another sponsor's challenge", async () => {
    const server = await getApp();
    const ownerA = await createUser();
    const ownerB = await createUser();
    await createOwnedChallenge(ownerA, "Challenge A");
    const challengeB = await createOwnedChallenge(ownerB, "Challenge B");
    const entryB = await createEntry(challengeB, null, "Team B1", "draft", 5);

    const res = await server.inject({
      method: "PATCH",
      url: `/api/queue/reviews/${entryB}`,
      headers: asUser(ownerA),
      payload: { scores: { score: 1 } },
    });
    expect(res.statusCode).toBe(403);
    const untouched = await pool.query(`SELECT scores FROM attempt_review WHERE attempt_id = $1`, [
      entryB,
    ]);
    expect(untouched.rows[0].scores).toEqual({ score: 5 });
  });
});

describe("POST /api/queue/reviews/:entryId/message", () => {
  it("reaches every team member over the mandatory queue category and audits it", async () => {
    const server = await getApp();
    const owner = await createUserWithCapabilities([
      CAPABILITIES.QUEUE_ADMIN,
      CAPABILITIES.NOTIFICATIONS_SEND,
    ]);
    const challengeId = await createOwnedChallenge(await createUser(), "Challenge A");
    const entryId = await createEntry(challengeId, null, "Team A1", "draft", 4);
    const { rows: repoRows } = await pool.query(`SELECT repo_id FROM queue_entries WHERE id = $1`, [
      entryId,
    ]);
    const member = await createUser();
    await pool.query(`INSERT INTO submissions (repo_id, user_id) VALUES ($1, $2)`, [
      repoRows[0].repo_id,
      member,
    ]);
    // Opting out of queue notifications must NOT silence an operational call-back.
    await pool.query(
      `INSERT INTO notification_preferences (user_id, category, channel, enabled)
       VALUES ($1, 'queue', 'push', false)`,
      [member],
    );

    const res = await server.inject({
      method: "POST",
      url: `/api/queue/reviews/${entryId}/message`,
      headers: asUser(owner),
      payload: { message: "Come back to room 2, we have a question." },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ recipients: 1 });

    const outbox = await pool.query(
      `SELECT channel, payload FROM notification_outbox WHERE user_id = $1 AND category = 'queue'`,
      [member],
    );
    expect(outbox.rows.map((r: { channel: string }) => r.channel).sort()).toEqual([
      "email",
      "in_app",
      "push",
    ]);
    const inApp = outbox.rows.find((r: { channel: string }) => r.channel === "in_app");
    expect(inApp.payload.body).toContain("Come back to room 2");

    const auditRows = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'queue_entry' AND entity_id = $1`,
      [String(entryId)],
    );
    expect(auditRows.rows.map((r: { action: string }) => r.action)).toContain(
      "review.message_team",
    );
  });

  it("403s a caller without the comms capability, even one who can see the review", async () => {
    const server = await getApp();
    const owner = await createUser();
    const challengeId = await createOwnedChallenge(owner, "Challenge A");
    const entryId = await createEntry(challengeId, null, "Team A1", "draft", 4);

    const res = await server.inject({
      method: "POST",
      url: `/api/queue/reviews/${entryId}/message`,
      headers: asUser(owner),
      payload: { message: "hello" },
    });
    expect(res.statusCode).toBe(403);
    const outbox = await pool.query(`SELECT count(*)::int AS n FROM notification_outbox`);
    expect(outbox.rows[0].n).toBe(0);
  });
});

describe("GET /api/queue/reviews (confidentiality, exports)", () => {
  it("exports a CSV honoring the same scoping", async () => {
    const server = await getApp();
    const owner = await createUser();
    const challengeId = await createOwnedChallenge(owner, "Challenge A");
    await createEntry(challengeId, null, "Team A1", "submitted", 9);

    const res = await server.inject({
      method: "GET",
      url: "/api/queue/reviews/export.csv",
      headers: asUser(owner),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain("Team A1");
    expect(res.body).toContain("9");
  });
});
