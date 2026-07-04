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
import { createChallenge, createRepoWithTeam } from "./fixtures.js";

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
  it("creates a room with its queue state row; operators can read but not create", async () => {
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
    expect(read.json().queueState.max_in_waiting_area).toBe(2);
    expect(read.json().queueState.is_paused).toBe(false);
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

  it("assigns and unassigns challenges and judges to a room", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/queue/rooms",
      headers: asUser(adminId),
      payload: { name: "Sala 3", slug: "sala-3" },
    });
    const roomId = created.json().id;
    const challengeId = await createChallenge();
    const judgeUser = await createUser();

    const assign = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/challenges`,
      headers: asUser(adminId),
      payload: { challengeId },
    });
    expect(assign.statusCode).toBe(201);

    const assignJudge = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${roomId}/judges`,
      headers: asUser(adminId),
      payload: { challengeId, userId: judgeUser },
    });
    expect(assignJudge.statusCode).toBe(201);

    const { pool } = await import("../../src/db/pool.js");
    expect(
      (await pool.query(`SELECT * FROM room_challenges WHERE room_id = $1`, [roomId])).rows,
    ).toHaveLength(1);
    expect(
      (await pool.query(`SELECT * FROM room_judges WHERE room_id = $1`, [roomId])).rows,
    ).toHaveLength(1);

    await app.inject({
      method: "DELETE",
      url: `/api/queue/rooms/${roomId}/judges/${challengeId}/${judgeUser}`,
      headers: asUser(adminId),
    });
    await app.inject({
      method: "DELETE",
      url: `/api/queue/rooms/${roomId}/challenges/${challengeId}`,
      headers: asUser(adminId),
    });
    expect(
      (await pool.query(`SELECT * FROM room_challenges WHERE room_id = $1`, [roomId])).rows,
    ).toHaveLength(0);
    expect(
      (await pool.query(`SELECT * FROM room_judges WHERE room_id = $1`, [roomId])).rows,
    ).toHaveLength(0);
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
});
