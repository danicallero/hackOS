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
  getEntry,
  historyRows,
  roomRow,
} from "./fixtures.js";

/**
 * Queue state machine (H29-H35, H37): happy paths, explicit business errors,
 * ordering rules and the one-history-row + one-broadcast invariant (plan/07
 * invariant 5).
 */

let app: App;
let operatorId: number;
let judgeId: number;
let adminId: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  // queue_settings is the one table truncateAll preserves. Restore the
  // judging window so H29/H35's automatic refill cannot inherit a closed
  // window from another queue suite (H29, H35).
  const { pool } = await import("../../src/db/pool.js");
  await pool.query(
    `UPDATE queue_settings
        SET schedule_start_at = NULL, schedule_end_at = NULL
      WHERE id = 1`,
  );
  operatorId = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
  judgeId = await createUserWithCapabilities([CAPABILITIES.JUDGE_PANEL]);
  adminId = await createUserWithCapabilities([CAPABILITIES.QUEUE_ADMIN]);
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

async function setup() {
  app ??= await buildTestApp();
  const challengeId = await createChallenge();
  const roomId = await createRoom({ maxInWaitingArea: 2 });
  await assignChallengeToRoom(roomId, challengeId);
  return { challengeId, roomId };
}

describe("call_next (H29, H30)", () => {
  it("calls the first waiting team, notifies members, one history row + one queue broadcast", async () => {
    const { challengeId, roomId } = await setup();
    const member = await createUser();
    const { repoId } = await createRepoWithTeam([member]);
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    const { repoId: repo2 } = await createRepoWithTeam();
    await enqueueRepo(challengeId, repo2, 2);

    const before = await broadcastCount("queue");
    const res = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().called).toBe(true);
    expect(res.json().entry.id).toBe(entryId);

    const entry = await getEntry(entryId);
    expect(entry.status).toBe("called");
    expect(entry.assigned_room_id).toBe(roomId);
    expect(entry.called_at).not.toBeNull(); // H34: UIs compute elapsed from called_at

    const history = await historyRows(entryId);
    expect(history).toHaveLength(1);
    expect(history[0].action).toBe("call_next");
    expect(history[0].actor_id).toBe(operatorId);

    expect(await broadcastCount("queue")).toBe(before + 1);
    // per-user "go wait at room X" (H29/H38)
    // The direct call notice is immediate; the challenge-scoped H38 read-model
    // signal is coalesced and fanned out by its worker (#544).
    expect(await broadcastCount(`user:${member}`)).toBe(1);
    const { pool } = await import("../../src/db/pool.js");
    const outbox = await pool.query(
      `SELECT * FROM notification_outbox WHERE user_id = $1 AND category = 'queue' AND channel = 'push'`,
      [member],
    );
    expect(outbox.rows).toHaveLength(1);
  });

  it("also lands a readable row in the member's inbox (in_app), not just push", async () => {
    const { challengeId, roomId } = await setup();
    const member = await createUser();
    const { repoId } = await createRepoWithTeam([member]);
    await enqueueRepo(challengeId, repoId, 1);

    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });

    const { pool } = await import("../../src/db/pool.js");
    const inbox = await pool.query(
      `SELECT * FROM notification_outbox WHERE user_id = $1 AND category = 'queue' AND channel = 'in_app'`,
      [member],
    );
    expect(inbox.rows).toHaveLength(1);
    // Pre-rendered so the inbox UI (payload.subject/body) shows real text,
    // not a blank item — see notify()'s withInboxRendering.
    expect(inbox.rows[0].payload.subject).toBeTruthy();
    expect(inbox.rows[0].payload.body).toContain((await roomRow(roomId)).name);

    const room = await roomRow(roomId);
    expect(inbox.rows[0].payload.roomName).toBe(room.name);

    const memberRes = await app.inject({
      method: "GET",
      url: "/api/me/notifications",
      headers: asUser(member),
    });
    expect(memberRes.statusCode).toBe(200);
    expect(memberRes.json().items).toHaveLength(1);
  });

  it("respects max_in_waiting_area (409 when full) and force overrides it", async () => {
    const { challengeId, roomId } = await setup();
    for (let i = 1; i <= 3; i++) {
      const { repoId } = await createRepoWithTeam();
      await enqueueRepo(challengeId, repoId, i);
    }
    const call = () =>
      app.inject({
        method: "POST",
        url: `/api/queue/rooms/${roomId}/call-next`,
        headers: asUser(operatorId),
        payload: {},
      });
    expect((await call()).statusCode).toBe(200);
    expect((await call()).statusCode).toBe(200);
    const full = await call();
    expect(full.statusCode).toBe(409); // waiting area full

    const forced = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: { force: true },
    });
    expect(forced.statusCode).toBe(200);
    expect(forced.json().called).toBe(true);
  });

  it("H30: skips the same project in another challenge while it is called elsewhere", async () => {
    const { challengeId, roomId } = await setup();
    const challenge2 = await createChallenge();
    const room2 = await createRoom({ maxInWaitingArea: 1 });
    await assignChallengeToRoom(room2, challenge2);

    const { repoId } = await createRepoWithTeam();
    const firstEntry = await enqueueRepo(challengeId, repoId, 1);
    const secondEntry = await enqueueRepo(challenge2, repoId, 1);

    const first = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().entry.id).toBe(firstEntry);

    const second = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${room2}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().called).toBe(false);

    expect((await getEntry(firstEntry)).status).toBe("called");
    expect((await getEntry(secondEntry)).status).toBe("waiting");
  });

  it("H30: skips a team with a member busy in another room WITHOUT losing its position", async () => {
    const { challengeId: ch1, roomId: room1 } = await setup();
    const ch2 = await createChallenge();
    const room2 = await createRoom();
    await assignChallengeToRoom(room2, ch2);

    const sharedMember = await createUser();
    const { repoId: repoA } = await createRepoWithTeam([sharedMember]);
    const { repoId: repoB } = await createRepoWithTeam([sharedMember, await createUser()]);
    const { repoId: repoC } = await createRepoWithTeam();

    const entryA = await enqueueRepo(ch1, repoA, 1);
    const entryB = await enqueueRepo(ch2, repoB, 1); // same person, other challenge
    const entryC = await enqueueRepo(ch2, repoC, 2);

    // repoA gets called in room1 -> sharedMember is busy
    const first = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${room1}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    expect(first.json().entry.id).toBe(entryA);

    // room2 must skip repoB (blocked) and call repoC instead
    const second = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${room2}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    expect(second.json().entry.id).toBe(entryC);

    const b = await getEntry(entryB);
    expect(b.status).toBe("waiting");
    expect(b.position).toBe(1); // did not lose its queue position
    expect(await historyRows(entryB)).toHaveLength(0); // skipping is silent

    // once repoA finishes its cycle the pump/operator can call repoB again
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE queue_entries SET status = 'completed' WHERE id = $1`, [entryA]);
    const third = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${room2}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    expect(third.json().entry.id).toBe(entryB);
  });

  it("H30: treats linked Devpost participants as members even when submissions is missing", async () => {
    const { challengeId: ch1, roomId: room1 } = await setup();
    const ch2 = await createChallenge();
    const room2 = await createRoom();
    await assignChallengeToRoom(room2, ch2);

    const sharedMember = await createUser({ email: "linked-member@test.local" });
    const { pool } = await import("../../src/db/pool.js");
    const activeRepo = (
      await pool.query(`INSERT INTO repos (name) VALUES ('Devpost active') RETURNING id`)
    ).rows[0].id;
    const waitingRepo = (
      await pool.query(`INSERT INTO repos (name) VALUES ('Devpost waiting') RETURNING id`)
    ).rows[0].id;
    for (const repoId of [activeRepo, waitingRepo]) {
      await pool.query(
        `INSERT INTO devpost_participants
           (repo_id, email, user_id, import_batch, merge_status)
         VALUES ($1, 'linked-member@test.local', $2, 'test-import', 'manually_linked')`,
        [repoId, sharedMember],
      );
    }

    const activeEntry = await enqueueRepo(ch1, activeRepo, 1);
    const waitingEntry = await enqueueRepo(ch2, waitingRepo, 1);
    const first = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${room1}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    expect(first.json().entry.id).toBe(activeEntry);

    const second = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${room2}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    expect(second.json().called).toBe(false);
    expect((await getEntry(waitingEntry)).status).toBe("waiting");

    const view = await app.inject({
      method: "GET",
      url: `/api/queue/rooms/${room2}/view`,
      headers: asUser(operatorId),
    });
    expect(view.json().crossRoomSkips).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entryId: waitingEntry, blockingRoomId: room1 }),
      ]),
    );
  });

  it("H203: room view explains a cross-room skip, preserves position, and clears once the blocker leaves", async () => {
    const { challengeId: ch1, roomId: room1 } = await setup();
    const ch2 = await createChallenge();
    const room2 = await createRoom({ name: "Room 2" });
    await assignChallengeToRoom(room2, ch2);

    const sharedMember = await createUser();
    const { repoId: repoA } = await createRepoWithTeam([sharedMember]);
    const { repoId: repoB } = await createRepoWithTeam([sharedMember, await createUser()]);

    const entryA = await enqueueRepo(ch1, repoA, 1);
    const entryB = await enqueueRepo(ch2, repoB, 1);

    // repoA gets called in room1 -> sharedMember is busy there
    const first = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${room1}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    expect(first.json().entry.id).toBe(entryA);

    const view = await app.inject({
      method: "GET",
      url: `/api/queue/rooms/${room2}/view`,
      headers: asUser(operatorId),
    });
    expect(view.statusCode).toBe(200);
    const skip = view.json().crossRoomSkips.find((s: { entryId: number }) => s.entryId === entryB);
    expect(skip).toMatchObject({
      entryId: entryB,
      position: 1,
      blockingRoomId: room1,
      positionPreserved: true,
    });
    expect(skip.blockingRoomName).toBeTruthy();
    expect(skip.blockingTeamName).toBeTruthy();
    expect((await getEntry(entryB)).position).toBe(1); // unchanged

    // The public TV feed must never leak this projection.
    const tv = await app.inject({ method: "GET", url: "/api/tv/rooms" });
    expect(tv.statusCode).toBe(200);
    for (const room of tv.json()) expect(room.crossRoomSkips).toEqual([]);

    // Once the blocking entry leaves called/in_room/presenting, the skip clears.
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE queue_entries SET status = 'completed' WHERE id = $1`, [entryA]);

    const cleared = await app.inject({
      method: "GET",
      url: `/api/queue/rooms/${room2}/view`,
      headers: asUser(operatorId),
    });
    expect(cleared.json().crossRoomSkips).toEqual([]);
  });

  it("409 when the room is paused, 403 without QUEUE_OPERATE", async () => {
    const { roomId } = await setup();
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE room_queue_state SET is_paused = true WHERE room_id = $1`, [roomId]);
    const res = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    expect(res.statusCode).toBe(409);

    const forbidden = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(judgeId),
      payload: {},
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe("notify_enter (H31)", () => {
  it("writes exactly one history row and one queue broadcast without changing status", async () => {
    const { challengeId, roomId } = await setup();
    const member = await createUser();
    const { repoId } = await createRepoWithTeam([member]);
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });

    const before = await broadcastCount("queue");
    const res = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/notify-enter`,
      headers: asUser(judgeId),
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    const entry = await getEntry(entryId);
    expect(entry.status).toBe("called"); // no transition
    const history = await historyRows(entryId, "notify_enter");
    expect(history).toHaveLength(1);
    expect(history[0].previous_status).toBe("called");
    expect(history[0].new_status).toBe("called");
    expect(await broadcastCount("queue")).toBe(before + 1);

    // H31: "que entre" also reaches the inbox (in_app), same as the initial call.
    const { pool } = await import("../../src/db/pool.js");
    const inbox = await pool.query(
      `SELECT * FROM notification_outbox WHERE user_id = $1 AND category = 'queue' AND channel = 'in_app' AND payload->>'type' = 'notify_enter'`,
      [member],
    );
    expect(inbox.rows).toHaveLength(1);
    expect(inbox.rows[0].payload.subject).toBeTruthy();
    expect(inbox.rows[0].payload.roomId).toBe(roomId);
  });

  it("reminds a called team to wait without asking it to enter", async () => {
    const { challengeId, roomId } = await setup();
    const member = await createUser();
    const { repoId } = await createRepoWithTeam([member]);
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });

    const { pool } = await import("../../src/db/pool.js");
    const before = await pool.query(
      `SELECT count(*)::int AS count FROM notification_outbox
        WHERE user_id = $1 AND category = 'queue' AND channel = 'in_app'
          AND payload->>'template' = 'queue.called'`,
      [member],
    );
    const broadcastBefore = await broadcastCount("queue");
    const res = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/remind-waiting`,
      headers: asUser(operatorId),
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect((await getEntry(entryId)).status).toBe("called");
    expect(await historyRows(entryId, "remind_waiting_room")).toHaveLength(1);
    expect(await broadcastCount("queue")).toBe(broadcastBefore + 1);

    const after = await pool.query(
      `SELECT count(*)::int AS count FROM notification_outbox
        WHERE user_id = $1 AND category = 'queue' AND channel = 'in_app'
          AND payload->>'template' = 'queue.called'`,
      [member],
    );
    expect(after.rows[0].count).toBe(before.rows[0].count + 1);
    expect(after.rows[0].count).toBe(2);
  });

  it("pushes the room-entry alert only to staff who explicitly opted in", async () => {
    const { challengeId, roomId } = await setup();
    const subscribedStaff = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
    const unsubscribedStaff = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
    const member = await createUser();
    const { repoId } = await createRepoWithTeam([member], "Equipo Colaborador");
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `INSERT INTO notification_preferences (user_id, category, channel, enabled)
       VALUES ($1, 'queue.staff', 'push', true)`,
      [subscribedStaff],
    );

    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/notify-enter`,
      headers: asUser(judgeId),
      payload: {},
    });
    expect(response.statusCode).toBe(200);

    const alerts = await pool.query(
      `SELECT user_id, payload FROM notification_outbox
        WHERE category = 'queue.staff' AND channel = 'push'
          AND payload->>'template' = 'queue.staff.enter'
        ORDER BY user_id`,
    );
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0].user_id).toBe(subscribedStaff);
    expect(alerts.rows[0].payload.template).toBe("queue.staff.enter");
    expect(alerts.rows[0].payload.vars.teamName).toBe("Equipo Colaborador");
    expect(alerts.rows.some((row: { user_id: number }) => row.user_id === unsubscribedStaff)).toBe(
      false,
    );
  });

  it("pushes an opt-in staff alert when a team is called (H29)", async () => {
    const { challengeId, roomId } = await setup();
    const subscribedStaff = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
    const unsubscribedStaff = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
    const member = await createUser();
    const { repoId } = await createRepoWithTeam([member], "Equipo Llamado");
    await enqueueRepo(challengeId, repoId, 1);
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `INSERT INTO notification_preferences (user_id, category, channel, enabled)
       VALUES ($1, 'queue.staff', 'push', true)`,
      [subscribedStaff],
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    expect(response.statusCode).toBe(200);

    const alerts = await pool.query(
      `SELECT user_id, payload FROM notification_outbox
        WHERE category = 'queue.staff' AND channel = 'push'
          AND payload->>'template' = 'queue.staff.called'
        ORDER BY user_id`,
    );
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0].user_id).toBe(subscribedStaff);
    expect(alerts.rows[0].payload.vars.teamName).toBe("Equipo Llamado");
    expect(alerts.rows.some((row: { user_id: number }) => row.user_id === unsubscribedStaff)).toBe(
      false,
    );
  });

  it("409 from waiting", async () => {
    const { challengeId } = await setup();
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    const res = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/notify-enter`,
      headers: asUser(judgeId),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("bring_in / start / complete (H32)", () => {
  it("lists waiting-room teams FIFO while allowing judges to bring in a newer team manually", async () => {
    const { challengeId, roomId } = await setup();
    // Keep the automatic H29 pump out of this setup: the point here is the
    // ordering of teams explicitly called into the waiting area.
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE room_queue_state SET is_paused = true WHERE room_id = $1`, [roomId]);
    const { repoId: firstRepo } = await createRepoWithTeam();
    const { repoId: secondRepo } = await createRepoWithTeam();
    const first = await enqueueRepo(challengeId, firstRepo, 10);
    const second = await enqueueRepo(challengeId, secondRepo, 1);

    for (const entryId of [first, second]) {
      const res = await app.inject({
        method: "POST",
        url: `/api/queue/entries/${entryId}/manual-call`,
        headers: asUser(operatorId),
        payload: { targetStatus: "called", roomId },
      });
      expect(res.statusCode).toBe(200);
    }

    // Position differs from waiting-room arrival order: first was called first.
    await pool.query(
      `UPDATE queue_entries SET called_at = now() - interval '1 minute' WHERE id = $1`,
      [first],
    );
    await pool.query(`UPDATE queue_entries SET called_at = now() WHERE id = $1`, [second]);
    const view = await app.inject({
      method: "GET",
      url: `/api/queue/rooms/${roomId}/view`,
      headers: asUser(judgeId),
    });
    expect(view.statusCode).toBe(200);
    expect(view.json().called.map((entry: { id: number }) => entry.id)).toEqual([first, second]);

    // FIFO is the normal order, but a judge can override it for an operational need.
    const override = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${second}/bring-in`,
      headers: asUser(judgeId),
      payload: {},
    });
    expect(override.statusCode).toBe(200);
  });

  it("walks the full happy path with one history row per action", async () => {
    const { challengeId, roomId } = await setup();
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });

    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE queue_entries SET precalled_at = now() WHERE id = $1`, [entryId]);

    const bringIn = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/bring-in`,
      headers: asUser(judgeId),
      payload: {},
    });
    expect(bringIn.statusCode).toBe(200);
    let transitioned = await getEntry(entryId);
    expect(transitioned.status).toBe("in_room");
    expect(transitioned.presentation_started_at).toBeNull(); // clock NOT running yet
    expect(transitioned.precalled_at).toBeNull();

    // Each H32 stage must start with a fresh pre-call cycle, even if a stale
    // marker was left behind by a worker or fixture before the transition.
    await pool.query(`UPDATE queue_entries SET precalled_at = now() WHERE id = $1`, [entryId]);

    const start = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/start`,
      headers: asUser(judgeId),
      payload: {},
    });
    expect(start.statusCode).toBe(200);
    transitioned = await getEntry(entryId);
    expect(transitioned.status).toBe("presenting");
    expect(transitioned.presentation_started_at).not.toBeNull();
    expect(transitioned.precalled_at).toBeNull();

    await pool.query(`UPDATE queue_entries SET precalled_at = now() WHERE id = $1`, [entryId]);

    const complete = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/complete`,
      headers: asUser(judgeId),
      payload: {},
    });
    expect(complete.statusCode).toBe(200);
    transitioned = await getEntry(entryId);
    expect(transitioned.status).toBe("completed");
    expect(transitioned.completed_at).not.toBeNull();
    expect(transitioned.precalled_at).toBeNull();

    const history = await historyRows(entryId);
    expect(history.map((h: { action: string }) => h.action)).toEqual([
      "call_next",
      "bring_in",
      "start",
      "complete",
    ]);
  });

  it("start from called is a 409 (separate buttons are deliberate, H32)", async () => {
    const { challengeId, roomId } = await setup();
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/start`,
      headers: asUser(judgeId),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
  });

  it("second team cannot be brought into an occupied room (one_active_per_room -> 409)", async () => {
    const { challengeId, roomId } = await setup();
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
    await app.inject({
      method: "POST",
      url: `/api/queue/entries/${e1}/bring-in`,
      headers: asUser(judgeId),
      payload: {},
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${e2}/bring-in`,
      headers: asUser(judgeId),
      payload: {},
    });
    expect(second.statusCode).toBe(409);
  });
});

describe("send_back / requeue / re_enter (H33)", () => {
  it("send_back: in_room -> called at the TOP of the queue", async () => {
    const { challengeId, roomId } = await setup();
    const { repoId: r1 } = await createRepoWithTeam();
    const { repoId: r2 } = await createRepoWithTeam();
    const e1 = await enqueueRepo(challengeId, r1, 1);
    await enqueueRepo(challengeId, r2, 2);
    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/api/queue/entries/${e1}/bring-in`,
      headers: asUser(judgeId),
      payload: {},
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${e1}/send-back`,
      headers: asUser(judgeId),
      payload: { reason: "demo rota" },
    });
    expect(res.statusCode).toBe(200);
    const entry = await getEntry(e1);
    expect(entry.status).toBe("called");
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT MIN(position) AS min FROM queue_entries WHERE challenge_id = $1`,
      [challengeId],
    );
    expect(entry.position).toBe(rows[0].min); // top
  });

  it("send_back: forbidden for a queue operator, allowed for the room's judge (#59)", async () => {
    const { challengeId, roomId } = await setup();
    const { repoId: r1 } = await createRepoWithTeam();
    const { repoId: r2 } = await createRepoWithTeam();
    const e1 = await enqueueRepo(challengeId, r1, 1);
    await enqueueRepo(challengeId, r2, 2);
    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/api/queue/entries/${e1}/bring-in`,
      headers: asUser(judgeId),
      payload: {},
    });

    // Queue Operations view (QUEUE_OPERATE only) must not re-queue a team that
    // already reached the room — that restriction stays in place.
    const operatorRes = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${e1}/send-back`,
      headers: asUser(operatorId),
      payload: { reason: "no procede" },
    });
    expect(operatorRes.statusCode).toBe(403);
    expect(await getEntry(e1).then((e) => e.status)).toBe("in_room");

    // Judging Panel keeps the "Re-queue to Waiting Room" action.
    const judgeRes = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${e1}/send-back`,
      headers: asUser(judgeId),
      payload: { reason: "reevaluar despues" },
    });
    expect(judgeRes.statusCode).toBe(200);
    expect(await getEntry(e1).then((e) => e.status)).toBe("called");
  });

  it("requeue: called -> waiting honouring top|bottom; cannot requeue in_room straight to waiting", async () => {
    const { challengeId, roomId } = await setup();
    const { repoId: r1 } = await createRepoWithTeam();
    const { repoId: r2 } = await createRepoWithTeam();
    const e1 = await enqueueRepo(challengeId, r1, 1);
    await enqueueRepo(challengeId, r2, 2);
    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });

    const bottom = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${e1}/requeue`,
      headers: asUser(operatorId),
      payload: { position: "bottom" },
    });
    expect(bottom.statusCode).toBe(200);
    // The requeue result is the response body; the freed slot is then
    // auto-refilled (H29), so re-reading the row could already show it re-called.
    const entry = bottom.json();
    expect(entry.status).toBe("waiting");
    expect(entry.assigned_room_id).toBeNull();
    expect(entry.called_at).toBeNull();
    expect(entry.call_count).toBe(0); // voluntary requeue: no no-show penalty
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT MAX(position) AS max FROM queue_entries WHERE challenge_id = $1`,
      [challengeId],
    );
    expect(entry.position).toBe(rows[0].max);

    // plan/07 §4: in_room cannot be reinjected to waiting without passing through called
    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    const e2 = (
      await pool.query(
        `SELECT id FROM queue_entries WHERE challenge_id = $1 AND status = 'called'`,
        [challengeId],
      )
    ).rows[0].id;
    await app.inject({
      method: "POST",
      url: `/api/queue/entries/${e2}/bring-in`,
      headers: asUser(judgeId),
      payload: {},
    });
    const invalid = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${e2}/requeue`,
      headers: asUser(operatorId),
      payload: { position: "top" },
    });
    expect(invalid.statusCode).toBe(409);
  });

  it("re_enter recovers a completed team, requires a reason, and is audited", async () => {
    const { challengeId } = await setup();
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE queue_entries SET status = 'completed', completed_at = now() WHERE id = $1`,
      [entryId],
    );

    const missingReason = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/re-enter`,
      headers: asUser(operatorId),
      payload: { position: "top" },
    });
    expect(missingReason.statusCode).toBe(400);

    const res = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/re-enter`,
      headers: asUser(operatorId),
      payload: { position: "top", reason: "equipo olvidado" },
    });
    expect(res.statusCode).toBe(200);
    const entry = await getEntry(entryId);
    expect(entry.status).toBe("waiting");
    expect(entry.completed_at).toBeNull();

    const auditRows = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'queue_entry' AND entity_id = $1 AND action = 're_enter'`,
      [String(entryId)],
    );
    expect(auditRows.rows).toHaveLength(1);
    expect(auditRows.rows[0].reason).toBe("equipo olvidado");
  });
});

