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
  createEnterpriseChallenges,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
} from "./fixtures.js";

let app: App;
let admin: number;
beforeEach(async () => {
  await truncateAll();
  await pool.query(
    `UPDATE queue_settings SET schedule_start_at=NULL,schedule_end_at=NULL WHERE id=1`,
  );
  app ??= await buildTestApp();
  admin = await createUserWithCapabilities([CAPABILITIES.QUEUE_ADMIN, CAPABILITIES.QUEUE_OPERATE]);
});
afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});
async function setup() {
  const { enterpriseId, challengeIds } = await createEnterpriseChallenges(1);
  const challenge = challengeIds[0] as number;
  const a = await createRoom({ desiredMinutesPerTeam: 3 }),
    b = await createRoom({ desiredMinutesPerTeam: 20 });
  await assignChallengeToRoom(a, challenge);
  await assignChallengeToRoom(b, challenge);
  return { enterpriseId, challenge, a, b };
}
async function timing(id: number) {
  return (
    await app.inject({
      method: "GET",
      url: `/api/queue/challenges/${id}/timing`,
      headers: asUser(admin),
    })
  ).json();
}
async function target(id: number, user = admin, seconds = 600) {
  return app.inject({
    method: "PATCH",
    url: `/api/queue/challenges/${id}/timing`,
    headers: asUser(user),
    payload: { targetSeconds: seconds, preparationSeconds: 120 },
  });
}
async function completed(challenge: number, presentation = 12, preparation = 3, legacy = false) {
  const { repoId } = await createRepoWithTeam();
  const entry = await enqueueRepo(challenge, repoId, 1);
  await pool.query(
    `UPDATE queue_entries SET status='completed',completed_at=now(),presentation_started_at=now()-make_interval(mins=>$2),room_entered_at=CASE WHEN $4 THEN NULL ELSE now()-make_interval(mins=>$2+$3) END,called_at=now()-make_interval(mins=>$2+$3) WHERE id=$1`,
    [entry, presentation, preparation, legacy],
  );
  return entry;
}

