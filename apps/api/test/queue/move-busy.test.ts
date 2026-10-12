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
  getEntry,
  historyRows,
} from "./fixtures.js";

/**
 * #931: moving a team inside its queue was rejected as "busy in another
 * room" for reasons unrelated to another room. Reordering never calls a team,
 * so only a genuine evaluation elsewhere may block it; H30 still governs
 * every call.
 */

let app: App;
let operatorId: number;
let judgeId: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  const { pool } = await import("../../src/db/pool.js");
  await pool.query(
    `UPDATE queue_settings SET schedule_start_at = NULL, schedule_end_at = NULL WHERE id = 1`,
  );
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

/** Queue with a paused room, so post-move top-ups cannot call anyone. */
async function pausedQueue(name = "Sala Venus") {
  const challengeId = await createChallenge();
  const roomId = await createRoom({ name });
  await assignChallengeToRoom(roomId, challengeId);
  const { pool } = await import("../../src/db/pool.js");
  await pool.query(`UPDATE room_queue_state SET is_paused = true WHERE room_id = $1`, [roomId]);
  return { challengeId, roomId };
}

async function makeDraft(repoId: number) {
  const { pool } = await import("../../src/db/pool.js");
  await pool.query(`UPDATE repos SET submission_status = 'draft' WHERE id = $1`, [repoId]);
}

function post(url: string, payload: object = {}, userId = operatorId) {
  return app.inject({ method: "POST", url, headers: asUser(userId), payload });
}