describe("no_show / skip / disqualify (H34)", () => {
  it("no_show is a human decision: sends to the END and raises the call_count ladder", async () => {
    const { challengeId, roomId } = await setup();
    const { repoId: r1 } = await createRepoWithTeam();
    const { repoId: r2 } = await createRepoWithTeam();
    const e1 = await enqueueRepo(challengeId, r1, 1);
    await enqueueRepo(challengeId, r2, 2);
    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });

    // judges can no-show from their view too (H34)
    const res = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${e1}/no-show`,
      headers: asUser(judgeId),
      payload: { reason: "no aparece" },
    });
    expect(res.statusCode).toBe(200);
    // Read the transition result from the response: the freed slot is then
    // auto-refilled (H29), which — as the only room here — may immediately
    // re-call this same team; the no_show transition itself sent it to waiting.
    const entry = res.json();
    expect(entry.status).toBe("waiting"); // never eliminated
    expect(entry.call_count).toBe(1); // ladder
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT MAX(position) AS max FROM queue_entries WHERE challenge_id = $1`,
      [challengeId],
    );
    expect(entry.position).toBe(rows[0].max); // end of the challenge queue

    const history = await historyRows(e1, "no_show");
    expect(history).toHaveLength(1);
    expect(history[0].metadata.callCount).toBe(1);
  });

  it("skip sends to the end WITHOUT ladder penalty", async () => {
    const { challengeId } = await setup();
    const { repoId: r1 } = await createRepoWithTeam();
    const { repoId: r2 } = await createRepoWithTeam();
    const e1 = await enqueueRepo(challengeId, r1, 1);
    await enqueueRepo(challengeId, r2, 2);

    const res = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${e1}/skip`,
      headers: asUser(judgeId),
      payload: { reason: "lo pidió el equipo" },
    });
    expect(res.statusCode).toBe(200);
    const entry = await getEntry(e1);
    expect(entry.call_count).toBe(0);
    expect(entry.status).toBe("waiting");
  });

  it("disqualify is manual, admin-only, audited, and terminal", async () => {
    const { challengeId } = await setup();
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);

    const notAdmin = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/disqualify`,
      headers: asUser(operatorId),
      payload: { reason: "reiterados no-shows" },
    });
    expect(notAdmin.statusCode).toBe(403);

    const res = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/disqualify`,
      headers: asUser(adminId),
      payload: { reason: "reiterados no-shows" },
    });
    expect(res.statusCode).toBe(200);
    expect((await getEntry(entryId)).status).toBe("disqualified");

    const { pool } = await import("../../src/db/pool.js");
    const auditRows = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'queue_entry' AND entity_id = $1 AND action = 'disqualify'`,
      [String(entryId)],
    );
    expect(auditRows.rows).toHaveLength(1);

    const again = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/disqualify`,
      headers: asUser(adminId),
      payload: { reason: "x" },
    });
    expect(again.statusCode).toBe(409);
  });

  it("exposes the per-entry history endpoint (H34)", async () => {
    app ??= await buildTestApp();
    const challengeId = await createChallenge();
    // cap 1 + a second team so the auto-refill after no-show pulls the OTHER
    // team, leaving this entry's history at exactly [call_next, no_show].
    const roomId = await createRoom({ maxInWaitingArea: 1 });
    await assignChallengeToRoom(roomId, challengeId);
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    const { repoId: repo2 } = await createRepoWithTeam();
    await enqueueRepo(challengeId, repo2, 2);
    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/no-show`,
      headers: asUser(operatorId),
      payload: {},
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/queue/entries/${entryId}/history`,
      headers: asUser(operatorId),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.map((h: { action: string }) => h.action)).toEqual(["call_next", "no_show"]);
  });
});

describe("manual call (H37)", () => {
  it("calls ANY waiting team directly to in_room regardless of position, audited", async () => {
    const { challengeId, roomId } = await setup();
    const { repoId: r1 } = await createRepoWithTeam();
    const { repoId: r2 } = await createRepoWithTeam();
    await enqueueRepo(challengeId, r1, 1);
    const e2 = await enqueueRepo(challengeId, r2, 99); // way down the queue
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE queue_entries SET precalled_at = now() WHERE id = $1`, [e2]);

    const res = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${e2}/manual-call`,
      headers: asUser(judgeId),
      payload: { targetStatus: "in_room", roomId, reason: "fuera de guion" },
    });
    expect(res.statusCode).toBe(200);
    const entry = await getEntry(e2);
    expect(entry.status).toBe("in_room");
    expect(entry.assigned_room_id).toBe(roomId);
    expect(entry.precalled_at).toBeNull();

    const auditRows = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'queue_entry' AND entity_id = $1 AND action = 'manual_call'`,
      [String(e2)],
    );
    expect(auditRows.rows).toHaveLength(1);
  });

  it("rejects a room from another queue and invalid source states", async () => {
    const { challengeId, roomId } = await setup();
    const foreignChallenge = await createChallenge();
    const foreignRoom = await createRoom();
    await assignChallengeToRoom(foreignRoom, foreignChallenge);
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    const { pool } = await import("../../src/db/pool.js");

    const wrongRoom = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/manual-call`,
      headers: asUser(judgeId),
      payload: { targetStatus: "called", roomId: foreignRoom },
    });
    expect(wrongRoom.statusCode).toBe(409);
    expect((await getEntry(entryId)).status).toBe("waiting");

    await pool.query(
      `UPDATE queue_entries SET status = 'completed', completed_at = now() WHERE id = $1`,
      [entryId],
    );
    const terminal = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/manual-call`,
      headers: asUser(judgeId),
      payload: { targetStatus: "in_room", roomId },
    });
    expect(terminal.statusCode).toBe(409);
  });

  it("does not bring a called team into a different room", async () => {
    const { challengeId, roomId } = await setup();
    const otherRoom = await createRoom();
    await assignChallengeToRoom(otherRoom, challengeId);
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);

    const called = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/manual-call`,
      headers: asUser(judgeId),
      payload: { targetStatus: "called", roomId },
    });
    expect(called.statusCode).toBe(200);

    const moved = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/manual-call`,
      headers: asUser(judgeId),
      payload: { targetStatus: "in_room", roomId: otherRoom },
    });
    expect(moved.statusCode).toBe(409);
    expect((await getEntry(entryId)).assigned_room_id).toBe(roomId);
  });

  it("manual call to in_room respects one-active-per-room and the H30 guard", async () => {
    const { challengeId, roomId } = await setup();
    const ch2 = await createChallenge();
    const room2 = await createRoom();
    await assignChallengeToRoom(room2, ch2);

    const shared = await createUser();
    const { repoId: rA } = await createRepoWithTeam([shared]);
    const { repoId: rB } = await createRepoWithTeam([shared]);
    const eA = await enqueueRepo(challengeId, rA, 1);
    const eB = await enqueueRepo(ch2, rB, 1);

    await app.inject({
      method: "POST",
      url: `/api/queue/entries/${eA}/manual-call`,
      headers: asUser(operatorId),
      payload: { targetStatus: "in_room", roomId },
    });

    const alreadyEvaluating = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${eA}/manual-call`,
      headers: asUser(operatorId),
      payload: { targetStatus: "called", roomId: room2 },
    });
    expect(alreadyEvaluating.statusCode).toBe(409);

    // H30: same member busy elsewhere
    const blocked = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${eB}/manual-call`,
      headers: asUser(operatorId),
      payload: { targetStatus: "called", roomId: room2 },
    });
    expect(blocked.statusCode).toBe(409);

    // one_active_per_room: another team into the occupied room
    const { repoId: rC } = await createRepoWithTeam();
    const eC = await enqueueRepo(challengeId, rC, 2);
    const occupied = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${eC}/manual-call`,
      headers: asUser(operatorId),
      payload: { targetStatus: "in_room", roomId },
    });
    expect(occupied.statusCode).toBe(409);
  });
});

describe("move_to_top (H37, H58)", () => {
  it("sends a waiting team to the TOP of its challenge queue", async () => {
    const { challengeId, roomId } = await setup();
    // An active room immediately fills its waiting area (H29), which would
    // legitimately call the moved entry before its queue position is read.
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE room_queue_state SET is_paused = true WHERE room_id = $1`, [roomId]);
    const { repoId: r1 } = await createRepoWithTeam();
    const { repoId: r2 } = await createRepoWithTeam();
    const e1 = await enqueueRepo(challengeId, r1, 1);
    const e2 = await enqueueRepo(challengeId, r2, 50);

    const res = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${e2}/move-top`,
      headers: asUser(operatorId),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    void roomId;

    const moved = await getEntry(e2);
    expect(moved.status).toBe("waiting");
    const other = await getEntry(e1);
    expect(moved.position).toBeLessThan(other.position);
  });

  it("calls a team moved to the top when its room has an open waiting-room slot", async () => {
    const { challengeId, roomId } = await setup();
    const { repoId: r1 } = await createRepoWithTeam();
    const { repoId: r2 } = await createRepoWithTeam();
    await enqueueRepo(challengeId, r1, 1);
    const movedEntry = await enqueueRepo(challengeId, r2, 50);

    const res = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${movedEntry}/move-top`,
      headers: asUser(operatorId),
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    const moved = await getEntry(movedEntry);
    expect(moved.status).toBe("called");
    expect(moved.assigned_room_id).toBe(roomId);
  });

  // A called entry can be explicitly moved out of its own waiting room by the
  // operator. H58 still blocks the same action when another entry for the team
  // is active in a different room (covered below).
  it("moves a called team out of its own waiting room when prioritised", async () => {
    const { challengeId, roomId } = await setup();
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeId, repoId, 1);

    // Team is called into its room's waiting area.
    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${entryId}/move-top`,
      headers: asUser(judgeId),
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    const entry = await getEntry(entryId);
    // The route tops up the room after the reorder, so an open slot may call
    // the same entry again immediately. The queue position/history still prove
    // that the explicit move happened.
    expect(entry.status).toBe("called");
    expect(entry.assigned_room_id).toBe(roomId);
    expect(await historyRows(entryId, "move_to_top")).toHaveLength(1);
  });

  it("lets a judge move a called waiting-room team to an explicit position", async () => {
    const { challengeId, roomId } = await setup();
    const { repoId: r1 } = await createRepoWithTeam();
    const { repoId: r2 } = await createRepoWithTeam();
    const { repoId: r3 } = await createRepoWithTeam();
    const e1 = await enqueueRepo(challengeId, r1, 1);
    await enqueueRepo(challengeId, r2, 2);
    await enqueueRepo(challengeId, r3, 3);

    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/call-next`,
      headers: asUser(operatorId),
      payload: {},
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${e1}/move-to`,
      headers: asUser(judgeId),
      payload: { position: 3, reason: "Judge reordered the waiting room" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("waiting");
    expect(res.json().position).toBe(3);
    expect(res.json().assigned_room_id).toBeNull();
    expect(await historyRows(e1, "move_to_position")).toHaveLength(1);
  });

  // H58: the same repo is active in another room via a DIFFERENT challenge —
  // move_to_top of its waiting entry here is still blocked.
  it("blocks when the repo is active in another room for a different challenge", async () => {
    const { challengeId, roomId } = await setup();
    const ch2 = await createChallenge();
    const room2 = await createRoom({ name: "Sala Mars" });
    await assignChallengeToRoom(room2, ch2);

    const { repoId } = await createRepoWithTeam();
    const waitingHere = await enqueueRepo(challengeId, repoId, 5);
    const activeElsewhere = await enqueueRepo(ch2, repoId, 1);
    void roomId;

    // The repo gets brought into room2 through challenge 2. Being merely
    // called in another room is not an evaluation lock; in_room is.
    await app.inject({
      method: "POST",
      url: `/api/queue/entries/${activeElsewhere}/manual-call`,
      headers: asUser(operatorId),
      payload: { targetStatus: "in_room", roomId: room2 },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/queue/entries/${waitingHere}/move-top`,
      headers: asUser(operatorId),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toBe("Busy in Sala Mars");

    const entry = await getEntry(waitingHere);
    expect(entry.status).toBe("waiting");
    expect(entry.position).toBe(5); // untouched
  });
});

