import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import {
  assignChallengeToRoom,
  createChallenge,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
} from "./fixtures.js";

/** Judging (H36, H37, H40): collaborative review, versioning, search, CSV export. */

let app: App;
let judgeA: number;
let judgeB: number;
let exporterId: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  judgeA = await createUserWithCapabilities([CAPABILITIES.JUDGE_PANEL]);
  judgeB = await createUserWithCapabilities([CAPABILITIES.JUDGE_PANEL]);
  exporterId = await createUserWithCapabilities([CAPABILITIES.JUDGING_EXPORT]);
  app ??= await buildTestApp();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  const { pool } = await import("../../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

const CRITERIA = [
  { key: "innovation", label: "Innovación", max: 10 },
  { key: "execution", label: "Ejecución", max: 10 },
];

async function setupEntry() {
  const challengeId = await createChallenge({ judgingPanelCriteria: CRITERIA });
  const { repoId } = await createRepoWithTeam(
    undefined,
    `Team Rocket ${crypto.randomUUID().slice(0, 4)}`,
  );
  const entryId = await enqueueRepo(challengeId, repoId, 1);
  return { challengeId, repoId, entryId };
}

describe("collaborative review (H36)", () => {
  it("saves a draft, versions every change with author + changed_fields + previous/new", async () => {
    const { entryId } = await setupEntry();

    const first = await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(judgeA),
      payload: { scores: { innovation: 7 } },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("draft");

    // judge B raises the same score: field-level last-write-wins
    const second = await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(judgeB),
      payload: { scores: { innovation: 9 }, notes: "gran demo" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().scores).toEqual({ innovation: 9 });
    expect(second.json().notes).toBe("gran demo");

    const versions = await app.inject({
      method: "GET",
      url: `/api/queue/entries/${entryId}/review/versions`,
      headers: asUser(judgeA),
    });
    const rows = versions.json();
    expect(rows).toHaveLength(2);
    // "Innovación pasó de 7 a 9, lo cambió la jueza B"
    expect(rows[1].author_id).toBe(judgeB);
    expect(rows[1].changed_fields).toContain("scores.innovation");
    expect(rows[1].previous["scores.innovation"]).toBe(7);
    expect(rows[1].new["scores.innovation"]).toBe(9);
  });

  it("merges scores field-by-field instead of clobbering the other judge's fields", async () => {
    const { entryId } = await setupEntry();
    await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(judgeA),
      payload: { scores: { innovation: 7 } },
    });
    const res = await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(judgeB),
      payload: { scores: { execution: 8 } },
    });
    expect(res.json().scores).toEqual({ innovation: 7, execution: 8 });
  });

  it("rejects score keys outside challenges.judging_panel_criteria", async () => {
    const { entryId } = await setupEntry();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(judgeA),
      payload: { scores: { vibes: 10 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("submit closes the review; later corrections stay possible and versioned", async () => {
    const { entryId } = await setupEntry();
    await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(judgeA),
      payload: { scores: { innovation: 7, execution: 6 }, submit: true },
    });

    const review = await app.inject({
      method: "GET",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(judgeA),
    });
    expect(review.json().status).toBe("submitted");

    // correction after submit (H36): allowed, versioned, still submitted
    const fix = await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(judgeB),
      payload: { scores: { execution: 8 } },
    });
    expect(fix.statusCode).toBe(200);
    expect(fix.json().status).toBe("submitted");
    expect(fix.json().scores.execution).toBe(8);

    const versions = await app.inject({
      method: "GET",
      url: `/api/queue/entries/${entryId}/review/versions`,
      headers: asUser(judgeA),
    });
    expect(versions.json()).toHaveLength(2);
  });

  it("a no-op save writes no version row", async () => {
    const { entryId } = await setupEntry();
    await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(judgeA),
      payload: { scores: { innovation: 7 } },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(judgeA),
      payload: { scores: { innovation: 7 } },
    });
    const versions = await app.inject({
      method: "GET",
      url: `/api/queue/entries/${entryId}/review/versions`,
      headers: asUser(judgeA),
    });
    expect(versions.json()).toHaveLength(1);
  });

  it("only one attempt_review can ever exist per queue entry (1:1, invariant 3)", async () => {
    const { entryId } = await setupEntry();
    await Promise.all([
      app.inject({
        method: "PATCH",
        url: `/api/queue/entries/${entryId}/review`,
        headers: asUser(judgeA),
        payload: { scores: { innovation: 5 } },
      }),
      app.inject({
        method: "PATCH",
        url: `/api/queue/entries/${entryId}/review`,
        headers: asUser(judgeB),
        payload: { scores: { execution: 5 } },
      }),
    ]);
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM attempt_review WHERE attempt_id = $1`,
      [entryId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("requires JUDGE_PANEL", async () => {
    const { entryId } = await setupEntry();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(exporterId),
      payload: { notes: "intruso" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("lets room-assigned judges use their scoped judging surfaces without capability groups", async () => {
    const assignedJudge = await createUser();
    const challengeId = await createChallenge({ judgingPanelCriteria: CRITERIA });
    const otherChallengeId = await createChallenge({ judgingPanelCriteria: CRITERIA });
    const roomId = await createRoom();
    await assignChallengeToRoom(roomId, challengeId);

    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `INSERT INTO room_judges (room_id, challenge_id, user_id) VALUES ($1, $2, $3)`,
      [roomId, challengeId, assignedJudge],
    );

    const { repoId } = await createRepoWithTeam(
      undefined,
      `Scoped ${crypto.randomUUID().slice(0, 4)}`,
    );
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    const otherEntryId = await enqueueRepo(otherChallengeId, repoId, 1);

    const me = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: asUser(assignedJudge),
    });
    expect(me.json().role).toBe("judge");
    expect(me.json().capabilities).toEqual([]);

    const rooms = await app.inject({
      method: "GET",
      url: "/api/queue/rooms",
      headers: asUser(assignedJudge),
    });
    expect(rooms.statusCode).toBe(200);
    expect(rooms.json().map((r: { id: number }) => r.id)).toEqual([roomId]);

    const view = await app.inject({
      method: "GET",
      url: `/api/queue/rooms/${roomId}/view`,
      headers: asUser(assignedJudge),
    });
    expect(view.statusCode).toBe(200);
    expect(view.json().challenge.id).toBe(challengeId);

    const challenges = await app.inject({
      method: "GET",
      url: "/api/challenges",
      headers: asUser(assignedJudge),
    });
    expect(challenges.statusCode).toBe(200);
    expect(challenges.json().challenges.map((c: { id: number }) => c.id)).toEqual([challengeId]);

    const projects = await app.inject({
      method: "GET",
      url: "/api/repos",
      headers: asUser(assignedJudge),
    });
    expect(projects.statusCode).toBe(200);
    expect(projects.json().repos.map((r: { id: number }) => r.id)).toEqual([repoId]);

    const repoChallenges = await app.inject({
      method: "GET",
      url: `/api/queue/repos/${repoId}/challenges`,
      headers: asUser(assignedJudge),
    });
    expect(repoChallenges.statusCode).toBe(200);
    expect(
      repoChallenges
        .json()
        .map((c: { id: number }) => c.id)
        .sort(),
    ).toEqual([challengeId, otherChallengeId].sort());

    const review = await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(assignedJudge),
      payload: { scores: { innovation: 7 } },
    });
    expect(review.statusCode).toBe(200);

    const outside = await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${otherEntryId}/review`,
      headers: asUser(assignedJudge),
      payload: { scores: { innovation: 7 } },
    });
    expect(outside.statusCode).toBe(403);
  });
});

