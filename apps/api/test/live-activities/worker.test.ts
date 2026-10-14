import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  type AndroidLiveUpdateMessage,
  LIVE_ACTIVITY_STALE_LEEWAY_MS,
} from "@hackos/shared/live-activities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AndroidLiveUpdateTransport } from "../../src/modules/live-activities/android.js";
import type {
  ApnsRequest,
  ApnsResponse,
  ApnsTransport,
} from "../../src/modules/live-activities/apns.js";
import {
  assignRole,
  createRole,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import {
  allowLiveActivities,
  callEntry,
  closeJudgingWindow,
  createScannableActivity,
  logScan,
  openJudgingWindow,
  participantInQueue,
  registerDevice,
  resetJudgingWindow,
  sessionsOf,
} from "./fixtures.js";

/** #966 push worker: start once, update on change, throttle, end, idempotency, token cleanup. */

class StubApns implements ApnsTransport {
  sent: ApnsRequest[] = [];
  respond: (request: ApnsRequest) => ApnsResponse = () => ({ status: 200 });
  async send(request: ApnsRequest): Promise<ApnsResponse> {
    this.sent.push(request);
    return this.respond(request);
  }
  close(): void {}
  events(): string[] {
    return this.sent.map((r) => (r.payload.aps as { event: string }).event);
  }
}

class StubAndroid implements AndroidLiveUpdateTransport {
  sent: { token: string; message: AndroidLiveUpdateMessage }[] = [];
  result: "ok" | "gone" | "error" = "ok";
  async send(token: string, message: AndroidLiveUpdateMessage) {
    this.sent.push({ token, message });
    return this.result;
  }
}

let apns: StubApns;
let android: StubAndroid;

/** A tick with the permissive test configuration (every kind, every user). */
async function tick() {
  await allowLiveActivities();
  return rawTick();
}

/** A tick with whatever configuration the test set up itself. */
async function rawTick() {
  const { runLiveActivitiesTick } = await import("../../src/modules/live-activities/worker.js");
  return runLiveActivitiesTick({ apns, android });
}

async function setActivityToken(deviceRowId: number, token: string) {
  const { pool } = await import("../../src/db/pool.js");
  await pool.query(
    `UPDATE live_activity_sessions SET activity_push_token = $2 WHERE device_id = $1`,
    [deviceRowId, token],
  );
}

beforeEach(async () => {
  await truncateAll();
  await resetJudgingWindow();
  apns = new StubApns();
  android = new StubAndroid();
});

afterAll(async () => {
  await resetJudgingWindow();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  const { pool } = await import("../../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

describe("queue Live Activity (H38)", () => {
  it("starts once over push-to-start, then updates on change and alerts only on the call", async () => {
    await openJudgingWindow();
    const { userId, entryId, roomId } = await participantInQueue({ position: 2 });
    const device = await registerDevice(userId, { platform: "ios", language: "es" });

    expect(await tick()).toMatchObject({ started: 1, updated: 0, failed: 0 });
    expect(apns.sent).toHaveLength(1);
    const start = apns.sent[0]!;
    expect(start.token).toBe(`pts-${device.deviceId}`);
    expect(start.priority).toBe(10);
    const aps = start.payload.aps as Record<string, unknown>;
    expect(aps).toMatchObject({
      event: "start",
      "attributes-type": "LiveActivityAttributes",
      attributes: { url: "hackos://queue" },
      alert: { title: "Robotics" },
    });
    const state = aps["content-state"] as { name: string; props: string };
    expect(state.name).toBe("QueueActivity");
    expect(JSON.parse(state.props)).toMatchObject({ kind: "queue", phase: "waiting", position: 2 });
    expect((aps.alert as { body: string }).body).toContain("Posición #2");

    // Re-running with nothing changed sends nothing (idempotent).
    expect(await tick()).toMatchObject({ started: 0, updated: 0 });
    expect(apns.sent).toHaveLength(1);

    // Called: no per-activity token yet, so nothing can be sent…
    await callEntry(entryId, roomId);
    await tick();
    expect(apns.sent).toHaveLength(1);

    // …until the app registers it; then one alerting, immediate update.
    await setActivityToken(device.id, "activity-token");
    expect(await tick()).toMatchObject({ updated: 1 });
    const update = apns.sent[1]!;
    expect(update.token).toBe("activity-token");
    expect(update.priority).toBe(10);
    const updateAps = update.payload.aps as Record<string, unknown>;
    expect(updateAps.event).toBe("update");
    expect(updateAps.alert).toEqual({ title: "Robotics", body: "Ve a Room B — Floor 2" });
    expect(updateAps["attributes-type"]).toBeUndefined();
    expect(JSON.parse((updateAps["content-state"] as { props: string }).props)).toMatchObject({
      phase: "called",
      roomName: "Room B",
      position: null,
    });
  });

  it("ends the activity with a dismissal date when the judging window closes", async () => {
    await openJudgingWindow();
    const { userId } = await participantInQueue();
    const device = await registerDevice(userId);
    await tick();
    await setActivityToken(device.id, "activity-token");

    await closeJudgingWindow();
    expect(await tick()).toMatchObject({ ended: 1 });
    const end = apns.sent.at(-1)!;
    const aps = end.payload.aps as Record<string, number | string>;
    expect(aps.event).toBe("end");
    expect(Number(aps["dismissal-date"]) - Number(aps.timestamp)).toBe(0);
    const [session] = await sessionsOf(device.id);
    expect(session).toMatchObject({ end_reason: "finished" });
    expect(session.ended_at).not.toBeNull();

    // Ended stays ended.
    await tick();
    expect(apns.events()).toEqual(["start", "end"]);
  });

  it("keeps a dismissed activity away until its phase changes", async () => {
    await openJudgingWindow();
    const { userId, entryId, roomId } = await participantInQueue();
    const device = await registerDevice(userId);
    await tick();
    const { pool } = await import("../../src/db/pool.js");
    // The user swipes it away while waiting (as DELETE …/sessions records it).
    await pool.query(
      `UPDATE live_activity_sessions
          SET ended_at = now(), end_reason = 'dismissed', dismissed_phase = props->>'phase'
        WHERE device_id = $1`,
      [device.id],
    );
    await tick();
    expect(apns.events()).toEqual(["start"]);

    // Being called is new, essential information: start it again.
    await callEntry(entryId, roomId);
    expect(await tick()).toMatchObject({ started: 1 });
    expect(apns.events()).toEqual(["start", "start"]);
    const [session] = await sessionsOf(device.id);
    expect(session).toMatchObject({ ended_at: null, end_reason: null, dismissed_phase: null });
    expect(session.props.phase).toBe("called");
  });

  it("keeps the dismissal when a phase-change restart fails, and retries it", async () => {
    await openJudgingWindow();
    const { userId, entryId, roomId } = await participantInQueue();
    const device = await registerDevice(userId);
    await tick();
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE live_activity_sessions
          SET ended_at = now(), end_reason = 'dismissed', dismissed_phase = 'waiting'
        WHERE device_id = $1`,
      [device.id],
    );
    await callEntry(entryId, roomId);

    apns.respond = () => ({ status: 503, reason: "ServiceUnavailable" });
    expect(await tick()).toMatchObject({ started: 0, failed: 1 });
    const [kept] = await sessionsOf(device.id);
    expect(kept).toMatchObject({ end_reason: "dismissed", dismissed_phase: "waiting" });
    expect(kept.props.phase).toBe("waiting");

    apns.respond = () => ({ status: 200 });
    expect(await tick()).toMatchObject({ started: 1 });
    const [restarted] = await sessionsOf(device.id);
    expect(restarted).toMatchObject({ ended_at: null, end_reason: null });
    expect(restarted.props.phase).toBe("called");
  });

  it("forgets a dismissal once the subject is over, so the next queue starts again", async () => {
    await openJudgingWindow();
    const { userId, entryId } = await participantInQueue();
    const device = await registerDevice(userId);
    await tick();
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE live_activity_sessions
          SET ended_at = now() - interval '1 second', end_reason = 'dismissed',
              dismissed_phase = 'waiting'
        WHERE device_id = $1`,
      [device.id],
    );
    // The team is done with that queue: nothing is live any more.
    await pool.query(`UPDATE queue_entries SET status = 'completed' WHERE id = $1`, [entryId]);
    await tick();
    expect((await sessionsOf(device.id))[0]).toMatchObject({
      end_reason: "finished",
      dismissed_phase: null,
    });

    // Waiting again, in another queue: a new run, so it starts.
    await participantInQueue({ userId, title: "Fintech", roomName: "Room C" });
    expect(await tick()).toMatchObject({ started: 1 });
    expect(apns.events()).toEqual(["start", "start"]);
  });

  it("re-sends an unchanged queue state before iOS marks it stale", async () => {
    await openJudgingWindow();
    const { userId } = await participantInQueue();
    const device = await registerDevice(userId);
    await tick();
    await setActivityToken(device.id, "activity-token");
    expect(await tick()).toMatchObject({ updated: 0 });

    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE live_activity_sessions SET last_sent_at = now() - interval '16 minutes'
        WHERE device_id = $1`,
      [device.id],
    );
    expect(await tick()).toMatchObject({ updated: 1 });
    const refresh = apns.sent.at(-1)!;
    expect(refresh.priority).toBe(5);
    const aps = refresh.payload.aps as Record<string, unknown>;
    expect(aps.event).toBe("update");
    expect(aps.alert).toBeUndefined();
    expect(Number(aps["stale-date"])).toBeGreaterThan(Number(aps.timestamp));
    expect(await tick()).toMatchObject({ updated: 0 });
  });

  it("an update rejected as gone records the phase the device showed, so the call restarts it", async () => {
    await openJudgingWindow();
    const { userId, entryId, roomId } = await participantInQueue();
    const device = await registerDevice(userId);
    await tick();
    await setActivityToken(device.id, "activity-token");

    // The user removed the waiting activity while the app was not running.
    await callEntry(entryId, roomId);
    apns.respond = (request) =>
      request.token === "activity-token"
        ? { status: 410, reason: "Unregistered" }
        : { status: 200 };
    await tick();
    const [gone] = await sessionsOf(device.id);
    expect(gone).toMatchObject({
      end_reason: "dismissed",
      dismissed_phase: "waiting",
      activity_push_token: null,
    });

    // Being called differs from what was dismissed: push-to-start it again.
    expect(await tick()).toMatchObject({ started: 1 });
    expect(apns.events()).toEqual(["start", "update", "start"]);
    const restart = apns.sent.at(-1)!;
    expect(restart.token).toBe(`pts-${device.deviceId}`);
  });

  it("records the dismissed phase on the next tick when the client sent none", async () => {
    await openJudgingWindow();
    const { userId } = await participantInQueue();
    const device = await registerDevice(userId, { pushToStartToken: null });
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `INSERT INTO live_activity_sessions (device_id, kind, subject, ended_at, end_reason)
       VALUES ($1, 'queue', 'judging', now(), 'dismissed')`,
      [device.id],
    );
    await pool.query(`UPDATE live_activity_devices SET push_to_start_token = 'pts' WHERE id = $1`, [
      device.id,
    ]);
    await tick();
    await tick();
    expect(apns.sent).toHaveLength(0);
    const [session] = await sessionsOf(device.id);
    expect(session.dismissed_phase).toBe("waiting");
  });

  it("produces exactly one start under concurrent ticks", async () => {
    await openJudgingWindow();
    const { userId } = await participantInQueue();
    const device = await registerDevice(userId);
    await allowLiveActivities();
    const results = await Promise.all([rawTick(), rawTick(), rawTick()]);
    expect(apns.events()).toEqual(["start"]);
    expect(results.reduce((n, r) => n + r.started, 0)).toBe(1);
    expect(await sessionsOf(device.id)).toHaveLength(1);
  });

  it("forgets a dead push-to-start token and releases the claim on a transient failure", async () => {
    await openJudgingWindow();
    const { userId } = await participantInQueue();
    const device = await registerDevice(userId);
    const { pool } = await import("../../src/db/pool.js");

    apns.respond = () => ({ status: 503, reason: "ServiceUnavailable" });
    expect(await tick()).toMatchObject({ started: 0, failed: 1 });
    expect(await sessionsOf(device.id)).toHaveLength(0);

    apns.respond = () => ({ status: 400, reason: "BadDeviceToken" });
    await tick();
    expect(await sessionsOf(device.id)).toHaveLength(0);
    const { rows } = await pool.query(
      `SELECT push_to_start_token FROM live_activity_devices WHERE id = $1`,
      [device.id],
    );
    expect(rows[0].push_to_start_token).toBeNull();
  });

  it("does nothing for iOS when APNs is not configured", async () => {
    await openJudgingWindow();
    const { userId } = await participantInQueue();
    const device = await registerDevice(userId);
    const { runLiveActivitiesTick } = await import("../../src/modules/live-activities/worker.js");
    expect(await runLiveActivitiesTick({ apns: null, android })).toMatchObject({ started: 0 });
    expect(await sessionsOf(device.id)).toHaveLength(0);
  });

  it("keeps an iOS session open while APNs is not configured, instead of faking its end", async () => {
    await openJudgingWindow();
    const { userId } = await participantInQueue();
    const device = await registerDevice(userId);
    await tick();
    await setActivityToken(device.id, "activity-token");
    await closeJudgingWindow();
    const { runLiveActivitiesTick } = await import("../../src/modules/live-activities/worker.js");
    expect(await runLiveActivitiesTick({ apns: null, android })).toMatchObject({ ended: 0 });
    expect((await sessionsOf(device.id))[0]).toMatchObject({ ended_at: null });

    // Once APNs is available, the end is actually delivered.
    expect(await tick()).toMatchObject({ ended: 1 });
    expect(apns.events()).toEqual(["start", "end"]);
  });

  it("ends the queue activity when its queue entries are deleted", async () => {
    await openJudgingWindow();
    const { userId, entryId } = await participantInQueue();
    const ios = await registerDevice(userId);
    const droid = await registerDevice(userId, { platform: "android" });
    await tick();
    await setActivityToken(ios.id, "activity-token");

    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`DELETE FROM queue_entries WHERE id = $1`, [entryId]);
    expect(await tick()).toMatchObject({ ended: 2, failed: 0 });
    expect(apns.events()).toEqual(["start", "end"]);
    expect(apns.sent.at(-1)!.token).toBe("activity-token");
    expect(android.sent.map((s) => s.message.hackosLiveUpdate.event)).toEqual(["start", "end"]);
    for (const device of [ios, droid]) {
      expect((await sessionsOf(device.id))[0]).toMatchObject({ end_reason: "finished" });
    }
  });

  it("keeps an iOS session without its activity token open until the app reports it, then ends it", async () => {
    await openJudgingWindow();
    const { userId, entryId, roomId } = await participantInQueue();
    const device = await registerDevice(userId);
    await tick();

    // Push-started; the app has not reported the activity's token: an end
    // could not reach it, so the session is not marked ended.
    await closeJudgingWindow();
    expect(await tick()).toMatchObject({ ended: 0 });
    expect((await sessionsOf(device.id))[0]).toMatchObject({ ended_at: null });

    // The subject returns: still one activity, so no second push-to-start.
    await openJudgingWindow();
    await callEntry(entryId, roomId);
    expect(await tick()).toMatchObject({ started: 0 });
    await closeJudgingWindow();
    await tick();

    // The app reports the token (PUT …/sessions): the next tick ends it.
    await setActivityToken(device.id, "activity-token");
    expect(await tick()).toMatchObject({ ended: 1 });
    expect(apns.events()).toEqual(["start", "end"]);
    expect(apns.sent.at(-1)!.token).toBe("activity-token");
  });

  it("closes a token-less iOS session once ActivityKit has removed the activity", async () => {
    await openJudgingWindow();
    const { userId } = await participantInQueue();
    const device = await registerDevice(userId);
    await tick();
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE live_activity_sessions SET started_at = now() - interval '13 hours'
        WHERE device_id = $1`,
      [device.id],
    );
    await closeJudgingWindow();
    await tick();
    expect((await sessionsOf(device.id))[0]).toMatchObject({ end_reason: "finished" });
    expect(apns.events()).toEqual(["start"]);
  });

  it("leaves starts to the app while it is reading its state in the foreground", async () => {
    await openJudgingWindow();
    const { userId } = await participantInQueue();
    const device = await registerDevice(userId);
    const { markDeviceForeground } = await import(
      "../../src/modules/live-activities/foreground.js"
    );
    await markDeviceForeground(device.id);
    expect(await tick()).toMatchObject({ started: 0 });
    expect(apns.sent).toHaveLength(0);

    const { valkey } = await import("../../src/lib/valkey.js");
    await valkey.del(`live-activities:foreground:${device.id}`);
    expect(await tick()).toMatchObject({ started: 1 });
  });

  it("ends open sessions of a device the user disabled", async () => {
    await openJudgingWindow();
    const { userId } = await participantInQueue();
    const device = await registerDevice(userId, { platform: "android" });
    await tick();
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE live_activity_devices SET enabled = false WHERE id = $1`, [device.id]);
    expect(await tick()).toMatchObject({ ended: 1 });
    expect(android.sent.map((s) => s.message.hackosLiveUpdate.event)).toEqual(["start", "end"]);
    expect(android.sent[1]!.message.hackosLiveUpdate.props).toBeUndefined();
  });
});

describe("staff activity Live Activity (H25, H26)", () => {
  it("sends Android data pushes; counter updates are throttled, phase changes are not", async () => {
    const staffId = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    const device = await registerDevice(staffId, { platform: "android" });
    const activityId = await createScannableActivity({ startsInMinutes: -5 });
    const { pool } = await import("../../src/db/pool.js");

    expect(await tick()).toMatchObject({ started: 1 });
    expect(android.sent[0]).toMatchObject({
      token: `ExponentPushToken[${device.deviceId}]`,
      message: {
        hackosLiveUpdate: {
          event: "start",
          kind: "activity",
          subject: `activity:${activityId}`,
          props: { kind: "activity", phase: "live", scanned: 0 },
        },
      },
    });

    // A new scan within 30 s of the last push waits for the throttle.
    await logScan(activityId, await createUser());
    expect(await tick()).toMatchObject({ updated: 0 });
    await pool.query(
      `UPDATE live_activity_sessions SET last_sent_at = now() - interval '31 seconds'
        WHERE device_id = $1`,
      [device.id],
    );
    expect(await tick()).toMatchObject({ updated: 1 });
    expect(android.sent[1]!.message.hackosLiveUpdate).toMatchObject({
      event: "update",
      props: { scanned: 1 },
    });

    // The activity is over: end it.
    await pool.query(
      `UPDATE schedule SET ends_at = now() - interval '1 minute'
        WHERE id = (SELECT schedule_id FROM activities WHERE id = $1)`,
      [activityId],
    );
    expect(await tick()).toMatchObject({ ended: 1 });
    expect(android.sent[2]!.message.hackosLiveUpdate).toEqual({
      event: "end",
      kind: "activity",
      subject: `activity:${activityId}`,
    });
  });

  it("is only for ACTIVITY_SCAN holders and clears a DeviceNotRegistered Expo token", async () => {
    const plain = await createUser();
    await registerDevice(plain, { platform: "android" });
    const staffId = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    const device = await registerDevice(staffId, { platform: "android" });
    await createScannableActivity({ startsInMinutes: 10 });

    android.result = "gone";
    await tick();
    expect(android.sent).toHaveLength(1);
    expect(android.sent[0]!.token).toBe(`ExponentPushToken[${device.deviceId}]`);
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT expo_push_token FROM live_activity_devices WHERE id = $1`,
      [device.id],
    );
    expect(rows[0].expo_push_token).toBeNull();
    expect(await sessionsOf(device.id)).toHaveLength(0);
  });

  it("pushes a rescheduled activity at once on both platforms, past the counter throttle", async () => {
    const staffId = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    const phone = await registerDevice(staffId, { platform: "ios" });
    const tablet = await registerDevice(staffId, { platform: "android" });
    const activityId = await createScannableActivity({ startsInMinutes: 10 });
    expect(await tick()).toMatchObject({ started: 2 });
    await setActivityToken(phone.id, "activity-token");
    const { pool } = await import("../../src/db/pool.js");

    // An organizer moves it 5 minutes later, right after the start push.
    const { rows } = await pool.query<{ starts_at: Date; ends_at: Date }>(
      `UPDATE schedule SET starts_at = starts_at + interval '5 minutes',
              ends_at = ends_at + interval '5 minutes'
        WHERE id = (SELECT schedule_id FROM activities WHERE id = $1)
        RETURNING starts_at, ends_at`,
      [activityId],
    );
    const startsAt = rows[0]!.starts_at.toISOString();
    const endsAt = rows[0]!.ends_at.toISOString();
    expect(await tick()).toMatchObject({ updated: 2 });

    const ios = apns.sent[1]!;
    expect(ios.priority).toBe(10);
    const aps = ios.payload.aps as Record<string, unknown>;
    expect(aps.event).toBe("update");
    expect(JSON.parse((aps["content-state"] as { props: string }).props)).toMatchObject({
      phase: "upcoming",
      startsAt,
      endsAt,
    });
    // Still upcoming: stale at the new start (minus iOS's leeway), when the
    // widget turns live.
    expect(aps["stale-date"]).toBe(
      Math.floor((rows[0]!.starts_at.getTime() - LIVE_ACTIVITY_STALE_LEEWAY_MS) / 1000),
    );
    expect(android.sent[1]).toMatchObject({
      token: `ExponentPushToken[${tablet.deviceId}]`,
      message: { hackosLiveUpdate: { event: "update", props: { startsAt, endsAt } } },
    });
  });

  it("replaces an iOS activity before ActivityKit's 8-hour limit", async () => {
    const staffId = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    const device = await registerDevice(staffId);
    await createScannableActivity({ startsInMinutes: -60, durationMinutes: 12 * 60 });
    expect(await tick()).toMatchObject({ started: 1 });
    await setActivityToken(device.id, "old-token");
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE live_activity_sessions SET started_at = now() - interval '7 hours 46 minutes'
        WHERE device_id = $1`,
      [device.id],
    );

    expect(await tick()).toMatchObject({ ended: 1, started: 1 });
    expect(apns.events()).toEqual(["start", "end", "start"]);
    const end = apns.sent[1]!;
    expect(end.token).toBe("old-token");
    const aps = end.payload.aps as Record<string, number>;
    // Gone from the Lock Screen at once: the replacement takes its place.
    expect(aps["dismissal-date"]).toBe(aps.timestamp);
    expect(apns.sent[2]!.token).toBe(`pts-${device.deviceId}`);
    const [session] = await sessionsOf(device.id);
    expect(session).toMatchObject({ ended_at: null, activity_push_token: null });

    // The fresh one is not replaced again.
    await setActivityToken(device.id, "new-token");
    expect(await tick()).toMatchObject({ ended: 0, started: 0 });
  });

  it("starts a finished activity again when it becomes relevant again", async () => {
    const staffId = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    const device = await registerDevice(staffId, { platform: "android" });
    const activityId = await createScannableActivity({ startsInMinutes: 10 });
    await tick();
    const { pool } = await import("../../src/db/pool.js");
    const scheduleId = `(SELECT schedule_id FROM activities WHERE id = $1)`;
    await pool.query(
      `UPDATE schedule SET starts_at = now() + interval '2 hours', ends_at = now() + interval '3 hours'
        WHERE id = ${scheduleId}`,
      [activityId],
    );
    await tick();
    await pool.query(
      `UPDATE schedule SET starts_at = now() + interval '5 minutes' WHERE id = ${scheduleId}`,
      [activityId],
    );
    await tick();
    expect(android.sent.map((s) => s.message.hackosLiveUpdate.event)).toEqual([
      "start",
      "end",
      "start",
    ]);
    const [session] = await sessionsOf(device.id);
    expect(session.ended_at).toBeNull();
  });
});

describe("configurable kinds in the worker (#966)", () => {
  async function pool() {
    return (await import("../../src/db/pool.js")).pool;
  }

  function apsOf(index: number) {
    return apns.sent[index]!.payload.aps as Record<string, unknown>;
  }

  function propsOf(index: number) {
    return JSON.parse((apsOf(index)["content-state"] as { props: string }).props);
  }

  it("deadline: starts with the countdown, alerts once when a draft enters closing, ends at the deadline", async () => {
    const db = await pool();
    const userId = await createUser();
    await assignRole(userId, await createRole([CAPABILITIES.QUEUE_STATUS], { eventAccess: true }));
    const group = await db.query<{ id: number }>(
      `INSERT INTO repos (name,created_by,submission_status) VALUES ('Rocket',$1,'draft') RETURNING id`,
      [userId],
    );
    await db.query(`INSERT INTO submissions (repo_id, user_id, status) VALUES ($1, $2, 'active')`, [
      group.rows[0]!.id,
      userId,
    ]);
    await db.query(
      `INSERT INTO event_config (id, hacking_starts_at, hacking_ends_at)
       VALUES (1, now() - interval '20 hours', now() + interval '1 hour')
       ON CONFLICT (id) DO UPDATE SET hacking_starts_at = EXCLUDED.hacking_starts_at,
                                      hacking_ends_at = EXCLUDED.hacking_ends_at`,
    );
    const device = await registerDevice(userId, { language: "en" });

    expect(await tick()).toMatchObject({ started: 1 });
    expect(apsOf(0)).toMatchObject({
      event: "start",
      attributes: { url: "hackos://project" },
      alert: { title: "Submissions close" },
    });
    expect((apsOf(0)["content-state"] as { name: string }).name).toBe("DeadlineActivity");
    expect(propsOf(0)).toMatchObject({ kind: "deadline", phase: "open", submission: "draft" });
    // stale-date is the deadline itself.
    const ends = Math.floor(new Date(propsOf(0).endsAt).getTime() / 1000);
    expect(apsOf(0)["stale-date"]).toBe(ends);
    await setActivityToken(device.id, "deadline-token");

    await db.query(`UPDATE event_config SET hacking_ends_at = now() + interval '10 minutes'`);
    expect(await tick()).toMatchObject({ updated: 1 });
    expect(apns.sent[1]!.priority).toBe(10);
    expect(apsOf(1).alert).toMatchObject({ title: "Submissions close" });
    expect((apsOf(1).alert as { body: string }).body).toContain("Not submitted · Rocket");
    expect(propsOf(1).phase).toBe("closing");

    await db.query(`UPDATE event_config SET hacking_ends_at = now() - interval '1 second'`);
    expect(await tick()).toMatchObject({ ended: 1 });
    expect(apsOf(2).event).toBe("end");
  });

  it("accreditation: Scan opens the scanner; counters are throttled", async () => {
    const db = await pool();
    const desk = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
    await db.query(
      `INSERT INTO event_config (id, event_starts_at) VALUES (1, now() + interval '10 minutes')
       ON CONFLICT (id) DO UPDATE SET event_starts_at = EXCLUDED.event_starts_at,
                                      hacking_starts_at = NULL`,
    );
    const device = await registerDevice(desk);
    expect(await tick()).toMatchObject({ started: 1 });
    expect(apsOf(0)).toMatchObject({ attributes: { url: "hackos://scan" } });
    expect(propsOf(0)).toMatchObject({
      kind: "accreditation",
      accredited: 0,
      scanUrl: "hackos://scan",
    });
    await setActivityToken(device.id, "desk-token");

    const arrival = await createUser();
    await db.query(`UPDATE users SET badge_id = 'B-1' WHERE id = $1`, [arrival]);
    expect(await tick()).toMatchObject({ updated: 0 });
    await db.query(
      `UPDATE live_activity_sessions SET last_sent_at = now() - interval '31 seconds'
        WHERE device_id = $1`,
      [device.id],
    );
    expect(await tick()).toMatchObject({ updated: 1 });
    expect(apns.sent[1]!.priority).toBe(5);
    expect(propsOf(1)).toMatchObject({ accredited: 1, recentArrivals: 1 });
  });

  it("attendee activity: countdown, then live, then ended", async () => {
    const db = await pool();
    const attendee = await createUser();
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO schedule (title, location, type, starts_at, ends_at, visibility, audiences,
                             live_activity_audience)
       VALUES ('Keynote', 'Aula 1', 'talk', now() + interval '5 minutes', now() + interval '50 minutes',
               'shown', '{participant}', true) RETURNING id`,
    );
    const scheduleId = rows[0]!.id;
    const device = await registerDevice(attendee, { platform: "android" });

    expect(await tick()).toMatchObject({ started: 1 });
    expect(android.sent[0]!.message.hackosLiveUpdate).toMatchObject({
      kind: "attendee_activity",
      subject: `schedule:${scheduleId}`,
      props: { phase: "upcoming", url: `hackos://schedule/${scheduleId}` },
    });

    await db.query(`UPDATE schedule SET starts_at = now() - interval '1 minute' WHERE id = $1`, [
      scheduleId,
    ]);
    expect(await tick()).toMatchObject({ updated: 1 });
    expect(android.sent[1]!.message.hackosLiveUpdate.props?.phase).toBe("live");

    await db.query(`UPDATE schedule SET ends_at = now() - interval '1 second' WHERE id = $1`, [
      scheduleId,
    ]);
    expect(await tick()).toMatchObject({ ended: 1 });
    expect(await sessionsOf(device.id)).toMatchObject([{ end_reason: "finished" }]);
  });

  it("turns live on time: stale at the start, a tick scheduled at the start and the end (H25, H26, H59)", async () => {
    const db = await pool();
    const { getQueue } = await import("../../src/lib/queues.js");
    const { LIVE_ACTIVITIES_BOUNDARY_MARGIN_MS, LIVE_ACTIVITIES_QUEUE, liveActivityBoundaryJobId } =
      await import("../../src/modules/live-activities/kick.js");
    const queue = getQueue(LIVE_ACTIVITIES_QUEUE);
    await queue.obliterate({ force: true });
    const attendee = await createUser();
    const { rows } = await db.query<{ id: number; starts_at: Date; ends_at: Date }>(
      `INSERT INTO schedule (title, type, starts_at, ends_at, visibility, audiences,
                             live_activity_audience)
       VALUES ('Keynote', 'talk', now() + interval '5 minutes', now() + interval '50 minutes',
               'shown', '{participant}', true) RETURNING id, starts_at, ends_at`,
    );
    const { id: scheduleId, starts_at: startsAt, ends_at: endsAt } = rows[0]!;
    const device = await registerDevice(attendee, { language: "es" });

    const before = Date.now();
    expect(await tick()).toMatchObject({ started: 1 });
    // iOS marks the upcoming state stale at the start and re-renders it as
    // live then, without the push below.
    expect(apsOf(0)["stale-date"]).toBe(
      Math.floor((startsAt.getTime() - LIVE_ACTIVITY_STALE_LEEWAY_MS) / 1000),
    );
    expect(propsOf(0)).toMatchObject({
      phase: "upcoming",
      labels: { live: "En curso", endsIn: "Acaba en" },
    });
    const atStart = await queue.getJob(liveActivityBoundaryJobId(startsAt));
    expect(atStart?.name).toBe("boundary");
    const delay = atStart!.opts.delay!;
    expect(delay).toBeLessThanOrEqual(
      startsAt.getTime() - before + LIVE_ACTIVITIES_BOUNDARY_MARGIN_MS,
    );
    expect(delay).toBeGreaterThan(startsAt.getTime() - Date.now());
    // Requested again by the next tick, still one job for the instant.
    await tick();
    const pending = await queue.getJobs(["delayed"]);
    expect(pending.filter((job) => job.id === atStart!.id)).toHaveLength(1);
    await setActivityToken(device.id, "keynote-token");

    // The boundary tick: the start has passed.
    await db.query(`UPDATE schedule SET starts_at = now() - interval '1 second' WHERE id = $1`, [
      scheduleId,
    ]);
    expect(await tick()).toMatchObject({ updated: 1 });
    expect(apns.sent.at(-1)!.priority).toBe(10);
    const live = apns.sent.at(-1)!.payload.aps as Record<string, unknown>;
    expect(JSON.parse((live["content-state"] as { props: string }).props).phase).toBe("live");
    expect(live["stale-date"]).toBe(Math.floor(endsAt.getTime() / 1000));
    expect(await queue.getJob(liveActivityBoundaryJobId(endsAt))).toBeTruthy();
  });

  it("schedules a tick at the next countdown width change and sends its flag change unthrottled (#966)", async () => {
    const db = await pool();
    const { getQueue } = await import("../../src/lib/queues.js");
    const { LIVE_ACTIVITIES_QUEUE, liveActivityBoundaryJobId } = await import(
      "../../src/modules/live-activities/kick.js"
    );
    const queue = getQueue(LIVE_ACTIVITIES_QUEUE);
    await queue.obliterate({ force: true });
    const attendee = await createUser();
    // 10 min 5 s to the start: the minutes field has two places until it drops below 10 min.
    const { rows } = await db.query<{ id: number; starts_at: Date }>(
      `INSERT INTO schedule (title, type, starts_at, ends_at, visibility, audiences,
                             live_activity_audience)
       VALUES ('Keynote', 'talk', now() + interval '10 minutes 5 seconds', now() + interval '2 hours',
               'shown', '{participant}', true) RETURNING id, starts_at`,
    );
    const startsAt = rows[0]!.starts_at;
    await registerDevice(attendee, { platform: "android" });

    expect(await tick()).toMatchObject({ started: 1 });
    expect(android.sent[0]!.message.hackosLiveUpdate.props).toMatchObject({
      countdownUnderTenMinutes: false,
      countdownLastFiveMinutes: false,
    });
    // The next width change, ten minutes before the start, has its own tick.
    const tenMinutes = new Date(startsAt.getTime() - 600_000);
    expect((await queue.getJob(liveActivityBoundaryJobId(tenMinutes)))?.name).toBe("boundary");

    // The session last saw the other side of the flag, right after its previous
    // send: the flag change is not held by the 30 s counter throttle.
    await db.query(
      `UPDATE live_activity_sessions
          SET state_hash = 'stale', props = jsonb_set(props, '{countdownUnderTenMinutes}', 'true')`,
    );
    expect(await tick()).toMatchObject({ updated: 1 });
    expect(android.sent[1]!.message.hackosLiveUpdate.props).toMatchObject({
      countdownUnderTenMinutes: false,
    });
  });

  it("a higher-priority kind displaces a running lower one beyond maxConcurrent", async () => {
    const db = await pool();
    await openJudgingWindow();
    const { userId } = await participantInQueue();
    const device = await registerDevice(userId);
    await allowLiveActivities({ maxConcurrent: 1 });
    expect(await rawTick()).toMatchObject({ started: 1 });
    expect(propsOf(0)).toMatchObject({ kind: "queue", rank: 0 });
    expect(apsOf(0)["relevance-score"]).toBe(100);
    await setActivityToken(device.id, "queue-token");

    // An opted-in talk for the participant outranks the queue by default.
    await db.query(
      `INSERT INTO schedule (title, starts_at, ends_at, visibility, audiences, live_activity_audience)
       VALUES ('Keynote', now() + interval '5 minutes', now() + interval '1 hour', 'shown',
               '{participant}', true)`,
    );
    await allowLiveActivities({ maxConcurrent: 1 });
    expect(await rawTick()).toMatchObject({ started: 1, ended: 1 });
    expect(apns.events()).toEqual(["start", "start", "end"]);
    const sessions = await sessionsOf(device.id);
    expect(sessions.find((s) => s.kind === "queue")).toMatchObject({ end_reason: "finished" });

    // Within a kind nothing flaps: a re-run changes nothing.
    await allowLiveActivities({ maxConcurrent: 1 });
    expect(await rawTick()).toMatchObject({ started: 0, ended: 0, updated: 0 });
  });

  it("ends a running activity once its kind is disabled", async () => {
    const db = await pool();
    const staffId = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    await registerDevice(staffId, { platform: "android" });
    await createScannableActivity({ startsInMinutes: 5 });
    await tick();
    await db.query(
      `UPDATE live_activity_kind_settings SET enabled = false WHERE kind = 'activity'`,
    );
    expect(await rawTick()).toMatchObject({ ended: 1 });
  });
});