describe("pause / resume (H35)", () => {
  it("pause reinjects called entries to the TOP as waiting, longest-called first; in_room finishes normally", async () => {
    const { challengeId, roomId } = await setup();
    const repos = [];
    for (let i = 1; i <= 4; i++) {
      const { repoId } = await createRepoWithTeam();
      repos.push(await enqueueRepo(challengeId, repoId, i));
    }
    const call = () =>
      app.inject({
        method: "POST",
        url: `/api/queue/rooms/${roomId}/call-next`,
        headers: asUser(operatorId),
        payload: { force: true },
      });
    await call(); // e1 called first (longest-called)
    await call(); // e2
    await call(); // e3
    // bring e1 in: it must finish normally
    await app.inject({
      method: "POST",
      url: `/api/queue/entries/${repos[0]}/bring-in`,
      headers: asUser(judgeId),
      payload: {},
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/pause`,
      headers: asUser(operatorId),
      payload: {},
    });
    expect(res.statusCode).toBe(200);

    const inRoom = await getEntry(repos[0]!);
    expect(inRoom.status).toBe("in_room"); // untouched

    const e2 = await getEntry(repos[1]!);
    const e3 = await getEntry(repos[2]!);
    const e4 = await getEntry(repos[3]!);
    expect(e2.status).toBe("waiting");
    expect(e3.status).toBe("waiting");
    expect(e2.call_count).toBe(0); // pause is not the team's fault
    // arrival order preserved: e2 (longest called) above e3, both above e4
    expect(e2.position).toBeLessThan(e3.position);
    expect(e3.position).toBeLessThan(e4.position);

    // pump/call_next won't call for a paused room
    const paused = await call();
    expect(paused.statusCode).toBe(409);

    // resume restarts AND immediately refills the waiting area (H35): e2, the
    // longest-waiting team, is auto-called first, e3 next (cap 2) — no manual
    // call-next needed.
    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/resume`,
      headers: asUser(operatorId),
      payload: {},
    });
    expect((await getEntry(repos[1]!)).status).toBe("called"); // e2 back on top
    expect((await getEntry(repos[2]!)).status).toBe("called"); // e3 next
  });
});