describe("moving teams that are not busy (#931)", () => {
  it("reorders an ineligible project instead of reporting it busy in another room", async () => {
    const { challengeId } = await pausedQueue();
    const { repoId: r1 } = await createRepoWithTeam();
    const { repoId: r2 } = await createRepoWithTeam();
    const e1 = await enqueueRepo(challengeId, r1, 1);
    const e2 = await enqueueRepo(challengeId, r2, 2);
    await makeDraft(r2);

    const top = await post(`/api/queue/entries/${e2}/move-top`);
    expect(top.statusCode).toBe(200);
    expect((await getEntry(e2)).position).toBeLessThan((await getEntry(e1)).position);

    const end = await post(`/api/queue/entries/${e2}/move-to`, { position: 99 });
    expect(end.statusCode).toBe(200);
    const skip = await post(`/api/queue/entries/${e2}/skip`);
    expect(skip.statusCode).toBe(200);
    expect(await historyRows(e2)).toHaveLength(3);
  });

  it("still never calls an ineligible project, and says why", async () => {
    const { challengeId, roomId } = await pausedQueue();
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    await makeDraft(repoId);

    const manual = await post(`/api/queue/entries/${entryId}/manual-call`, {
      targetStatus: "called",
      roomId,
    });
    expect(manual.statusCode).toBe(409);
    expect(manual.json().error.message).toBe("Project is not eligible for judging");

    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE room_queue_state SET is_paused = false WHERE room_id = $1`, [roomId]);
    await post(`/api/queue/rooms/${roomId}/call-next`);
    expect((await getEntry(entryId)).status).toBe("waiting");
  });

  it("allows moving a team whose member is only waiting at another room's door", async () => {
    const { challengeId } = await pausedQueue();
    const other = await pausedQueue("Sala Mars");
    const shared = await createUser();
    const { repoId: here } = await createRepoWithTeam([shared]);
    const { repoId: there } = await createRepoWithTeam([shared]);
    const entryId = await enqueueRepo(challengeId, here, 3);
    const elsewhere = await enqueueRepo(other.challengeId, there, 1);
    expect(
      (
        await post(`/api/queue/entries/${elsewhere}/manual-call`, {
          targetStatus: "called",
          roomId: other.roomId,
        })
      ).statusCode,
    ).toBe(200);

    const res = await post(`/api/queue/entries/${entryId}/move-top`);
    expect(res.statusCode).toBe(200);
  });
});

describe("real occupancy still blocks moves (#931, H30)", () => {
  it("names the room where a shared member is being evaluated", async () => {
    const { challengeId } = await pausedQueue();
    const other = await pausedQueue("Sala Mars");
    const shared = await createUser();
    const { repoId: here } = await createRepoWithTeam([shared]);
    const { repoId: there } = await createRepoWithTeam([shared], "Equipo Rojo");
    const entryId = await enqueueRepo(challengeId, here, 3);
    const elsewhere = await enqueueRepo(other.challengeId, there, 1);
    await post(`/api/queue/entries/${elsewhere}/manual-call`, {
      targetStatus: "in_room",
      roomId: other.roomId,
    });

    const res = await post(`/api/queue/entries/${entryId}/move-top`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toBe("Busy in Sala Mars");
    expect(res.json().error.details).toMatchObject({ roomName: "Sala Mars", status: "in_room" });
    expect((await getEntry(entryId)).position).toBe(3);

    // The block clears with the real occupancy: no stale state survives.
    expect((await post(`/api/queue/entries/${elsewhere}/start`, {}, judgeId)).statusCode).toBe(200);
    expect((await post(`/api/queue/entries/${elsewhere}/complete`, {}, judgeId)).statusCode).toBe(
      200,
    );
    expect((await post(`/api/queue/entries/${entryId}/move-top`)).statusCode).toBe(200);
  });

  it("lets exactly one of two concurrent calls of teams sharing a member win (plan/07 §2)", async () => {
    const venus = await pausedQueue();
    const mars = await pausedQueue("Sala Mars");
    const shared = await createUser();
    const { repoId: here } = await createRepoWithTeam([shared]);
    const { repoId: there } = await createRepoWithTeam([shared]);
    const hereEntry = await enqueueRepo(venus.challengeId, here, 1);
    const thereEntry = await enqueueRepo(mars.challengeId, there, 1);

    const results = await Promise.all([
      post(`/api/queue/entries/${hereEntry}/manual-call`, {
        targetStatus: "in_room",
        roomId: venus.roomId,
      }),
      post(`/api/queue/entries/${thereEntry}/manual-call`, {
        targetStatus: "in_room",
        roomId: mars.roomId,
      }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const winner = results[0].statusCode === 200 ? hereEntry : thereEntry;
    const loser = winner === hereEntry ? thereEntry : hereEntry;
    expect((await getEntry(winner)).status).toBe("in_room");
    expect((await getEntry(loser)).status).toBe("waiting");
    expect(await historyRows(winner)).toHaveLength(1);
    expect(await historyRows(loser)).toHaveLength(0);

    // The loser cannot be reordered while the winner is being evaluated.
    const move = await post(`/api/queue/entries/${loser}/move-top`);
    expect(move.statusCode).toBe(409);
    expect(await historyRows(loser)).toHaveLength(0);
  });
});

describe("busy indicator in the team lookup (#931)", () => {
  it("reports where a team's member is occupied before any move is attempted", async () => {
    const { challengeId } = await pausedQueue();
    const other = await pausedQueue("Sala Mars");
    const shared = await createUser();
    const { repoId: here } = await createRepoWithTeam([shared]);
    const { repoId: there } = await createRepoWithTeam([shared]);
    await enqueueRepo(challengeId, here, 1);
    const elsewhere = await enqueueRepo(other.challengeId, there, 1);

    const read = async () =>
      (
        await app.inject({
          method: "GET",
          url: `/api/queue/repos/${here}/challenges`,
          headers: asUser(operatorId),
        })
      ).json()[0];

    expect(await read()).toMatchObject({ busy_room_name: null, busy_status: null });
    await post(`/api/queue/entries/${elsewhere}/manual-call`, {
      targetStatus: "called",
      roomId: other.roomId,
    });
    expect(await read()).toMatchObject({ busy_room_name: "Sala Mars", busy_status: "called" });
    expect((await post(`/api/queue/entries/${elsewhere}/bring-in`, {}, judgeId)).statusCode).toBe(
      200,
    );
    expect(await read()).toMatchObject({ busy_room_name: "Sala Mars", busy_status: "in_room" });
  });

  async function lookup(repoId: number) {
    return (
      await app.inject({
        method: "GET",
        url: `/api/queue/repos/${repoId}/challenges`,
        headers: asUser(operatorId),
      })
    ).json()[0];
  }

  /** A shared member's team, put in a room of another challenge. */
  async function occupySharedMember(status: "called" | "in_room") {
    const { challengeId } = await pausedQueue();
    const other = await pausedQueue("Sala Mars");
    const shared = await createUser();
    const { repoId: here } = await createRepoWithTeam([shared]);
    const { repoId: there } = await createRepoWithTeam([shared]);
    const hereEntry = await enqueueRepo(challengeId, here, 1);
    const elsewhere = await enqueueRepo(other.challengeId, there, 1);
    const call = await post(`/api/queue/entries/${elsewhere}/manual-call`, {
      targetStatus: status,
      roomId: other.roomId,
    });
    expect(call.statusCode).toBe(200);
    return { here, hereEntry, elsewhere, other };
  }

  it("ignores occupancy in a test challenge, like the H30 guard", async () => {
    const { here, other } = await occupySharedMember("in_room");
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE challenges SET is_test_account = true WHERE id = $1`, [
      other.challengeId,
    ]);
    expect(await lookup(here)).toMatchObject({ busy_room_name: null, busy_status: null });
  });

  it.each([
    "completed",
    "disqualified",
  ] as const)("carries no busy warning on a %s row", async (status) => {
    const { here, hereEntry } = await occupySharedMember("in_room");
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE queue_entries SET status = $2, position = NULL WHERE id = $1`, [
      hereEntry,
      status,
    ]);
    expect(await lookup(here)).toMatchObject({
      status,
      busy_room_id: null,
      busy_room_name: null,
      busy_status: null,
    });
  });

  it("names the blocking room id so a call to that room stays allowed", async () => {
    const { here, other } = await occupySharedMember("called");
    expect(await lookup(here)).toMatchObject({ busy_room_id: other.roomId, busy_status: "called" });
  });

  it("does not report an unrelated team's occupancy", async () => {
    const { challengeId } = await pausedQueue();
    const other = await pausedQueue("Sala Mars");
    const { repoId: here } = await createRepoWithTeam();
    const { repoId: stranger } = await createRepoWithTeam();
    await enqueueRepo(challengeId, here, 1);
    const elsewhere = await enqueueRepo(other.challengeId, stranger, 1);
    await post(`/api/queue/entries/${elsewhere}/manual-call`, {
      targetStatus: "in_room",
      roomId: other.roomId,
    });
    expect(await lookup(here)).toMatchObject({ busy_room_name: null });
  });

  it("exposes project eligibility (H38)", async () => {
    const { challengeId } = await pausedQueue();
    const { repoId } = await createRepoWithTeam();
    await enqueueRepo(challengeId, repoId, 1);
    expect(await lookup(repoId)).toMatchObject({ eligible: true });
    await makeDraft(repoId);
    expect(await lookup(repoId)).toMatchObject({ eligible: false });
  });
});

describe("call paths check eligibility explicitly (#931, H30, H38)", () => {
  it("call-next skips an ineligible team, keeps its position and explains why", async () => {
    const { challengeId, roomId } = await pausedQueue();
    const { repoId: draft } = await createRepoWithTeam();
    const { repoId: ready } = await createRepoWithTeam();
    const draftEntry = await enqueueRepo(challengeId, draft, 1);
    const readyEntry = await enqueueRepo(challengeId, ready, 2);
    await makeDraft(draft);

    const view = await app.inject({
      method: "GET",
      url: `/api/queue/rooms/${roomId}/view`,
      headers: asUser(operatorId),
    });
    expect(view.json().crossRoomSkips).toEqual([
      { entryId: draftEntry, position: 1, reason: "ineligible", positionPreserved: true },
    ]);

    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE room_queue_state SET is_paused = false WHERE room_id = $1`, [roomId]);
    expect((await post(`/api/queue/rooms/${roomId}/call-next`)).statusCode).toBe(200);
    expect((await getEntry(readyEntry)).status).toBe("called");
    expect(await getEntry(draftEntry)).toMatchObject({ status: "waiting", position: 1 });
  });

  it("labels an occupancy skip as busy_member", async () => {
    const { challengeId, roomId } = await pausedQueue();
    const other = await pausedQueue("Sala Mars");
    const shared = await createUser();
    const { repoId: here } = await createRepoWithTeam([shared]);
    const { repoId: there } = await createRepoWithTeam([shared]);
    const entryId = await enqueueRepo(challengeId, here, 1);
    const elsewhere = await enqueueRepo(other.challengeId, there, 1);
    await post(`/api/queue/entries/${elsewhere}/manual-call`, {
      targetStatus: "called",
      roomId: other.roomId,
    });
    const view = await app.inject({
      method: "GET",
      url: `/api/queue/rooms/${roomId}/view`,
      headers: asUser(operatorId),
    });
    expect(view.json().crossRoomSkips).toEqual([
      expect.objectContaining({
        entryId,
        reason: "busy_member",
        blockingRoomName: "Sala Mars",
        blockingStatus: "called",
      }),
    ]);
  });
});
