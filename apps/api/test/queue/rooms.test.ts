import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { asUser, buildTestApp, createUserWithCapabilities, truncateAll } from "../helpers.js";
import {
  assignChallengeToRoom,
  createChallenge,
  createEnterpriseChallenges,
  createRepoWithTeam,
  createRoom,
  queueGroupOf,
} from "./fixtures.js";

/** Rooms & assignment admin, settings, enqueue (H29 admin surface, QUEUE_ADMIN). */

let app: App;
let adminId: number;
let operatorId: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  // restore queue_settings defaults (truncateAll keeps the singleton row)
  const { pool } = await import("../../src/db/pool.js");
  await pool.query(
    `UPDATE queue_settings SET handoff_buffer_minutes = 5, schedule_start_at = NULL,
       schedule_end_at = NULL, pre_call_notification_eta_minutes = 10, requeue_prompt_default = 'ask'
     WHERE id = 1`,
  );
  adminId = await createUserWithCapabilities([CAPABILITIES.QUEUE_ADMIN]);
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

describe("rooms CRUD + assignments (QUEUE_ADMIN)", () => {
  it("creates an operationally paused room; operators can read but not create", async () => {
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/queue/rooms",
      headers: asUser(operatorId),
      payload: { name: "Sala 1", slug: "sala-1" },
    });
    expect(forbidden.statusCode).toBe(403);

    const res = await app.inject({
      method: "POST",
      url: "/api/queue/rooms",
      headers: asUser(adminId),
      payload: { name: "Sala 1", slug: "sala-1", location: "planta 2" },
    });
    expect(res.statusCode).toBe(201);
    const roomId = res.json().id;

    const read = await app.inject({
      method: "GET",
      url: `/api/queue/rooms/${roomId}`,
      headers: asUser(operatorId),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().status).toBe("paused");
    expect(read.json().queueState.max_in_waiting_area).toBe(2);
    expect(read.json().queueState.is_paused).toBe(true);
  });

  it("does not auto-fill a newly created room until it is resumed", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/queue/rooms",
      headers: asUser(adminId),
      payload: { name: "Paused room", slug: "paused-room" },
    });
    const roomId = created.json().id;
    const challengeId = await createChallenge();
    const { repoId } = await createRepoWithTeam();
    await assignChallengeToRoom(roomId, challengeId);
    const { pool } = await import("../../src/db/pool.js");
    const { rows: entries } = await pool.query(
      `INSERT INTO queue_entries (challenge_id, repo_id, status, position)
       VALUES ($1, $2, 'waiting', 1) RETURNING id`,
      [challengeId, repoId],
    );

    const { pumpTick } = await import("../../src/modules/queue/pump.js");
    await pumpTick();
    expect(
      (await pool.query(`SELECT status FROM queue_entries WHERE id = $1`, [entries[0].id])).rows[0]
        .status,
    ).toBe("waiting");

    const resumed = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/resume`,
      // H35 allows the queue operator (or a judge), not the room administrator
      // who only owns setup/settings (QUEUE_ADMIN).
      headers: asUser(operatorId),
    });
    expect(resumed.statusCode).toBe(200);
    expect(
      (await pool.query(`SELECT status FROM queue_entries WHERE id = $1`, [entries[0].id])).rows[0]
        .status,
    ).toBe("called");
  });

  it("updates room fields and per-room queue settings (max_in_waiting_area, desired_minutes_per_team)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/queue/rooms",
      headers: asUser(adminId),
      payload: { name: "Sala 2", slug: "sala-2" },
    });
    const roomId = created.json().id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/queue/rooms/${roomId}`,
      headers: asUser(adminId),
      payload: { name: "Sala 2 bis", status: "active" },
    });
    expect(patched.json().name).toBe("Sala 2 bis");
    expect(patched.json().status).toBe("active");

    const state = await app.inject({
      method: "PATCH",
      url: `/api/queue/rooms/${roomId}/state`,
      headers: asUser(adminId),
      payload: { maxInWaitingArea: 3, desiredMinutesPerTeam: 15 },
    });
    expect(state.statusCode).toBe(200);
    expect(state.json().max_in_waiting_area).toBe(3);
    expect(state.json().desired_minutes_per_team).toBe(15);
  });

  it("assigning a room to an enterprise auto-serves its one queue, unassigning clears both", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/queue/rooms",
      headers: asUser(adminId),
      payload: { name: "Sala 3", slug: "sala-3" },
    });
    const roomId = created.json().id;
    const challengeId = await createChallenge();
    const queueGroupId = await queueGroupOf(challengeId);
    const { pool } = await import("../../src/db/pool.js");
    const enterpriseId = (
      await pool.query(`SELECT enterprise_id FROM queue_groups WHERE id = $1`, [queueGroupId])
    ).rows[0].enterprise_id;

    const assign = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/enterprise`,
      headers: asUser(adminId),
      payload: { enterpriseId },
    });
    expect(assign.statusCode).toBe(201);
    expect(assign.json()).toMatchObject({ roomId, enterpriseId, queueGroupId });

    expect(
      (await pool.query(`SELECT * FROM room_enterprises WHERE room_id = $1`, [roomId])).rows,
    ).toHaveLength(1);
    expect(
      (await pool.query(`SELECT * FROM room_queue_groups WHERE room_id = $1`, [roomId])).rows,
    ).toHaveLength(1);

    await app.inject({
      method: "DELETE",
      url: `/api/queue/rooms/${roomId}/enterprise`,
      headers: asUser(adminId),
    });
    expect(
      (await pool.query(`SELECT * FROM room_enterprises WHERE room_id = $1`, [roomId])).rows,
    ).toHaveLength(0);
    expect(
      (await pool.query(`SELECT * FROM room_queue_groups WHERE room_id = $1`, [roomId])).rows,
    ).toHaveLength(0);
  });

  it("replaces a room's enterprise instead of accumulating many, resolving the new one's queue", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/queue/rooms",
      headers: asUser(adminId),
      payload: { name: "Sala única", slug: "sala-unica" },
    });
    const roomId = created.json().id;
    const firstChallengeId = await createChallenge();
    const secondChallengeId = await createChallenge();
    const { pool } = await import("../../src/db/pool.js");
    const enterpriseOf = async (challengeId: number) => {
      const groupId = await queueGroupOf(challengeId);
      return (await pool.query(`SELECT enterprise_id FROM queue_groups WHERE id = $1`, [groupId]))
        .rows[0].enterprise_id;
    };

    await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/enterprise`,
      headers: asUser(adminId),
      payload: { enterpriseId: await enterpriseOf(firstChallengeId) },
    });

    const secondEnterpriseId = await enterpriseOf(secondChallengeId);
    const secondGroupId = await queueGroupOf(secondChallengeId);
    const replace = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/enterprise`,
      headers: asUser(adminId),
      payload: { enterpriseId: secondEnterpriseId },
    });
    expect(replace.statusCode).toBe(201);

    expect(
      (await pool.query(`SELECT enterprise_id FROM room_enterprises WHERE room_id = $1`, [roomId]))
        .rows,
    ).toEqual([{ enterprise_id: secondEnterpriseId }]);
    expect(
      (
        await pool.query(`SELECT queue_group_id FROM room_queue_groups WHERE room_id = $1`, [
          roomId,
        ])
      ).rows,
    ).toEqual([{ queue_group_id: secondGroupId }]);
  });

  it("does not auto-serve a queue when the enterprise runs zero or several", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/queue/rooms",
      headers: asUser(adminId),
      payload: { name: "Sala ambigua", slug: "sala-ambigua" },
    });
    const roomId = created.json().id;
    const { enterpriseId: multiEnterpriseId } = await createEnterpriseChallenges(2);

    const assign = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/enterprise`,
      headers: asUser(adminId),
      payload: { enterpriseId: multiEnterpriseId },
    });
    expect(assign.statusCode).toBe(201);
    expect(assign.json().queueGroupId).toBeNull();

    const { pool } = await import("../../src/db/pool.js");
    expect(
      (await pool.query(`SELECT * FROM room_queue_groups WHERE room_id = $1`, [roomId])).rows,
    ).toHaveLength(0);
    // The room is still pooled into the enterprise — Judging queues resolves
    // which of its several queues the room actually serves, if any.
    expect(
      (await pool.query(`SELECT enterprise_id FROM room_enterprises WHERE room_id = $1`, [roomId]))
        .rows,
    ).toEqual([{ enterprise_id: multiEnterpriseId }]);
  });

  it("keeps room graphs inside one fixture boundary for writes and global lists", async () => {
    const fixtureAdminId = await createUserWithCapabilities([CAPABILITIES.QUEUE_ADMIN]);
    const { pool } = await import("../../src/db/pool.js");
    const {
      enterpriseId: fixtureEnterpriseId,
      repId: fixtureRepId,
      challengeIds,
    } = await createEnterpriseChallenges(1);
    const fixtureChallengeId = challengeIds[0]!;
    await pool.query(`UPDATE users SET is_test_account = true WHERE id IN ($1, $2)`, [
      fixtureAdminId,
      fixtureRepId,
    ]);
    await pool.query(`UPDATE challenges SET is_test_account = true WHERE id = $1`, [
      fixtureChallengeId,
    ]);

    const fixtureRoomId = await createRoom();
    await assignChallengeToRoom(fixtureRoomId, fixtureChallengeId);

    const { enterpriseId: realEnterpriseId } = await createEnterpriseChallenges(1);
    const realRoomId = await createRoom();
    const realAssignment = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${realRoomId}/enterprise`,
      headers: { ...asUser(adminId), "idempotency-key": crypto.randomUUID() },
      payload: { enterpriseId: realEnterpriseId },
    });
    expect(realAssignment.statusCode).toBe(201);

    const bareRoomId = await createRoom();
    const realToFixture = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${bareRoomId}/enterprise`,
      headers: { ...asUser(adminId), "idempotency-key": crypto.randomUUID() },
      payload: { enterpriseId: fixtureEnterpriseId },
    });
    expect(realToFixture.statusCode).toBe(404);
    expect(
      (await pool.query(`SELECT 1 FROM room_enterprises WHERE room_id = $1`, [bareRoomId]))
        .rowCount,
    ).toBe(0);

    const realPatchFixture = await app.inject({
      method: "PATCH",
      url: `/api/queue/rooms/${fixtureRoomId}`,
      headers: asUser(adminId),
      payload: { name: "Leaked synthetic room" },
    });
    expect(realPatchFixture.statusCode).toBe(404);

    const realStateFixture = await app.inject({
      method: "PATCH",
      url: `/api/queue/rooms/${fixtureRoomId}/state`,
      headers: asUser(adminId),
      payload: { maxInWaitingArea: 9 },
    });
    expect(realStateFixture.statusCode).toBe(404);

    const realReplaceFixture = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${fixtureRoomId}/enterprise`,
      headers: { ...asUser(adminId), "idempotency-key": crypto.randomUUID() },
      payload: { enterpriseId: realEnterpriseId },
    });
    expect(realReplaceFixture.statusCode).toBe(404);
    expect(
      (
        await pool.query(`SELECT enterprise_id FROM room_enterprises WHERE room_id = $1`, [
          fixtureRoomId,
        ])
      ).rows,
    ).toEqual([{ enterprise_id: fixtureEnterpriseId }]);

    const realDeleteFixture = await app.inject({
      method: "DELETE",
      url: `/api/queue/rooms/${fixtureRoomId}/enterprise`,
      headers: asUser(adminId),
    });
    expect(realDeleteFixture.statusCode).toBe(404);
    expect(
      (await pool.query(`SELECT 1 FROM room_queue_groups WHERE room_id = $1`, [fixtureRoomId]))
        .rowCount,
    ).toBe(1);

    const fixturePatchReal = await app.inject({
      method: "PATCH",
      url: `/api/queue/rooms/${realRoomId}`,
      headers: asUser(fixtureAdminId),
      payload: { name: "Leaked real room" },
    });
    expect(fixturePatchReal.statusCode).toBe(403);

    const fixtureReplaceReal = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${realRoomId}/enterprise`,
      headers: { ...asUser(fixtureAdminId), "idempotency-key": crypto.randomUUID() },
      payload: { enterpriseId: realEnterpriseId },
    });
    expect(fixtureReplaceReal.statusCode).toBe(403);

    const fixtureList = await app.inject({
      method: "GET",
      url: "/api/queue/rooms",
      headers: asUser(fixtureAdminId),
    });
    expect(fixtureList.statusCode).toBe(200);
    expect(fixtureList.json().map((room: { id: number }) => room.id)).toContain(fixtureRoomId);
    expect(fixtureList.json().map((room: { id: number }) => room.id)).not.toContain(realRoomId);

    const realList = await app.inject({
      method: "GET",
      url: "/api/queue/rooms",
      headers: asUser(adminId),
    });
    expect(realList.statusCode).toBe(200);
    expect(realList.json().map((room: { id: number }) => room.id)).toContain(realRoomId);
    expect(realList.json().map((room: { id: number }) => room.id)).not.toContain(fixtureRoomId);

    const fixtureDeleteReal = await app.inject({
      method: "DELETE",
      url: `/api/queue/rooms/${realRoomId}/enterprise`,
      headers: asUser(fixtureAdminId),
    });
    expect(fixtureDeleteReal.statusCode).toBe(403);
  });
});

