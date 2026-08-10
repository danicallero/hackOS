import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { asUser, buildTestApp, createUserWithCapabilities, truncateAll } from "../helpers.js";
import {
  assignChallengeToRoom,
  createChallenge,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
  getEntry,
  historyRows,
} from "./fixtures.js";

/**
 * Concurrency proofs (plan/07 §2): every transition takes SELECT ... FOR
 * UPDATE on the entry (and room state), so parallel operators produce
 * exactly one winner and explicit 409s for the losers. Idempotency-Key
 * replays never re-execute.
 */

let app: App;
let operatorId: number;
let judgeId: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  operatorId = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
  judgeId = await createUserWithCapabilities([CAPABILITIES.JUDGE_PANEL]);
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

async function setup(maxInWaitingArea = 1) {
  const challengeId = await createChallenge();
  const roomId = await createRoom({ maxInWaitingArea });
  await assignChallengeToRoom(roomId, challengeId);
  return { challengeId, roomId };
}

describe("concurrent transitions: exactly one winner", () => {
  it("two simultaneous call_next with capacity 1: one 200, one 409, one history row", async () => {
    const { challengeId, roomId } = await setup(1);
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);

    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/queue/rooms/${roomId}/call-next`,
        headers: asUser(operatorId),
        payload: {},
      }),
      app.inject({
        method: "POST",
        url: `/api/queue/rooms/${roomId}/call-next`,
        headers: asUser(operatorId),
        payload: {},
      }),
    ]);

    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 409]); // one winner, loser gets an explicit conflict

    expect((await getEntry(entryId)).status).toBe("called");
    expect(await historyRows(entryId)).toHaveLength(1); // exactly one history row
  });

  it("two operators bring different teams into the same room: one winner (one_active_per_room)", async () => {
    const { challengeId, roomId } = await setup(2);
    const { repoId: r1 } = await createRepoWithTeam();
    const { repoId: r2 } = await createRepoWithTeam();
    const e1 = await enqueueRepo(challengeId, r1, 1);
    const e2 = await enqueueRepo(challengeId, r2, 2);
    const call = () =>
      app.inject({
        method: "POST",
        url: `/api/queue/rooms/${roomId}/call-next`,
        headers: asUser(operatorId),
        payload: {},
      });
    await call();
    await call();

    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/queue/entries/${e1}/bring-in`,
        headers: asUser(judgeId),
        payload: {},
      }),
      app.inject({
        method: "POST",
        url: `/api/queue/entries/${e2}/bring-in`,
        headers: asUser(judgeId),
        payload: {},
      }),
    ]);

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM queue_entries WHERE assigned_room_id = $1 AND status = 'in_room'`,
      [roomId],
    );
    expect(rows[0].n).toBe(1); // DB partial index held
  });

  it("two simultaneous no_show on the same entry: single winner, single ladder bump", async () => {
    const { challengeId, roomId } = await setup(1);
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });

    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/queue/entries/${entryId}/no-show`,
        headers: asUser(operatorId),
        payload: {},
      }),
      app.inject({
        method: "POST",
        url: `/api/queue/entries/${entryId}/no-show`,
        headers: asUser(operatorId),
        payload: {},
      }),
    ]);

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const entry = await getEntry(entryId);
    expect(entry.call_count).toBe(1); // exactly one ladder increment
    expect(await historyRows(entryId, "no_show")).toHaveLength(1);
  });

  it("H30 under parallelism: two rooms racing for teams that share a member -> only one gets called", async () => {
    // ch1/room1 and ch2/room2 each hold a repo of the same person at position 1.
    const ch1 = await createChallenge();
    const ch2 = await createChallenge();
    const room1 = await createRoom({ maxInWaitingArea: 1 });
    const room2 = await createRoom({ maxInWaitingArea: 1 });
    await assignChallengeToRoom(room1, ch1);
    await assignChallengeToRoom(room2, ch2);

    const { createUser } = await import("../helpers.js");
    const shared = await createUser();
    const { repoId: rA } = await createRepoWithTeam([shared]);
    const { repoId: rB } = await createRepoWithTeam([shared]);
    const eA = await enqueueRepo(ch1, rA, 1);
    const eB = await enqueueRepo(ch2, rB, 1);

    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/queue/rooms/${room1}/call-next`,
        headers: asUser(operatorId),
        payload: {},
      }),
      app.inject({
        method: "POST",
        url: `/api/queue/rooms/${room2}/call-next`,
        headers: asUser(operatorId),
        payload: {},
      }),
    ]);

    // Both requests succeed HTTP-wise, but at most one may actually call a team.
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const calledCount = [a.json().called, b.json().called].filter(Boolean).length;
    expect(calledCount).toBe(1);

    const statusA = (await getEntry(eA)).status;
    const statusB = (await getEntry(eB)).status;
    expect([statusA, statusB].sort()).toEqual(["called", "waiting"]);
  });

  it("H30 backstop: same repo entered in two challenges with NO resolvable members -> only one gets called", async () => {
    // Reproduces the reported bug: the H30 member-lock guard can't serialize
    // when a repo has zero resolvable members (submissions/devpost rows
    // withdrawn after the queue entry was created). The
    // one_active_entry_per_repo partial index must catch it anyway.
    const ch1 = await createChallenge();
    const ch2 = await createChallenge();
    const room1 = await createRoom({ maxInWaitingArea: 1 });
    const room2 = await createRoom({ maxInWaitingArea: 1 });
    await assignChallengeToRoom(room1, ch1);
    await assignChallengeToRoom(room2, ch2);

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(`INSERT INTO repos (name) VALUES ($1) RETURNING id`, [
      `repo-no-members-${crypto.randomUUID().slice(0, 8)}`,
    ]);
    const repoId = rows[0].id; // no submissions / devpost_participants rows at all

    const eA = await enqueueRepo(ch1, repoId, 1);
    const eB = await enqueueRepo(ch2, repoId, 1);

    const [a, b] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/queue/rooms/${room1}/call-next`,
        headers: asUser(operatorId),
        payload: {},
      }),
      app.inject({
        method: "POST",
        url: `/api/queue/rooms/${room2}/call-next`,
        headers: asUser(operatorId),
        payload: {},
      }),
    ]);

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const calledCount = [a.json().called, b.json().called].filter(Boolean).length;
    expect(calledCount).toBe(1);

    const statusA = (await getEntry(eA)).status;
    const statusB = (await getEntry(eB)).status;
    expect([statusA, statusB].sort()).toEqual(["called", "waiting"]);

    const { rows: activeRows } = await pool.query(
      `SELECT count(*)::int AS n FROM queue_entries WHERE repo_id = $1 AND status IN ('called','in_room','presenting')`,
      [repoId],
    );
    expect(activeRows[0].n).toBe(1); // DB partial index held
  });
});

