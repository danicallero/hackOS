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
  broadcastCount,
  createChallenge,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
} from "./fixtures.js";

/** Read APIs: progress (H40), room/TV views (H41), participant status (H38), pace (H39), TV mode (H42). */

let app: App;
let operatorId: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  const { pool } = await import("../../src/db/pool.js");
  await pool.query(`UPDATE queue_settings SET schedule_end_at = NULL WHERE id = 1`);
  operatorId = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
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

describe("challenge progress (H40)", () => {
  it("counts entries by status", async () => {
    const challengeId = await createChallenge();
    const { pool } = await import("../../src/db/pool.js");
    const statuses = ["waiting", "waiting", "called", "presenting", "completed", "disqualified"];
    for (const status of statuses) {
      const { repoId } = await createRepoWithTeam();
      await pool.query(
        `INSERT INTO queue_entries (challenge_id, repo_id, status, position) VALUES ($1, $2, $3, 1)`,
        [challengeId, repoId, status],
      );
    }

    const res = await app.inject({
      method: "GET",
      url: `/api/queue/challenges/${challengeId}/progress`,
      headers: asUser(operatorId),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.waiting).toBe(2);
    expect(body.called).toBe(1);
    expect(body.inProgress).toBe(1);
    expect(body.evaluated).toBe(1);
    expect(body.disqualified).toBe(1);
  });

  it("lets a sponsor rep view progress for their own challenge without room_judges/capabilities, but not others' (H46)", async () => {
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
      `INSERT INTO challenges (author, title) VALUES ($1, $2) RETURNING id`,
      [ownerSponsor.rows[0].id, "Sponsor Challenge"],
    );
    const challengeId = challenge.rows[0].id;

    const rep = await createUser();
    await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
      enterprise.rows[0].id,
      rep,
    ]);

    const res = await app.inject({
      method: "GET",
      url: `/api/queue/challenges/${challengeId}/progress`,
      headers: asUser(rep),
    });
    expect(res.statusCode).toBe(200);

    const otherChallengeId = await createChallenge();
    const forbidden = await app.inject({
      method: "GET",
      url: `/api/queue/challenges/${otherChallengeId}/progress`,
      headers: asUser(rep),
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe("room view (H41)", () => {
  it("returns presenting/called/next for a room; /api/tv/rooms is public", async () => {
    const challengeId = await createChallenge();
    const roomId = await createRoom({ maxInWaitingArea: 2 });
    await assignChallengeToRoom(roomId, challengeId);
    const { pool } = await import("../../src/db/pool.js");

    const mk = async (status: string, position: number, room: number | null) => {
      const { repoId } = await createRepoWithTeam();
      await pool.query(
        `INSERT INTO queue_entries (challenge_id, repo_id, status, position, assigned_room_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [challengeId, repoId, status, position, room],
      );
      return repoId;
    };
    await mk("presenting", 0, roomId);
    await mk("called", 1, roomId);
    await mk("waiting", 2, null);
    await mk("waiting", 3, null);

    const res = await app.inject({
      method: "GET",
      url: `/api/queue/rooms/${roomId}/view`,
      headers: asUser(operatorId),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.active.status).toBe("presenting");
    expect(body.called).toHaveLength(1);
    expect(body.next).toHaveLength(2);

    const tv = await app.inject({ method: "GET", url: "/api/tv/rooms" }); // no auth
    expect(tv.statusCode).toBe(200);
    expect(tv.json()).toHaveLength(1);
    expect(tv.json()[0].active.status).toBe("presenting");
  });
});

describe("participant view (H38)", () => {
  it("shows status, position and ETA for each challenge of my repos", async () => {
    const me = await createUser();
    const challengeId = await createChallenge();
    const roomId = await createRoom({ desiredMinutesPerTeam: 10 });
    await assignChallengeToRoom(roomId, challengeId);

    const { repoId: ahead } = await createRepoWithTeam();
    await enqueueRepo(challengeId, ahead, 1);
    const { repoId: mine } = await createRepoWithTeam([me]);
    await enqueueRepo(challengeId, mine, 2);

    const res = await app.inject({ method: "GET", url: "/api/queue/me", headers: asUser(me) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].status).toBe("waiting");
    expect(body[0].position).toBe(2); // one team ahead
    expect(body[0].etaMinutes).toBe(20); // 2 slots x 10 min / 1 room
    expect(res.statusCode).toBe(200);

    const anon = await app.inject({ method: "GET", url: "/api/queue/me" });
    expect(anon.statusCode).toBe(401);
  });

  it("keeps queue and room reads available for a linked Devpost participant", async () => {
    const member = await createUser({ email: "secondary-linked@test.local" });
    const challengeId = await createChallenge();
    const roomId = await createRoom();
    await assignChallengeToRoom(roomId, challengeId);
    const { pool } = await import("../../src/db/pool.js");
    const repo = await pool.query(
      `INSERT INTO repos (name) VALUES ('Devpost fallback') RETURNING id`,
    );
    const repoId = repo.rows[0].id;
    await pool.query(
      `INSERT INTO devpost_participants
         (repo_id, email, user_id, import_batch, merge_status)
       VALUES ($1, 'secondary-linked@test.local', $2, 'test-import', 'manually_linked')`,
      [repoId, member],
    );
    await pool.query(
      `INSERT INTO queue_entries (challenge_id, repo_id, status, position, assigned_room_id)
       VALUES ($1, $2, 'presenting', 1, $3)`,
      [challengeId, repoId, roomId],
    );

    const mine = await app.inject({ method: "GET", url: "/api/queue/me", headers: asUser(member) });
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toMatchObject([{ repoId, challengeId, status: "presenting" }]);

    const room = await app.inject({
      method: "GET",
      url: `/api/queue/rooms/${roomId}/view`,
      headers: asUser(operatorId),
    });
    expect(room.statusCode).toBe(200);
    expect(room.json().active.repo_members).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: member })]),
    );
  });

  it("lists every room judging a multi-room challenge while waiting, and only the called room once called", async () => {
    const me = await createUser();
    const challengeId = await createChallenge();
    const roomA = await createRoom({ name: "Room A" });
    const roomB = await createRoom({ name: "Room B" });
    await assignChallengeToRoom(roomA, challengeId);
    await assignChallengeToRoom(roomB, challengeId);
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE rooms SET location = 'Building 1, 2nd floor' WHERE id = $1`, [roomA]);

    const { repoId: mine } = await createRepoWithTeam([me]);
    await enqueueRepo(challengeId, mine, 1);

    const waiting = await app.inject({ method: "GET", url: "/api/queue/me", headers: asUser(me) });
    expect(waiting.statusCode).toBe(200);
    const waitingEntry = waiting.json()[0];
    expect(waitingEntry.room).toBeNull();
    expect(waitingEntry.rooms).toEqual(
      expect.arrayContaining([
        { id: roomA, name: "Room A", location: "Building 1, 2nd floor" },
        { id: roomB, name: "Room B", location: null },
      ]),
    );

    const callRes = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomA}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    expect(callRes.statusCode).toBe(200);

    const called = await app.inject({ method: "GET", url: "/api/queue/me", headers: asUser(me) });
    expect(called.statusCode).toBe(200);
    const calledEntry = called.json()[0];
    // Once called, the human-readable room name/location is the concrete one
    // the team was actually assigned to (H38) — not an opaque room id.
    expect(calledEntry.room).toEqual({
      id: roomA,
      name: "Room A",
      location: "Building 1, 2nd floor",
    });
  });
});

describe("pace (H39)", () => {
  it("flags insufficient time when desired pace does not fit the remaining schedule", async () => {
    const challengeId = await createChallenge();
    const roomId = await createRoom({ desiredMinutesPerTeam: 10 });
    await assignChallengeToRoom(roomId, challengeId);
    for (let i = 1; i <= 6; i++) {
      const { repoId } = await createRepoWithTeam();
      await enqueueRepo(challengeId, repoId, i);
    }
    const { pool } = await import("../../src/db/pool.js");
    // 30 minutes left, 6 teams x 10 min = 60 needed
    await pool.query(
      `UPDATE queue_settings SET schedule_end_at = now() + interval '30 minutes' WHERE id = 1`,
    );

    const res = await app.inject({
      method: "GET",
      url: `/api/queue/rooms/${roomId}/pace`,
      headers: asUser(operatorId),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pendingCount).toBe(6);
    expect(body.requiredMinutes).toBe(60);
    expect(body.insufficientTime).toBe(true);
    expect(body.suggestedMinutesPerTeam).toBeLessThan(10);

    // plenty of time -> no flag
    await pool.query(
      `UPDATE queue_settings SET schedule_end_at = now() + interval '10 hours' WHERE id = 1`,
    );
    const ok = await app.inject({
      method: "GET",
      url: `/api/queue/rooms/${roomId}/pace`,
      headers: asUser(operatorId),
    });
    expect(ok.json().insufficientTime).toBe(false);
  });
});

describe("called-too-long threshold (H34, H203)", () => {
  it("exposes a configurable threshold via queue settings and room pace, not a hardcoded fallback", async () => {
    const challengeId = await createChallenge();
    const roomId = await createRoom({ desiredMinutesPerTeam: 10 });
    await assignChallengeToRoom(roomId, challengeId);

    const defaultPace = await app.inject({
      method: "GET",
      url: `/api/queue/rooms/${roomId}/pace`,
      headers: asUser(operatorId),
    });
    expect(defaultPace.json().calledTooLongThresholdMinutes).toBe(10); // migration default

    const adminId = await createUserWithCapabilities([CAPABILITIES.QUEUE_ADMIN]);
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/queue/settings",
      headers: asUser(adminId),
      payload: { calledTooLongThresholdMinutes: 25 },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().called_too_long_threshold_minutes).toBe(25);

    const settings = await app.inject({
      method: "GET",
      url: "/api/queue/settings",
      headers: asUser(operatorId),
    });
    expect(settings.json().called_too_long_threshold_minutes).toBe(25);

    const pace = await app.inject({
      method: "GET",
      url: `/api/queue/rooms/${roomId}/pace`,
      headers: asUser(operatorId),
    });
    // Reflects the operator-configured value, not the old max(10, 2x desired) formula.
    expect(pace.json().calledTooLongThresholdMinutes).toBe(25);
  });
});

describe("TV mode (H42)", () => {
  it("defaults to rooms, PATCH requires TV_CONTROL, changes persist in Valkey and broadcast on tv", async () => {
    const initial = await app.inject({ method: "GET", url: "/api/tv/mode" }); // public
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({ mode: "rooms", payload: null, expiresAt: null });

    const forbidden = await app.inject({
      method: "PATCH",
      url: "/api/tv/mode",
      headers: asUser(operatorId),
      payload: { mode: "wifi" },
    });
    expect(forbidden.statusCode).toBe(403);

    const tvController = await createUserWithCapabilities([CAPABILITIES.TV_CONTROL]);
    const before = await broadcastCount("tv");
    const res = await app.inject({
      method: "PATCH",
      url: "/api/tv/mode",
      headers: asUser(tvController),
      payload: { mode: "live", payload: null },
    });
    expect(res.statusCode).toBe(200);
    expect(await broadcastCount("tv")).toBe(before + 1); // TV_MODE_CHANGED

    const read = await app.inject({ method: "GET", url: "/api/tv/mode" });
    expect(read.json()).toMatchObject({
      mode: "live",
      payload: null,
      expiresAt: null,
    });

    const { valkey } = await import("../../src/lib/valkey.js");
    expect(await valkey.get("tv:mode")).not.toBeNull();
  });
});

describe("SSE streams (H41/H42)", () => {
  it("keeps the operational queue stream authorized while the TV stream remains public", async () => {
    const anonymousQueue = await app.inject({ method: "GET", url: "/api/queue/stream" });
    expect(anonymousQueue.statusCode).toBe(401);

    // inject with payloadAsStream so the never-ending SSE body doesn't hang the test
    for (const { url, headers } of [
      { url: "/api/queue/stream", headers: asUser(operatorId) },
      { url: "/api/tv/stream", headers: undefined },
    ]) {
      const res = await app.inject({
        method: "GET",
        url,
        headers: { origin: "https://hackos.example.test", ...headers },
        payloadAsStream: true,
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/event-stream");
      expect(res.headers["access-control-allow-origin"]).toBe("https://hackos.example.test");
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
      const firstChunk: Buffer = await new Promise((resolve, reject) => {
        res.stream().once("data", resolve);
        res.stream().once("error", reject);
      });
      expect(firstChunk.toString()).toContain(": connected");
      res.stream().destroy();
    }
  });
});