describe("judging sessions (H36 presence)", () => {
  it("join is idempotent while open; leave closes it", async () => {
    const { entryId } = await setupEntry();
    const join = () =>
      app.inject({
        method: "POST",
        url: `/api/queue/entries/${entryId}/session`,
        headers: asUser(judgeA),
        payload: {},
      });
    await join();
    await join(); // reconnect: no duplicate open session

    const sessions = await app.inject({
      method: "GET",
      url: `/api/queue/entries/${entryId}/sessions`,
      headers: asUser(judgeB),
    });
    expect(sessions.json()).toHaveLength(1);

    await app.inject({
      method: "DELETE",
      url: `/api/queue/entries/${entryId}/session`,
      headers: asUser(judgeA),
    });
    const after = await app.inject({
      method: "GET",
      url: `/api/queue/entries/${entryId}/sessions`,
      headers: asUser(judgeB),
    });
    expect(after.json()).toHaveLength(0);
  });
});

describe("manual search (H37)", () => {
  it("finds by repo name and reports whether an evaluation already exists", async () => {
    const challengeId = await createChallenge({ judgingPanelCriteria: CRITERIA });
    const { repoId: r1 } = await createRepoWithTeam(undefined, "Cacharro Volador");
    const { repoId: r2 } = await createRepoWithTeam(undefined, "Otro Proyecto");
    const e1 = await enqueueRepo(challengeId, r1, 1);
    await enqueueRepo(challengeId, r2, 2);

    await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${e1}/review`,
      headers: asUser(judgeA),
      payload: { scores: { innovation: 8 }, submit: true },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/queue/challenges/${challengeId}/search?q=cacharro`,
      headers: asUser(judgeA),
    });
    expect(res.statusCode).toBe(200);
    const hits = res.json();
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe(e1);
    expect(hits[0].has_review).toBe(true); // UI opens the existing one — never a second evaluation
    expect(hits[0].review_status).toBe("submitted");

    const byId = await app.inject({
      method: "GET",
      url: `/api/queue/challenges/${challengeId}/search?q=${r2}`,
      headers: asUser(judgeA),
    });
    expect(byId.json().some((h: { repo_id: number }) => h.repo_id === r2)).toBe(true);
  });

  it("lets a sponsor rep search their own challenge without room_judges/capabilities, but not others' (H46)", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const owner = await createUser();
    const enterprise = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
      `Ent ${crypto.randomUUID()}`,
    ]);
    const ownerSponsor = await pool.query(
      `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
      [enterprise.rows[0].id, owner],
    );
    const challenge = await pool.query(
      `INSERT INTO challenges (author, title, judging_panel_criteria) VALUES ($1, $2, $3) RETURNING id`,
      [ownerSponsor.rows[0].id, "Sponsor Challenge", JSON.stringify(CRITERIA)],
    );
    const challengeId = challenge.rows[0].id;

    const rep = await createUser();
    await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
      enterprise.rows[0].id,
      rep,
    ]);

    const res = await app.inject({
      method: "GET",
      url: `/api/queue/challenges/${challengeId}/search?q=x`,
      headers: asUser(rep),
    });
    expect(res.statusCode).toBe(200);

    const otherChallengeId = await createChallenge({ judgingPanelCriteria: CRITERIA });
    const forbidden = await app.inject({
      method: "GET",
      url: `/api/queue/challenges/${otherChallengeId}/search?q=x`,
      headers: asUser(rep),
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe("CSV export (H40)", () => {
  it("exports the queue as text/csv, guarded by JUDGING_EXPORT", async () => {
    const challengeId = await createChallenge({ judgingPanelCriteria: CRITERIA });
    const { repoId } = await createRepoWithTeam(undefined, 'Comma, "Quote" Team');
    await enqueueRepo(challengeId, repoId, 1);

    const forbidden = await app.inject({
      method: "GET",
      url: `/api/queue/challenges/${challengeId}/export/queue.csv`,
      headers: asUser(judgeA),
    });
    expect(forbidden.statusCode).toBe(403);

    const globalExporter = await createUserWithCapabilities([
      CAPABILITIES.JUDGING_EXPORT,
      CAPABILITIES.QUEUE_ADMIN,
    ]);
    const res = await app.inject({
      method: "GET",
      url: `/api/queue/challenges/${challengeId}/export/queue.csv`,
      headers: asUser(globalExporter),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain("repo_name,status");
    expect(res.body).toContain('"Comma, ""Quote"" Team"'); // proper CSV escaping
  });

  it("blocks an exporter from extracting another challenge's CSV", async () => {
    const allowedChallengeId = await createChallenge({ judgingPanelCriteria: CRITERIA });
    const forbiddenChallengeId = await createChallenge({ judgingPanelCriteria: CRITERIA });
    const allowedRepo = await createRepoWithTeam(undefined, "Allowed Team");
    const forbiddenRepo = await createRepoWithTeam(undefined, "Forbidden Team");
    await enqueueRepo(allowedChallengeId, allowedRepo.repoId, 1);
    await enqueueRepo(forbiddenChallengeId, forbiddenRepo.repoId, 1);

    const scopedExporter = await createUserWithCapabilities([CAPABILITIES.JUDGING_EXPORT]);
    const roomId = await createRoom();
    await assignChallengeToRoom(roomId, allowedChallengeId);
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `INSERT INTO room_judges (room_id, challenge_id, user_id) VALUES ($1, $2, $3)`,
      [roomId, allowedChallengeId, scopedExporter],
    );

    const allowed = await app.inject({
      method: "GET",
      url: `/api/queue/challenges/${allowedChallengeId}/export/queue.csv`,
      headers: asUser(scopedExporter),
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).toContain("Allowed Team");

    const blocked = await app.inject({
      method: "GET",
      url: `/api/queue/challenges/${forbiddenChallengeId}/export/queue.csv`,
      headers: asUser(scopedExporter),
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.body).not.toContain("Forbidden Team");
  });

  it("exports evaluations with one column per criterion", async () => {
    const challengeId = await createChallenge({ judgingPanelCriteria: CRITERIA });
    const { repoId } = await createRepoWithTeam(undefined, "Evaluated Team");
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    const { repoId: r2 } = await createRepoWithTeam(undefined, "Pending Team");
    await enqueueRepo(challengeId, r2, 2);

    await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(judgeA),
      payload: { scores: { innovation: 9, execution: 7 }, notes: "solid", submit: true },
    });

    const globalExporter = await createUserWithCapabilities([
      CAPABILITIES.JUDGING_EXPORT,
      CAPABILITIES.QUEUE_ADMIN,
    ]);
    const res = await app.inject({
      method: "GET",
      url: `/api/queue/challenges/${challengeId}/export/evaluations.csv`,
      headers: asUser(globalExporter),
    });
    expect(res.statusCode).toBe(200);
    const [header, row1, row2] = res.body.trim().split("\r\n");
    expect(header).toBe("repo_name,status,innovation,execution,notes");
    expect(row1).toBe("Evaluated Team,submitted,9,7,solid");
    expect(row2).toBe("Pending Team,not_evaluated,,,");
  });
});
