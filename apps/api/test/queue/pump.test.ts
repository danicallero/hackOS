import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, createUserWithCapabilities, truncateAll } from "../helpers.js";
import {
  assignChallengeToRoom,
  createChallenge,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
  getEntry,
} from "./fixtures.js";

/**
 * Pump (plan/07 §5.1): tops up `called` per active non-paused room from the
 * shared challenge queue, honouring priority/position, the H30 guard and
 * paused/inactive rooms; emits pre-call warnings (H38) exactly once.
 * pumpTick() is invoked directly — the BullMQ repeatable job just calls it.
 */

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
});

afterAll(async () => {
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  const { pool } = await import("../../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function pump() {
  const { pumpTick } = await import("../../src/modules/queue/pump.js");
  await pumpTick();
}

describe("queue pump (H29, plan/07 §5.1)", () => {
  it("tops up called entries to max_in_waiting_area, by position, with system (null) actor", async () => {
    const challengeId = await createChallenge();
    const roomId = await createRoom({ maxInWaitingArea: 2 });
    await assignChallengeToRoom(roomId, challengeId);
    const entries: number[] = [];
    for (let i = 1; i <= 4; i++) {
      const { repoId } = await createRepoWithTeam();
      entries.push(await enqueueRepo(challengeId, repoId, i));
    }

    await pump();

    expect((await getEntry(entries[0]!)).status).toBe("called");
    expect((await getEntry(entries[1]!)).status).toBe("called");
    expect((await getEntry(entries[2]!)).status).toBe("waiting"); // cap reached
    expect((await getEntry(entries[3]!)).status).toBe("waiting");

    const { pool } = await import("../../src/db/pool.js");
    const history = await pool.query(
      `SELECT actor_id FROM queue_history WHERE queue_entry_id = $1 AND action = 'call_next'`,
      [entries[0]!],
    );
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0].actor_id).toBeNull(); // DELTA(H29): system actor

    // a second tick is a no-op while the buffer is full
    await pump();
    expect((await getEntry(entries[2]!)).status).toBe("waiting");
  });

  it("one shared logical queue across N rooms: no team is called twice, distribution fills both rooms", async () => {
    const challengeId = await createChallenge();
    const room1 = await createRoom({ maxInWaitingArea: 1 });
    const room2 = await createRoom({ maxInWaitingArea: 1 });
    await assignChallengeToRoom(room1, challengeId);
    await assignChallengeToRoom(room2, challengeId);
    const entries: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const { repoId } = await createRepoWithTeam();
      entries.push(await enqueueRepo(challengeId, repoId, i));
    }

    await pump();

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT id, status, assigned_room_id FROM queue_entries WHERE challenge_id = $1 ORDER BY position`,
      [challengeId],
    );
    const called = rows.filter((r: { status: string }) => r.status === "called");
    expect(called).toHaveLength(2); // one per room, from the single shared queue
    expect(new Set(called.map((r: { assigned_room_id: number }) => r.assigned_room_id)).size).toBe(
      2,
    );
    expect(rows[2].status).toBe("waiting");
  });

  it("skips paused rooms (H35) and inactive rooms", async () => {
    const challengeId = await createChallenge();
    const pausedRoom = await createRoom({ isPaused: true });
    const inactiveRoom = await createRoom({ status: "paused" });
    await assignChallengeToRoom(pausedRoom, challengeId);
    await assignChallengeToRoom(inactiveRoom, challengeId);
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);

    await pump();

    expect((await getEntry(entryId)).status).toBe("waiting");
  });

  it("honours the H30 member-busy guard and retries the team on a later tick", async () => {
    const ch1 = await createChallenge();
    const ch2 = await createChallenge();
    const room1 = await createRoom({ maxInWaitingArea: 1 });
    const room2 = await createRoom({ maxInWaitingArea: 1 });
    await assignChallengeToRoom(room1, ch1);
    await assignChallengeToRoom(room2, ch2);

    const shared = await createUser();
    const { repoId: rA } = await createRepoWithTeam([shared]);
    const { repoId: rB } = await createRepoWithTeam([shared]);
    const eA = await enqueueRepo(ch1, rA, 1);
    const eB = await enqueueRepo(ch2, rB, 1);

    await pump();

    // Exactly one of the two got called; the other kept its position.
    const statuses = [(await getEntry(eA)).status, (await getEntry(eB)).status].sort();
    expect(statuses).toEqual(["called", "waiting"]);

    // Finish the called one; the next tick picks up the blocked sibling.
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE queue_entries SET status = 'completed' WHERE status = 'called' AND id IN ($1, $2)`,
      [eA, eB],
    );
    await pump();
    const after = [(await getEntry(eA)).status, (await getEntry(eB)).status].sort();
    expect(after).toEqual(["called", "completed"]);
  });

  it("honours the call_count ladder: repeated no-shows sink below clean teams at equal position", async () => {
    const challengeId = await createChallenge();
    const roomId = await createRoom({ maxInWaitingArea: 1 });
    await assignChallengeToRoom(roomId, challengeId);

    const { repoId: rLadder } = await createRepoWithTeam();
    const { repoId: rClean } = await createRepoWithTeam();
    const eLadder = await enqueueRepo(challengeId, rLadder, 1);
    const eClean = await enqueueRepo(challengeId, rClean, 1); // same position: tie
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE queue_entries SET call_count = 2 WHERE id = $1`, [eLadder]);

    await pump();

    expect((await getEntry(eClean)).status).toBe("called"); // clean team wins the tie
    expect((await getEntry(eLadder)).status).toBe("waiting");
  });

  it("H38: emits the pre-call warning once when ETA <= threshold", async () => {
    const challengeId = await createChallenge();
    const roomId = await createRoom({ maxInWaitingArea: 0, desiredMinutesPerTeam: 5 });
    await assignChallengeToRoom(roomId, challengeId);
    const member = await createUser();
    const { repoId } = await createRepoWithTeam([member]);
    const entryId = await enqueueRepo(challengeId, repoId, 1); // rank 1 -> ETA 5min

    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE queue_settings SET pre_call_notification_eta_minutes = 10 WHERE id = 1`,
    );

    await pump();

    const entry = await getEntry(entryId);
    expect(entry.precalled_at).not.toBeNull();
    const outbox = await pool.query(
      `SELECT * FROM notification_outbox WHERE user_id = $1 AND category = 'queue'`,
      [member],
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0].payload.etaMinutes).toBeLessThanOrEqual(10);

    // second tick: no duplicate warning
    await pump();
    const again = await pool.query(
      `SELECT count(*)::int AS n FROM notification_outbox WHERE user_id = $1 AND category = 'queue'`,
      [member],
    );
    expect(again.rows[0].n).toBe(1);
  });

  it("does not pre-call teams far from the front (ETA above threshold)", async () => {
    const challengeId = await createChallenge();
    const roomId = await createRoom({ maxInWaitingArea: 0, desiredMinutesPerTeam: 10 });
    await assignChallengeToRoom(roomId, challengeId);
    const { repoId } = await createRepoWithTeam();
    await enqueueRepo(challengeId, repoId, 1);
    const { repoId: rFar } = await createRepoWithTeam();
    const farId = await enqueueRepo(challengeId, rFar, 5); // rank 2 -> ETA 20min > 10

    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE queue_settings SET pre_call_notification_eta_minutes = 10 WHERE id = 1`,
    );
    await pump();

    expect((await getEntry(farId)).precalled_at).toBeNull();
  });
});

describe("pump interplay with operators", () => {
  it("pump never overfills after a manual force-call above the cap (H29)", async () => {
    const challengeId = await createChallenge();
    const roomId = await createRoom({ maxInWaitingArea: 1 });
    await assignChallengeToRoom(roomId, challengeId);
    const operatorId = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
    const entries: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const { repoId } = await createRepoWithTeam();
      entries.push(await enqueueRepo(challengeId, repoId, i));
    }

    const { buildTestApp, asUser } = await import("../helpers.js");
    const app = await buildTestApp();
    try {
      // fill to cap, then force one more over the cap
      await pump();
      const forced = await app.inject({
        method: "POST",
        url: `/api/queue/rooms/${roomId}/call-next`,
        headers: asUser(operatorId),
        payload: { force: true },
      });
      expect(forced.statusCode).toBe(200);

      await pump(); // over cap already: must not call the third team
      expect((await getEntry(entries[2]!)).status).toBe("waiting");
    } finally {
      await app.close();
    }
  });
});
