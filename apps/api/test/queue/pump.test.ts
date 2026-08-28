import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createUser, createUserWithCapabilities, truncateAll } from "../helpers.js";
import {
  assignChallengeToRoom,
  assignQueueGroupToRoom,
  createChallenge,
  createEnterpriseChallenges,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
  getEntry,
  mergeChallengesIntoOneGroup,
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
  const { pool } = await import("../../src/db/pool.js");
  await pool.query(
    `UPDATE queue_settings
        SET schedule_start_at = NULL, schedule_end_at = NULL,
            pre_call_notification_eta_minutes = 10
      WHERE id = 1`,
  );
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

  it("skips H35-paused rooms but fills an explicitly resumed room", async () => {
    const challengeId = await createChallenge();
    const pausedRoom = await createRoom({ isPaused: true });
    // `rooms.status` is a legacy display field. The H35 queue-state pause is
    // the source of truth and the API derives active/paused from it.
    const liveRoom = await createRoom({ status: "paused" });
    await assignChallengeToRoom(pausedRoom, challengeId);
    await assignChallengeToRoom(liveRoom, challengeId);
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);

    await pump();

    const entry = await getEntry(entryId);
    expect(entry.status).toBe("called");
    expect(entry.assigned_room_id).toBe(liveRoom);
  });

  it("does not fill an H35-paused room even when it is the only option (H35)", async () => {
    const challengeId = await createChallenge();
    const pausedRoom = await createRoom({ isPaused: true });
    await assignChallengeToRoom(pausedRoom, challengeId);
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);

    await pump();

    expect((await getEntry(entryId)).status).toBe("waiting");
  });

  it("keeps pump and pre-call silent outside the judging window (#544)", async () => {
    const challengeId = await createChallenge();
    const roomId = await createRoom({ maxInWaitingArea: 1, desiredMinutesPerTeam: 5 });
    await assignChallengeToRoom(roomId, challengeId);
    const member = await createUser();
    const { repoId } = await createRepoWithTeam([member]);
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE queue_settings
          SET schedule_start_at = now() + interval '1 hour',
              schedule_end_at = now() + interval '2 hours',
              pre_call_notification_eta_minutes = 10
        WHERE id = 1`,
    );

    await pump();

    expect((await getEntry(entryId)).status).toBe("waiting");
    expect((await getEntry(entryId)).precalled_at).toBeNull();
    const outbox = await pool.query(
      `SELECT 1 FROM notification_outbox WHERE user_id = $1 AND category = 'queue'`,
      [member],
    );
    expect(outbox.rows).toHaveLength(0);
  });

  it("does not pre-call from a paused room (#544)", async () => {
    const challengeId = await createChallenge();
    const roomId = await createRoom({ isPaused: true, desiredMinutesPerTeam: 5 });
    await assignChallengeToRoom(roomId, challengeId);
    const member = await createUser();
    const { repoId } = await createRepoWithTeam([member]);
    const entryId = await enqueueRepo(challengeId, repoId, 1);

    await pump();

    expect((await getEntry(entryId)).precalled_at).toBeNull();
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
    // "queue" is mandatory (H51): notify() fans out to every default channel
    // (in_app, email, push), not just push.
    const outbox = await pool.query(
      `SELECT * FROM notification_outbox WHERE user_id = $1 AND category = 'queue'`,
      [member],
    );
    expect(outbox.rows.map((r) => r.channel).sort()).toEqual(["email", "in_app", "push"]);
    const push = outbox.rows.find((r) => r.channel === "push");
    expect(push.payload.etaMinutes).toBeLessThanOrEqual(10);
    expect(push.payload.template).toBe("queue.precall");
    const { valkey } = await import("../../src/lib/valkey.js");
    expect(await valkey.get(`sse:seq:user:${member}`)).toBe("1"); // immediate, not debounced

    // second tick: no duplicate warning
    await pump();
    const again = await pool.query(
      `SELECT count(*)::int AS n FROM notification_outbox WHERE user_id = $1 AND category = 'queue'`,
      [member],
    );
    expect(again.rows[0].n).toBe(3);
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

  it("pre-calls a merged repo once and claims only waiting siblings", async () => {
    const { challengeIds } = await createEnterpriseChallenges(2);
    const groupId = await mergeChallengesIntoOneGroup(challengeIds);
    const roomId = await createRoom({ maxInWaitingArea: 0, desiredMinutesPerTeam: 5 });
    await assignQueueGroupToRoom(roomId, groupId);
    const member = await createUser();
    const { repoId } = await createRepoWithTeam([member]);
    const first = await enqueueRepo(challengeIds[0]!, repoId, 1);
    const second = await enqueueRepo(challengeIds[1]!, repoId, 2);

    await pump();

    const { pool } = await import("../../src/db/pool.js");
    const outbox = await pool.query(
      `SELECT count(*)::int AS n
         FROM notification_outbox
        WHERE user_id = $1 AND category = 'queue'`,
      [member],
    );
    expect(outbox.rows[0].n).toBe(3);
    expect((await getEntry(first)).precalled_at).not.toBeNull();
    expect((await getEntry(second)).precalled_at).not.toBeNull();

    // An already-called sibling is not eligible for a second pre-call cycle,
    // and the claim must never advance a non-waiting row.
    await pool.query(
      `UPDATE queue_entries
          SET status = 'called', assigned_room_id = $2
        WHERE id = $1`,
      [first, roomId],
    );
    await pump();
    const after = await pool.query(
      `SELECT count(*)::int AS n
         FROM notification_outbox
        WHERE user_id = $1 AND category = 'queue'`,
      [member],
    );
    expect(after.rows[0].n).toBe(3);
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

describe("topUpRoom: immediate single-room refill (H29/H30/H35)", () => {
  it("refills a freed slot right away, without the periodic tick", async () => {
    const { topUpRoom } = await import("../../src/modules/queue/pump.js");
    const { bringIn } = await import("../../src/modules/queue/service.js");
    const challengeId = await createChallenge();
    const roomId = await createRoom({ maxInWaitingArea: 2 });
    await assignChallengeToRoom(roomId, challengeId);
    const entries: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const { repoId } = await createRepoWithTeam();
      entries.push(await enqueueRepo(challengeId, repoId, i));
    }

    await topUpRoom(roomId); // fills to cap: teams 1 & 2 called, team 3 waits
    expect((await getEntry(entries[0]!)).status).toBe("called");
    expect((await getEntry(entries[1]!)).status).toBe("called");
    expect((await getEntry(entries[2]!)).status).toBe("waiting");

    // Free a called slot by bringing team 1 in, then top up again — team 3 is
    // pulled in immediately (no pumpTick involved).
    const judge = await createUser();
    await bringIn(entries[0]!, judge);
    await topUpRoom(roomId);
    expect((await getEntry(entries[2]!)).status).toBe("called");
  });

  it("does not auto-fill a paused room", async () => {
    const { topUpRoom } = await import("../../src/modules/queue/pump.js");
    const challengeId = await createChallenge();
    const roomId = await createRoom({ maxInWaitingArea: 2, isPaused: true });
    await assignChallengeToRoom(roomId, challengeId);
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);

    await topUpRoom(roomId); // paused: ConflictError swallowed, nobody called
    expect((await getEntry(entryId)).status).toBe("waiting");
  });

  it("treats a room removed during lifecycle cleanup as a no-op", async () => {
    const { topUpRoom } = await import("../../src/modules/queue/pump.js");
    const roomId = await createRoom();
    const { pool } = await import("../../src/db/pool.js");

    await pool.query(`DELETE FROM rooms WHERE id = $1`, [roomId]);

    await expect(topUpRoom(roomId)).resolves.toBeUndefined();
  });

  it("bring-in via the route settles the immediate refill before a test response returns", async () => {
    const challengeId = await createChallenge();
    const roomId = await createRoom({ maxInWaitingArea: 2 });
    await assignChallengeToRoom(roomId, challengeId);
    const judgeId = await createUserWithCapabilities([CAPABILITIES.JUDGE_PANEL]);
    const entries: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const { repoId } = await createRepoWithTeam();
      entries.push(await enqueueRepo(challengeId, repoId, i));
    }

    const { buildTestApp, asUser } = await import("../helpers.js");
    const app = await buildTestApp();
    try {
      await pump(); // teams 1 & 2 called, team 3 waiting (cap 2)
      const res = await app.inject({
        method: "POST",
        url: `/api/queue/entries/${entries[0]!}/bring-in`,
        headers: asUser(judgeId),
      });
      expect(res.statusCode).toBe(200);

      // Test mode awaits scheduleTopUp, so the request cannot leave a refill
      // task running into the next fixture.
      expect((await getEntry(entries[2]!)).status).toBe("called");
    } finally {
      await app.close();
    }
  });
});
