import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  seedAttendeeRoles,
  truncateAll,
} from "../helpers.js";
import {
  allowLiveActivities,
  createScannableActivity,
  openJudgingWindow,
  participantInQueue,
  resetJudgingWindow,
  sessionsOf,
} from "./fixtures.js";

/** #966 registry and read routes (H38, H25, H26). */

let app: App;

beforeEach(async () => {
  await truncateAll();
  await resetJudgingWindow();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  app ??= await buildTestApp();
});

afterAll(async () => {
  await resetJudgingWindow();
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  const { pool } = await import("../../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function deviceRow(deviceId: string) {
  const { pool } = await import("../../src/db/pool.js");
  const { rows } = await pool.query(`SELECT * FROM live_activity_devices WHERE device_id = $1`, [
    deviceId,
  ]);
  return rows[0];
}

function putDevice(userId: number, body: Record<string, unknown>) {
  return app.inject({
    method: "PUT",
    url: "/api/me/live-activities/device",
    headers: asUser(userId),
    payload: body,
  });
}

describe("PUT /api/me/live-activities/device", () => {
  it("requires a session", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/me/live-activities/device",
      payload: { deviceId: "d1", platform: "ios" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("upserts, keeps omitted fields, clears nulls and validates", async () => {
    const userId = await createUser();
    const created = await putDevice(userId, {
      deviceId: "install-1",
      platform: "ios",
      pushToStartToken: "abc",
      language: "gl",
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual({
      deviceId: "install-1",
      platform: "ios",
      enabled: true,
      language: "gl",
    });

    const toggled = await putDevice(userId, {
      deviceId: "install-1",
      platform: "ios",
      enabled: false,
    });
    expect(toggled.json()).toMatchObject({ enabled: false, language: "gl" });
    expect(await deviceRow("install-1")).toMatchObject({ push_to_start_token: "abc" });

    await putDevice(userId, { deviceId: "install-1", platform: "ios", pushToStartToken: null });
    expect(await deviceRow("install-1")).toMatchObject({
      push_to_start_token: null,
      enabled: false,
    });

    const invalid = await putDevice(userId, { deviceId: "install-1", platform: "windows" });
    expect(invalid.statusCode).toBe(400);
    const badLanguage = await putDevice(userId, {
      deviceId: "install-1",
      platform: "ios",
      language: "fr",
    });
    expect(badLanguage.statusCode).toBe(400);
  });

  it("reassigns a device: drops the old account's ended sessions, keeps open ones to reconcile", async () => {
    const first = await createUser();
    const second = await createUser();
    await putDevice(first, { deviceId: "shared", platform: "android", expoPushToken: "tok" });
    const session = await app.inject({
      method: "PUT",
      url: "/api/me/live-activities/sessions",
      headers: asUser(first),
      payload: { deviceId: "shared", kind: "queue", subject: "judging" },
    });
    expect(session.statusCode).toBe(200);
    const dismissed = await app.inject({
      method: "DELETE",
      url: "/api/me/live-activities/sessions",
      headers: asUser(first),
      payload: { deviceId: "shared", kind: "activity", subject: "activity:7", phase: "live" },
    });
    expect(dismissed.statusCode).toBe(200);
    const row = await deviceRow("shared");
    expect(await sessionsOf(row.id)).toHaveLength(2);

    const moved = await putDevice(second, { deviceId: "shared", platform: "android" });
    expect(moved.statusCode).toBe(200);
    expect(await deviceRow("shared")).toMatchObject({ user_id: second, expo_push_token: "tok" });
    // The open queue activity is still on the phone: the worker updates or ends it.
    // The old account's dismissal no longer gates anything.
    const remaining = await sessionsOf(row.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ kind: "queue", ended_at: null });
  });

  it("keeps each token on one device row only", async () => {
    const first = await createUser();
    const second = await createUser();
    await putDevice(first, { deviceId: "old-install", platform: "android", expoPushToken: "tok" });
    await putDevice(first, { deviceId: "old-iphone", platform: "ios", pushToStartToken: "pts" });

    // A reinstall (new deviceId) under another account reports the same tokens.
    await putDevice(second, { deviceId: "new-install", platform: "android", expoPushToken: "tok" });
    await putDevice(second, { deviceId: "new-iphone", platform: "ios", pushToStartToken: "pts" });

    expect(await deviceRow("old-install")).toMatchObject({ expo_push_token: null });
    expect(await deviceRow("old-iphone")).toMatchObject({ push_to_start_token: null });
    expect(await deviceRow("new-install")).toMatchObject({ expo_push_token: "tok" });
    expect(await deviceRow("new-iphone")).toMatchObject({ push_to_start_token: "pts" });
  });
});

describe("Live Activity sessions", () => {
  it("registers, rotates and dismisses a session on the caller's own device only", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    await putDevice(owner, { deviceId: "phone", platform: "ios" });
    const row = await deviceRow("phone");

    const register = (userId: number, payload: Record<string, unknown>) =>
      app.inject({
        method: "PUT",
        url: "/api/me/live-activities/sessions",
        headers: asUser(userId),
        payload,
      });

    expect(
      (
        await register(owner, {
          deviceId: "phone",
          kind: "activity",
          subject: "activity:7",
          activityPushToken: "t1",
        })
      ).statusCode,
    ).toBe(200);
    await register(owner, {
      deviceId: "phone",
      kind: "activity",
      subject: "activity:7",
      activityPushToken: "t2",
    });
    expect(await sessionsOf(row.id)).toEqual([
      expect.objectContaining({ subject: "activity:7", activity_push_token: "t2", ended_at: null }),
    ]);

    const foreign = await register(stranger, {
      deviceId: "phone",
      kind: "activity",
      subject: "activity:7",
      activityPushToken: "t3",
    });
    expect(foreign.statusCode).toBe(404);

    const mismatched = await register(owner, {
      deviceId: "phone",
      kind: "queue",
      subject: "activity:7",
    });
    expect(mismatched.statusCode).toBe(400);

    const dismissed = await app.inject({
      method: "DELETE",
      url: "/api/me/live-activities/sessions",
      headers: asUser(owner),
      payload: { deviceId: "phone", kind: "activity", subject: "activity:7" },
    });
    expect(dismissed.statusCode).toBe(200);
    expect(await sessionsOf(row.id)).toEqual([
      expect.objectContaining({
        end_reason: "dismissed",
        activity_push_token: null,
        dismissed_phase: null,
      }),
    ]);
    await app.inject({
      method: "DELETE",
      url: "/api/me/live-activities/sessions",
      headers: asUser(owner),
      payload: { deviceId: "phone", kind: "activity", subject: "activity:7", phase: "live" },
    });
    expect(await sessionsOf(row.id)).toEqual([
      expect.objectContaining({ dismissed_phase: "live" }),
    ]);

    // A later local start re-registers (reopens) it.
    await register(owner, {
      deviceId: "phone",
      kind: "activity",
      subject: "activity:7",
      activityPushToken: "t4",
    });
    expect(await sessionsOf(row.id)).toEqual([
      expect.objectContaining({ ended_at: null, end_reason: null, activity_push_token: "t4" }),
    ]);
  });

  it("dismissing an unknown device is a 404", async () => {
    const userId = await createUser();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/me/live-activities/sessions",
      headers: asUser(userId),
      payload: { deviceId: "nope", kind: "queue", subject: "judging" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/me/live-activities", () => {
  it("returns the caller's queue state and gates activities on ACTIVITY_SCAN", async () => {
    await openJudgingWindow();
    const { userId } = await participantInQueue({ position: 1 });
    await createScannableActivity({ startsInMinutes: 5 });
    await allowLiveActivities();

    const participant = await app.inject({
      method: "GET",
      url: "/api/me/live-activities?language=gl",
      headers: asUser(userId),
    });
    expect(participant.statusCode).toBe(200);
    const body = participant.json();
    expect(body).toMatchObject({
      judgingWindowOpen: true,
      queue: { kind: "queue", phase: "waiting", position: 1, labels: { goTo: "Vai a" } },
      activities: [],
      attendeeActivities: [],
      deadline: null,
      accreditation: null,
      maxConcurrent: 5,
    });
    // Fields added after v1 survive response serialization.
    expect(body.queue).toMatchObject({ calledAt: null, queueTotal: 1, calledAhead: null, rank: 0 });
    expect(body.queue.labels.stageInLine).toBe("Na cola");

    const staffId = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    await allowLiveActivities();
    const staff = await app.inject({
      method: "GET",
      url: "/api/me/live-activities",
      headers: asUser(staffId),
    });
    expect(staff.statusCode).toBe(200);
    expect(staff.json()).toMatchObject({
      judgingWindowOpen: true,
      queue: null,
      activities: [{ kind: "activity", phase: "upcoming", labels: { scan: "Scan" } }],
    });

    const anonymous = await app.inject({ method: "GET", url: "/api/me/live-activities" });
    expect(anonymous.statusCode).toBe(401);
  });

  it("counts people accredited through check-in as the activity and desk denominator", async () => {
    await seedAttendeeRoles();
    const staffId = await createUserWithCapabilities([
      CAPABILITIES.ACTIVITY_SCAN,
      CAPABILITIES.ACCREDIT_SCAN,
    ]);
    await createScannableActivity({ startsInMinutes: -5 });
    const { pool } = await import("../../src/db/pool.js");
    // Inside the desk's window (opens before the event start).
    await pool.query(
      `INSERT INTO event_config (id, event_starts_at, hacking_starts_at)
       VALUES (1, now() + interval '30 minutes', now() + interval '2 hours')
       ON CONFLICT (id) DO UPDATE
         SET event_starts_at = EXCLUDED.event_starts_at,
             hacking_starts_at = EXCLUDED.hacking_starts_at`,
    );
    // The real accreditation flow (H22), as the desk and the people finder see it.
    for (const [index, attendeeRole] of (["participant", "mentor"] as const).entries()) {
      const res = await app.inject({
        method: "POST",
        url: "/api/accreditation/check-in-user",
        headers: { ...asUser(staffId), "idempotency-key": `la-accredit-${index}` },
        payload: { userId: await createUser(), badgeId: `B-LA-${index}`, attendeeRole },
      });
      expect(res.statusCode).toBe(200);
    }
    await createUser(); // no badge: not accredited
    await allowLiveActivities();

    const res = await app.inject({
      method: "GET",
      url: "/api/me/live-activities",
      headers: asUser(staffId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      activities: [{ phase: "live", scanned: 0, accredited: 2 }],
      accreditation: { accredited: 2 },
    });
  });

  it("cuts to maxConcurrent by kind priority and keeps the device's running activity", async () => {
    const staffId = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    const first = await createScannableActivity({ name: "First", startsInMinutes: 2 });
    const second = await createScannableActivity({ name: "Second", startsInMinutes: 5 });
    await allowLiveActivities({ maxConcurrent: 1 });
    const get = (query = "") =>
      app.inject({
        method: "GET",
        url: `/api/me/live-activities${query}`,
        headers: asUser(staffId),
      });
    const plain = (await get()).json();
    expect(plain.maxConcurrent).toBe(1);
    expect(plain.activities.map((a: { activityId: number }) => a.activityId)).toEqual([first]);

    // The device already runs the second one: within a kind it is not swapped.
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO live_activity_devices (user_id, device_id, platform) VALUES ($1, 'phone', 'ios')
       RETURNING id`,
      [staffId],
    );
    await pool.query(
      `INSERT INTO live_activity_sessions (device_id, kind, subject) VALUES ($1, 'activity', $2)`,
      [rows[0]!.id, `activity:${second}`],
    );
    const device = (await get("?deviceId=phone")).json();
    expect(
      device.activities.map((a: { activityId: number; rank: number }) => [a.activityId, a.rank]),
    ).toEqual([[second, 0]]);
    // Another account's device id does not leak its sessions.
    const other = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    await allowLiveActivities({ maxConcurrent: 1 });
    const foreign = await app.inject({
      method: "GET",
      url: "/api/me/live-activities?deviceId=phone",
      headers: asUser(other),
    });
    expect(foreign.json().activities.map((a: { activityId: number }) => a.activityId)).toEqual([
      first,
    ]);
  });
});