describe("idempotent replay", () => {
  it("same Idempotency-Key replays the stored response without re-executing", async () => {
    const { challengeId, roomId } = await setup(5);
    const { repoId: r1 } = await createRepoWithTeam();
    const { repoId: r2 } = await createRepoWithTeam();
    const e1 = await enqueueRepo(challengeId, r1, 1);
    await enqueueRepo(challengeId, r2, 2);

    const key = `call-next-${crypto.randomUUID()}`;
    const first = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: { ...asUser(operatorId), "idempotency-key": key },
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().entry.id).toBe(e1);

    const replay = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: { ...asUser(operatorId), "idempotency-key": key },
      payload: {},
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.json().entry.id).toBe(e1); // NOT the second team

    // second team untouched; exactly one call_next happened
    expect(await historyRows(e1, "call_next")).toHaveLength(1);
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM queue_entries WHERE challenge_id = $1 AND status = 'called'`,
      [challengeId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("transition endpoints replay too (bring-in)", async () => {
    const { challengeId, roomId } = await setup(1);
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });

    const key = `bring-in-${crypto.randomUUID()}`;
    const doBringIn = () =>
      app.inject({
        method: "POST",
        url: `/api/queue/entries/${entryId}/bring-in`,
        headers: { ...asUser(judgeId), "idempotency-key": key },
        payload: {},
      });
    const first = await doBringIn();
    expect(first.statusCode).toBe(200);
    const replay = await doBringIn();
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(await historyRows(entryId, "bring_in")).toHaveLength(1);
  });
});