describe("queue_settings singleton", () => {
  it("PATCHes the singleton; operators read-only", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/queue/settings",
      headers: asUser(adminId),
      payload: { preCallNotificationEtaMinutes: 7, scheduleEndAt: "2026-07-04T18:00:00Z" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pre_call_notification_eta_minutes).toBe(7);

    const read = await app.inject({
      method: "GET",
      url: "/api/queue/settings",
      headers: asUser(operatorId),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().pre_call_notification_eta_minutes).toBe(7);

    const forbidden = await app.inject({
      method: "PATCH",
      url: "/api/queue/settings",
      headers: asUser(operatorId),
      payload: { preCallNotificationEtaMinutes: 3 },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});

describe("enqueue a challenge (H29 admin)", () => {
  it("enqueues an explicit repo list, one entry per (challenge, repo); duplicates reported", async () => {
    const challengeId = await createChallenge();
    const { repoId: r1 } = await createRepoWithTeam();
    const { repoId: r2 } = await createRepoWithTeam();

    const res = await app.inject({
      method: "POST",
      url: `/api/queue/challenges/${challengeId}/enqueue`,
      headers: asUser(adminId),
      payload: { repoIds: [r1, r2] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().inserted).toHaveLength(2);

    const again = await app.inject({
      method: "POST",
      url: `/api/queue/challenges/${challengeId}/enqueue`,
      headers: asUser(adminId),
      payload: { repoIds: [r1] },
    });
    expect(again.json().inserted).toHaveLength(0);
    expect(again.json().alreadyQueued).toEqual([r1]);

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM queue_entries WHERE challenge_id = $1`,
      [challengeId],
    );
    expect(rows[0].n).toBe(2); // invariant 1: max one entry per (challenge, repo)
  });

  it("enqueues from the devpost prize mapping when no repo list is given (H16 bridge)", async () => {
    const challengeId = await createChallenge({ devpostTags: ["Best AI Hack"] });
    const { repoId: tagged } = await createRepoWithTeam();
    const { repoId: untagged } = await createRepoWithTeam();
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`INSERT INTO repo_devpost_prizes (repo_id, prize) VALUES ($1, $2)`, [
      tagged,
      "Best AI Hack",
    ]);

    const res = await app.inject({
      method: "POST",
      url: `/api/queue/challenges/${challengeId}/enqueue`,
      headers: asUser(adminId),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().inserted).toHaveLength(1);

    const { rows } = await pool.query(`SELECT repo_id FROM queue_entries WHERE challenge_id = $1`, [
      challengeId,
    ]);
    expect(rows.map((r: { repo_id: number }) => r.repo_id)).toEqual([tagged]);
    expect(rows.map((r: { repo_id: number }) => r.repo_id)).not.toContain(untagged);
  });

  it("enqueue history rows exist per inserted entry", async () => {
    const challengeId = await createChallenge();
    const { repoId } = await createRepoWithTeam();
    await app.inject({
      method: "POST",
      url: `/api/queue/challenges/${challengeId}/enqueue`,
      headers: asUser(adminId),
      payload: { repoIds: [repoId] },
    });
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT h.* FROM queue_history h JOIN queue_entries qe ON qe.id = h.queue_entry_id
        WHERE qe.challenge_id = $1 AND h.action = 'enqueue'`,
      [challengeId],
    );
    expect(rows).toHaveLength(1);
  });

  it("generates queues for all challenges using their devpost tags", async () => {
    const ch1 = await createChallenge({ devpostTags: ["Best AI Hack"] });
    const ch2 = await createChallenge({ devpostTags: ["Most Caffeinated"] });
    const { repoId: r1 } = await createRepoWithTeam();
    const { repoId: r2 } = await createRepoWithTeam();
    const { repoId: r3 } = await createRepoWithTeam();
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`INSERT INTO repo_devpost_prizes (repo_id, prize) VALUES ($1, $2), ($3, $4)`, [
      r1,
      "Best AI Hack",
      r2,
      "Most Caffeinated",
    ]);
    await pool.query(`INSERT INTO repo_devpost_prizes (repo_id, prize) VALUES ($1, $2)`, [
      r3,
      "Unmatched Prize",
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/queue/challenges/enqueue-all",
      headers: asUser(adminId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().inserted).toBe(2);

    const rows = await pool.query(
      `SELECT challenge_id, repo_id FROM queue_entries ORDER BY challenge_id, repo_id`,
    );
    expect(rows.rows).toEqual([
      { challenge_id: ch1, repo_id: r1 },
      { challenge_id: ch2, repo_id: r2 },
    ]);
  });

  it("regenerates one queue incrementally and clears it only before evaluation", async () => {
    const challengeId = await createChallenge({ devpostTags: ["Best AI Hack"] });
    const { repoId: first } = await createRepoWithTeam();
    const { repoId: second } = await createRepoWithTeam();
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`INSERT INTO repo_devpost_prizes (repo_id, prize) VALUES ($1, $2), ($3, $2)`, [
      first,
      "Best AI Hack",
      second,
    ]);
    const groupId = await queueGroupOf(challengeId);

    const generated = await app.inject({
      method: "POST",
      url: `/api/queue/groups/${groupId}/generate`,
      headers: asUser(adminId),
    });
    expect(generated.statusCode).toBe(200);
    expect(generated.json()).toMatchObject({ inserted: 2, revived: 0 });
    const before = await pool.query(
      `SELECT repo_id, position FROM queue_entries WHERE challenge_id = $1 ORDER BY repo_id`,
      [challengeId],
    );

    const { repoId: addedLater } = await createRepoWithTeam();
    await pool.query(`INSERT INTO repo_devpost_prizes (repo_id, prize) VALUES ($1, $2)`, [
      addedLater,
      "Best AI Hack",
    ]);
    const regenerated = await app.inject({
      method: "POST",
      url: `/api/queue/groups/${groupId}/generate`,
      headers: asUser(adminId),
    });
    expect(regenerated.json()).toMatchObject({ inserted: 1, revived: 0 });
    const after = await pool.query(
      `SELECT repo_id, position FROM queue_entries WHERE challenge_id = $1 ORDER BY repo_id`,
      [challengeId],
    );
    expect(after.rows.slice(0, 2)).toEqual(before.rows);
    expect(after.rows[2]).toMatchObject({ repo_id: addedLater, position: 3 });

    const cleared = await app.inject({
      method: "DELETE",
      url: `/api/queue/groups/${groupId}/entries`,
      headers: asUser(adminId),
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toEqual({ cleared: 3 });
    expect(
      (await pool.query(`SELECT count(*)::int AS n FROM queue_entries WHERE status = 'waiting'`))
        .rows[0].n,
    ).toBe(0);

    const restored = await app.inject({
      method: "POST",
      url: `/api/queue/groups/${groupId}/generate`,
      headers: asUser(adminId),
    });
    expect(restored.json()).toMatchObject({ inserted: 0, revived: 3 });

    await pool.query(
      `UPDATE queue_entries SET status = 'completed' WHERE challenge_id = $1 AND repo_id = $2`,
      [challengeId, first],
    );
    const refused = await app.inject({
      method: "DELETE",
      url: `/api/queue/groups/${groupId}/entries`,
      headers: asUser(adminId),
    });
    expect(refused.statusCode).toBe(409);
  });
});