describe("track targets and learned cycles (H32,H38,H39)", () => {
  it("uses one track target for all rooms, editable before and during judging", async () => {
    const s = await setup();
    expect((await target(s.challenge)).statusCode).toBe(200);
    const { roomPace } = await import("../../src/modules/queue/reads.js");
    expect((await roomPace(s.a)).desiredMinutesPerTeam).toBe(10);
    expect((await roomPace(s.b)).desiredMinutesPerTeam).toBe(10);
    await pool.query(
      `UPDATE queue_settings SET schedule_start_at=now()-interval '10 minutes' WHERE id=1`,
    );
    expect((await target(s.challenge, admin, 420)).statusCode).toBe(200);
    expect((await roomPace(s.b)).desiredMinutesPerTeam).toBe(7);
    expect(
      (await pool.query(`SELECT count(*)::int n FROM audit_log WHERE action='judging_timing'`))
        .rows[0].n,
    ).toBe(2);
  });
  it("authorizes assigned track judges but denies unrelated users and judges of another enterprise", async () => {
    const s = await setup();
    const judge = await createUser();
    await pool.query(`INSERT INTO enterprise_judges(enterprise_id,user_id) VALUES($1,$2)`, [
      s.enterpriseId,
      judge,
    ]);
    expect((await target(s.challenge, judge)).statusCode).toBe(200);
    const other = await createUser();
    expect((await target(s.challenge, other)).statusCode).toBe(403);
    const foreign = await createEnterpriseChallenges(1);
    await pool.query(`INSERT INTO enterprise_judges(enterprise_id,user_id) VALUES($1,$2)`, [
      foreign.enterpriseId,
      other,
    ]);
    expect((await target(s.challenge, other)).statusCode).toBe(403);
  });
  it("starts with target plus setup allowance and averages preparation from bring-in or legacy call", async () => {
    const s = await setup();
    await target(s.challenge, admin, 480);
    let t = await timing(s.challenge);
    expect(Number(t.estimated_cycle_minutes)).toBe(10);
    expect(Number(t.sample_count)).toBe(0);
    await completed(s.challenge, 12, 3);
    t = await timing(s.challenge);
    expect(Number(t.observed_presentation_minutes)).toBeCloseTo(12);
    expect(Number(t.observed_preparation_minutes)).toBeCloseTo(3);
    expect(Number(t.estimated_cycle_minutes)).toBeCloseTo(65 / 6);
    await completed(s.challenge, 12, 3, true);
    expect(Number((await timing(s.challenge)).observed_preparation_minutes)).toBeCloseTo(3);
  });
  it("learns gradually, excludes outliers, and limits recent samples", async () => {
    const s = await setup();
    await target(s.challenge, admin, 480);
    for (let i = 0; i < 25; i++) await completed(s.challenge, 12, 4);
    await completed(s.challenge, 300, 120);
    const t = await timing(s.challenge);
    expect(Number(t.sample_count)).toBe(20);
    expect(Number(t.estimated_cycle_minutes)).toBeCloseTo(
      (5 * 8 + 20 * 12) / 25 + (5 * 2 + 20 * 4) / 25,
    );
  });
  it("keeps realistic ETA and finish beyond judging close when the judge goal is squeezed", async () => {
    const s = await setup();
    await target(s.challenge, admin, 480);
    await completed(s.challenge, 12, 3);
    for (let i = 0; i < 8; i++) {
      const { repoId } = await createRepoWithTeam();
      await enqueueRepo(s.challenge, repoId, i + 1);
    }
    const { roomPace, challengeEtaMinutesPerSlot } = await import(
      "../../src/modules/queue/reads.js"
    );
    const before = await challengeEtaMinutesPerSlot(s.challenge);
    await pool.query(
      `UPDATE queue_settings SET schedule_end_at=now()+interval '5 minutes' WHERE id=1`,
    );
    const pace = await roomPace(s.a);
    expect(pace.autoAdjusted).toBe(true);
    expect(pace.effectiveMinutesPerTeam).toBeLessThan(8);
    expect(pace.exceedsJudgingClose).toBe(true);
    expect(new Date(pace.estimatedFinishAt as string).getTime()).toBeGreaterThan(
      new Date(pace.judgingClosesAt).getTime(),
    );
    expect(await challengeEtaMinutesPerSlot(s.challenge)).toBe(before);
    expect(pace.estimatedCycleMinutes).toBeGreaterThan(10);
  });
  it("includes teams already presenting in the estimated finish, even when none are waiting", async () => {
    const s = await setup();
    await target(s.challenge, admin, 480);
    const { repoId } = await createRepoWithTeam();
    await enqueueRepo(s.challenge, repoId, 1);
    await pool.query(
      `UPDATE queue_entries SET status='presenting',assigned_room_id=$2,presentation_started_at=now()-interval '2 minutes',room_entered_at=now()-interval '4 minutes' WHERE repo_id=$1`,
      [repoId, s.a],
    );
    await pool.query(
      `UPDATE queue_settings SET schedule_end_at=now()+interval '4 minutes' WHERE id=1`,
    );
    const { roomPace } = await import("../../src/modules/queue/reads.js");
    const pace = await roomPace(s.a);
    expect(pace.pendingCount).toBe(0);
    expect(pace.requiredMinutes).toBeGreaterThan(5.9);
    expect(pace.requiredMinutes).toBeLessThan(6.1);
    expect(pace.estimatedFinishAt).not.toBeNull();
    expect(pace.exceedsJudgingClose).toBe(true);
  });
  it("uses active parallel rooms for throughput and keeps shared-participant collisions hard", async () => {
    const s = await setup();
    await target(s.challenge, admin, 480);
    const { challengeEtaMinutesPerSlot } = await import("../../src/modules/queue/reads.js");
    expect(await challengeEtaMinutesPerSlot(s.challenge)).toBe(5);
    await pool.query(`UPDATE room_queue_state SET is_paused=true WHERE room_id=$1`, [s.b]);
    expect(await challengeEtaMinutesPerSlot(s.challenge)).toBe(10);
    const one = await createRepoWithTeam();
    const two = await createRepoWithTeam(one.memberIds);
    await enqueueRepo(s.challenge, one.repoId, 1);
    await enqueueRepo(s.challenge, two.repoId, 2);
    await pool.query(`UPDATE room_queue_state SET is_paused=false WHERE room_id=$1`, [s.b]);
    const a = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${s.a}/call-next`,
      headers: asUser(admin),
      payload: {},
    });
    expect(a.statusCode, a.body).toBe(200);
    const b = await app.inject({
      method: "POST",
      url: `/api/queue/rooms/${s.b}/call-next`,
      headers: asUser(admin),
      payload: {},
    });
    expect(b.statusCode).toBe(200);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int n FROM queue_entries WHERE repo_id=ANY($1::int[]) AND status IN ('called','in_room','presenting')`,
          [[one.repoId, two.repoId]],
        )
      ).rows[0].n,
    ).toBe(1);
  });
});
