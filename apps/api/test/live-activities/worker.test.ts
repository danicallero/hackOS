import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { AndroidLiveUpdateMessage } from "@hackos/shared/live-activities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { AndroidLiveUpdateTransport } from "../../src/modules/live-activities/android.js";
import type {
  ApnsRequest,
  ApnsResponse,
  ApnsTransport,
} from "../../src/modules/live-activities/apns.js";
import { createUser, createUserWithCapabilities, truncateAll } from "../helpers.js";
import {
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

async function tick() {
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
    expect(Number(aps["dismissal-date"]) - Number(aps.timestamp)).toBe(15 * 60);
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
    const results = await Promise.all([tick(), tick(), tick()]);
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
