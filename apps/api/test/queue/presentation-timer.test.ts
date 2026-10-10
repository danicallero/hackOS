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
import {
  assignChallengeToRoom,
  broadcastCount,
  createEnterpriseChallenges,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
} from "./fixtures.js";

let app: App;
let judge: number;
let otherJudge: number;
let operator: number;
let room: number;
let entry: number;
let challenge: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  await pool.query(
    "UPDATE queue_settings SET schedule_start_at=NULL,schedule_end_at=NULL WHERE id=1",
  );
  app ??= await buildTestApp();
  judge = await createUserWithCapabilities([CAPABILITIES.JUDGE_PANEL]);
  otherJudge = await createUserWithCapabilities([CAPABILITIES.JUDGE_PANEL]);
  operator = await createUserWithCapabilities([CAPABILITIES.QUEUE_OPERATE]);
  const setup = await createEnterpriseChallenges(1);
  challenge = setup.challengeIds[0] as number;
  room = await createRoom();
  await assignChallengeToRoom(room, challenge);
  const { repoId } = await createRepoWithTeam();
  entry = await enqueueRepo(challenge, repoId, 1);
  await pool.query(
    "UPDATE queue_entries SET status='called',assigned_room_id=$2,called_at=now() WHERE id=$1",
    [entry, room],
  );
});
afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});
const action = (name: string, user = judge, key = crypto.randomUUID()) =>
  app.inject({
    method: "POST",
    url: `/api/queue/entries/${entry}/${name}`,
    headers: { ...asUser(user), "Idempotency-Key": key },
    payload: {},
  });
async function active() {
  expect((await action("bring-in")).statusCode).toBe(200);
  expect((await action("start")).statusCode).toBe(200);
}
async function projection(user = judge) {
  const response = await app.inject({
    method: "GET",
    url: `/api/queue/rooms/${room}/view`,
    headers: asUser(user),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().active;
}
async function historyCount(actionName: string) {
  return (
    await pool.query(
      "SELECT count(*)::int n FROM queue_history WHERE queue_entry_id=$1 AND action=$2",
      [entry, actionName],
    )
  ).rows[0].n;
}

describe("presentation clock #926/#927", () => {
  it("stamps setup separately, persists the goal and shares pause/resume across readers", async () => {
    const bring = await action("bring-in");
    expect(bring.statusCode, bring.body).toBe(200);
    expect(bring.json().room_entered_at).not.toBeNull();
    expect(bring.json().presentation_started_at).toBeNull();
    await pool.query(
      "UPDATE queue_entries SET room_entered_at=now()-interval '2 minutes' WHERE id=$1",
      [entry],
    );
    const started = await action("start");
    expect(started.statusCode, started.body).toBe(200);
    const originalStart = started.json().presentation_started_at;
    const goal = started.json().presentation_total_seconds;
    expect(goal).toBeGreaterThan(0);
    await pool.query("UPDATE challenges SET target_seconds_per_team=60 WHERE id=$1", [challenge]);
    const before = await broadcastCount("queue");
    const paused = await action("pause-timer");
    expect(paused.statusCode, paused.body).toBe(200);
    expect(paused.json().status).toBe("presenting");
    expect(await historyCount("pause_timer")).toBe(1);
    expect(await broadcastCount("queue")).toBe(before + 1);
    expect((await projection(otherJudge)).presentation_paused_at).toBe(
      paused.json().presentation_paused_at,
    );
    expect((await projection()).presentation_total_seconds).toBe(goal);
    // Simulate a real elapsed pause with the DB clock, without sleeps.
    await pool.query(
      "UPDATE queue_entries SET presentation_paused_at=clock_timestamp()-interval '30 seconds' WHERE id=$1",
      [entry],
    );
    const resumed = await action("resume-timer", otherJudge);
    expect(resumed.statusCode, resumed.body).toBe(200);
    expect(resumed.json().presentation_paused_at).toBeNull();
    expect(resumed.json().presentation_paused_seconds).toBeGreaterThanOrEqual(30);
    expect(resumed.json().presentation_started_at).toBe(originalStart);
    const snapshot = await projection();
    expect(snapshot.presentation_paused_seconds).toBe(resumed.json().presentation_paused_seconds);
    expect(snapshot.room_entered_at).toBe(resumed.json().room_entered_at);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_log WHERE entity_id=$1 AND action IN ('pause_timer','resume_timer')",
          [String(entry)],
        )
      ).rows[0].n,
    ).toBe(2);
  });

  it("captures the capped and squeezed room goal once at start", async () => {
    await pool.query(
      "UPDATE challenges SET target_seconds_per_team=600,max_presentation_seconds=300 WHERE id=$1",
      [challenge],
    );
    await pool.query("UPDATE repos SET eligibility_override=true");
    const waiting = await createRepoWithTeam();
    await pool.query("UPDATE repos SET eligibility_override=true WHERE id=$1", [waiting.repoId]);
    await enqueueRepo(challenge, waiting.repoId, 2);
    await pool.query(
      "UPDATE queue_settings SET schedule_end_at=now()+interval '3 minutes' WHERE id=1",
    );
    expect((await action("bring-in")).statusCode).toBe(200);
    const { roomPace } = await import("../../src/modules/queue/reads.js");
    const pace = await roomPace(room, challenge);
    expect(pace.effectiveMinutesPerTeam).toBeLessThan(5);
    const started = await action("start");
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json().presentation_total_seconds).toBeCloseTo(
      pace.effectiveMinutesPerTeam * 60,
      0,
    );
    const goal = started.json().presentation_total_seconds;
    await pool.query("UPDATE queue_settings SET schedule_end_at=NULL WHERE id=1");
    await pool.query("UPDATE challenges SET target_seconds_per_team=900 WHERE id=$1", [challenge]);
    expect((await projection(otherJudge)).presentation_total_seconds).toBe(goal);
  });

  it("keeps the timer available to synthetic judges within their fixture scope", async () => {
    await pool.query("UPDATE users SET is_test_account=true WHERE id=$1", [judge]);
    await pool.query(
      "UPDATE users SET is_test_account=true WHERE id IN (SELECT user_id FROM sponsors)",
    );
    await pool.query("UPDATE challenges SET is_test_account=true WHERE id=$1", [challenge]);
    await pool.query("UPDATE repos SET is_test_account=true");
    await active();
    expect((await action("pause-timer")).statusCode).toBe(200);
    expect((await action("resume-timer")).statusCode).toBe(200);
    expect((await action("pause-timer", otherJudge)).statusCode).toBe(404);
  });

  it("rejects wrong states and unauthorized users without writes", async () => {
    expect((await action("pause-timer")).statusCode).toBe(409);
    await active();
    expect((await action("resume-timer")).statusCode).toBe(409);
    expect((await action("pause-timer", operator)).statusCode).toBe(403);
    expect((await action("pause-timer", await createUser())).statusCode).toBe(403);
    expect(await historyCount("pause_timer")).toBe(0);
    expect(await historyCount("resume_timer")).toBe(0);
  });

  it("has one winner for concurrent pauses/resumes and replays one idempotency key", async () => {
    await active();
    const before = await broadcastCount("queue");
    const key = crypto.randomUUID();
    const results = await Promise.all([
      action("pause-timer", judge, key),
      action("pause-timer", otherJudge),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await historyCount("pause_timer")).toBe(1);
    expect(await broadcastCount("queue")).toBe(before + 1);
    const resumes = await Promise.all([
      action("resume-timer", judge),
      action("resume-timer", otherJudge),
    ]);
    expect(resumes.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await historyCount("resume_timer")).toBe(1);
    const paused = await action("pause-timer", judge, crypto.randomUUID());
    expect(paused.statusCode).toBe(200);
    const resumeKey = crypto.randomUUID();
    const resumed = await action("resume-timer", judge, resumeKey);
    const replay = await action("resume-timer", judge, resumeKey);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(resumed.json());
    expect(await historyCount("resume_timer")).toBe(2);
  });

  it("leaves H35 room pause independent and resets a sent-back presentation", async () => {
    await active();
    const start = (await projection()).presentation_started_at;
    const pausedRoom = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${room}/pause`,
      headers: asUser(operator),
      payload: {},
    });
    expect(pausedRoom.statusCode).toBe(200);
    expect((await projection()).presentation_paused_at).toBeNull();
    expect((await projection()).presentation_started_at).toBe(start);
    expect((await action("pause-timer")).statusCode).toBe(200);
    expect((await action("send-back")).statusCode).toBe(200);
    const row = (await pool.query("SELECT * FROM queue_entries WHERE id=$1", [entry])).rows[0];
    expect(row.presentation_started_at).toBeNull();
    expect(row.room_entered_at).toBeNull();
    expect(row.presentation_paused_at).toBeNull();
    expect(row.presentation_paused_seconds).toBe(0);
    expect(row.presentation_total_seconds).toBeNull();
  });

  it("allows completion while paused and rejects any later clock mutation", async () => {
    await active();
    expect((await action("pause-timer")).statusCode).toBe(200);
    expect((await action("complete")).statusCode).toBe(200);
    expect((await action("resume-timer")).statusCode).toBe(409);
  });
});
