import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { AndroidLiveUpdateMessage } from "@hackos/shared/live-activities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import type { AndroidLiveUpdateTransport } from "../../src/modules/live-activities/android.js";
import type { ApnsTransport } from "../../src/modules/live-activities/apns.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import {
  allowLiveActivities,
  createScannableActivity,
  openJudgingWindow,
  participantInQueue,
  registerDevice,
  resetJudgingWindow,
  sessionsOf,
} from "./fixtures.js";

/** #966 per-kind Live Activity preferences (H38, H25, H59, H19, H22). */

let app: App;

class StubAndroid implements AndroidLiveUpdateTransport {
  sent: AndroidLiveUpdateMessage[] = [];
  async send(_token: string, message: AndroidLiveUpdateMessage) {
    this.sent.push(message);
    return "ok" as const;
  }
}

const noApns: ApnsTransport = {
  send: async () => ({ status: 200 }),
  close: () => undefined,
};

beforeEach(async () => {
  await truncateAll();
  await resetJudgingWindow();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
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

function getPreferences(userId: number) {
  return app.inject({
    method: "GET",
    url: "/api/me/live-activities/preferences",
    headers: asUser(userId),
  });
}

function putPreferences(userId: number, payload: unknown) {
  return app.inject({
    method: "PUT",
    url: "/api/me/live-activities/preferences",
    headers: asUser(userId),
    payload: payload as Record<string, unknown>,
  });
}

async function tick(android: StubAndroid) {
  const { runLiveActivitiesTick } = await import("../../src/modules/live-activities/worker.js");
  return runLiveActivitiesTick({ apns: noApns, android });
}

describe("GET /api/me/live-activities/preferences", () => {
  it("requires a session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/live-activities/preferences" });
    expect(res.statusCode).toBe(401);
  });

  it("lists only the kinds the caller is entitled to, in priority order", async () => {
    const staffId = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    const plainId = await createUser();
    await allowLiveActivities({
      kinds: ["queue", "activity", "attendee_activity", "accreditation", "deadline"],
    });
    // Not in the audience role: nothing, whatever the capabilities.
    const outsiderId = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);

    expect((await getPreferences(staffId)).json()).toEqual({
      kinds: [
        { kind: "queue", enabled: true },
        { kind: "activity", enabled: true },
        { kind: "attendee_activity", enabled: true },
      ],
      customOrder: false,
    });
    // No activity:scan, no accredit:scan, no queue:status with event access.
    expect(
      (await getPreferences(plainId)).json().kinds.map((k: { kind: string }) => k.kind),
    ).toEqual(["queue", "attendee_activity"]);
    expect((await getPreferences(outsiderId)).json()).toEqual({ kinds: [], customOrder: false });

    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE live_activity_kind_settings SET enabled = false WHERE kind = 'queue'`);
    expect((await getPreferences(plainId)).json().kinds).toEqual([
      { kind: "attendee_activity", enabled: true },
    ]);
  });
});

describe("PUT /api/me/live-activities/preferences", () => {
  it("updates only the listed kinds and replays idempotently", async () => {
    const userId = await createUser();
    await allowLiveActivities();
    const off = await putPreferences(userId, { kinds: [{ kind: "queue", enabled: false }] });
    expect(off.statusCode).toBe(200);
    expect(off.json().kinds).toEqual([
      { kind: "attendee_activity", enabled: true },
      { kind: "queue", enabled: false },
    ]);
    const again = await putPreferences(userId, { kinds: [{ kind: "queue", enabled: false }] });
    expect(again.json()).toEqual(off.json());
    expect((await getPreferences(userId)).json()).toEqual(off.json());

    // A kind the caller does not receive is kept for later, not shown.
    await putPreferences(userId, { kinds: [{ kind: "accreditation", enabled: false }] });
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT kind FROM live_activity_kind_opt_outs WHERE user_id = $1 ORDER BY kind`,
      [userId],
    );
    expect(rows.map((r) => r.kind)).toEqual(["accreditation", "queue"]);

    const on = await putPreferences(userId, { kinds: [{ kind: "queue", enabled: true }] });
    expect(on.json().kinds).toContainEqual({ kind: "queue", enabled: true });
  });

  it("is personal data: listed in the H54 export bundle", async () => {
    const userId = await createUser();
    await putPreferences(userId, { kinds: [{ kind: "deadline", enabled: false }] });
    const { buildExportBundle } = await import("../../src/modules/exports/bundle.js");
    const bundle = (await buildExportBundle(userId)) as {
      notifications: { liveActivityKindOptOuts: { kind: string }[] };
    };
    expect(bundle.notifications.liveActivityKindOptOuts).toEqual([
      expect.objectContaining({ kind: "deadline" }),
    ]);
  });

  it("rejects an unknown kind, a repeated kind and an empty list", async () => {
    const userId = await createUser();
    for (const payload of [
      { kinds: [{ kind: "weather", enabled: false }] },
      {
        kinds: [
          { kind: "queue", enabled: false },
          { kind: "queue", enabled: true },
        ],
      },
      { kinds: [] },
      { kinds: [{ kind: "queue" }] },
      {},
      { order: [] },
      { order: ["queue", "queue"] },
      { order: ["weather"] },
    ]) {
      expect((await putPreferences(userId, payload)).statusCode).toBe(400);
    }
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(`SELECT 1 FROM live_activity_kind_opt_outs`);
    expect(rows).toHaveLength(0);
  });
});

describe("opting out in the read model and the worker", () => {
  it("drops the kind, ends its running session, and lets it start again once back on", async () => {
    const staffId = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    await allowLiveActivities();
    const device = await registerDevice(staffId, { platform: "android" });
    await createScannableActivity({ startsInMinutes: 5 });
    const android = new StubAndroid();

    expect(await tick(android)).toMatchObject({ started: 1 });

    await putPreferences(staffId, { kinds: [{ kind: "activity", enabled: false }] });
    const read = await app.inject({
      method: "GET",
      url: "/api/me/live-activities",
      headers: asUser(staffId),
    });
    expect(read.json().activities).toEqual([]);
    expect(await tick(android)).toMatchObject({ ended: 1 });
    expect(android.sent.at(-1)).toMatchObject({ hackosLiveUpdate: { event: "end" } });
    // Turned off: never started again.
    expect(await tick(android)).toMatchObject({ started: 0, ended: 0 });
    expect((await sessionsOf(device.id))[0]).toMatchObject({ end_reason: "finished" });

    await putPreferences(staffId, { kinds: [{ kind: "activity", enabled: true }] });
    expect(await tick(android)).toMatchObject({ started: 1 });
    expect((await sessionsOf(device.id))[0]).toMatchObject({ ended_at: null });
  });

  it("is per account: another user's choice does not affect the caller", async () => {
    const a = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    const b = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    await allowLiveActivities();
    await createScannableActivity({ startsInMinutes: 5 });
    await putPreferences(a, { kinds: [{ kind: "activity", enabled: false }] });
    const read = (userId: number) =>
      app.inject({ method: "GET", url: "/api/me/live-activities", headers: asUser(userId) });
    expect((await read(a)).json().activities).toHaveLength(0);
    expect((await read(b)).json().activities).toHaveLength(1);
  });
});

describe("kind order (per user)", () => {
  /** A scanner with a running activity and a queue entry: two kinds, one slot. */
  async function staffInQueue() {
    await openJudgingWindow();
    const staffId = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    await participantInQueue({ userId: staffId });
    // Organizer default: activity before queue.
    await allowLiveActivities({ maxConcurrent: 1 });
    await createScannableActivity({ startsInMinutes: 5 });
    return staffId;
  }

  function myLiveActivities(userId: number) {
    return app.inject({ method: "GET", url: "/api/me/live-activities", headers: asUser(userId) });
  }

  async function storedOrder(userId: number) {
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT kinds FROM live_activity_kind_orders WHERE user_id = $1`,
      [userId],
    );
    return rows[0]?.kinds ?? null;
  }

  it("defaults to the organizer order, and the user's order changes the cut", async () => {
    const staffId = await staffInQueue();
    const kinds = async () =>
      (await getPreferences(staffId)).json().kinds.map((k: { kind: string }) => k.kind);
    expect(await kinds()).toEqual(["activity", "attendee_activity", "queue"]);
    const before = (await myLiveActivities(staffId)).json();
    expect(before.activities).toHaveLength(1);
    expect(before.queue).toBeNull();

    const res = await putPreferences(staffId, { order: ["queue", "activity"] });
    expect(res.statusCode).toBe(200);
    // Unlisted kinds follow in the organizer order.
    expect(res.json()).toMatchObject({ customOrder: true });
    expect(await kinds()).toEqual(["queue", "activity", "attendee_activity"]);
    const after = (await myLiveActivities(staffId)).json();
    expect(after.queue).toMatchObject({ rank: 0 });
    expect(after.activities).toEqual([]);

    // Only this user: another scanner keeps the organizer order.
    const otherId = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
    await participantInQueue({ userId: otherId, title: "Fintech", roomName: "Room C" });
    await allowLiveActivities({ maxConcurrent: 1 });
    expect((await myLiveActivities(otherId)).json().activities).toHaveLength(1);
  });

  it("applies in the worker: the user's first kind displaces the running one", async () => {
    const staffId = await staffInQueue();
    const device = await registerDevice(staffId, { platform: "android" });
    const android = new StubAndroid();
    expect(await tick(android)).toMatchObject({ started: 1 });
    expect((await sessionsOf(device.id))[0]).toMatchObject({ kind: "activity" });

    await putPreferences(staffId, { order: ["queue"] });
    await tick(android);
    const sessions = await sessionsOf(device.id);
    expect(sessions.find((s) => s.kind === "activity")).toMatchObject({ end_reason: "finished" });
    expect(sessions.find((s) => s.kind === "queue")).toMatchObject({ ended_at: null });
  });

  it("resets with null, stores none for the organizer order, and is idempotent", async () => {
    const staffId = await staffInQueue();
    const first = await putPreferences(staffId, { order: ["queue", "activity"] });
    const again = await putPreferences(staffId, { order: ["queue", "activity"] });
    expect(again.json()).toEqual(first.json());
    expect(await storedOrder(staffId)).toEqual(["queue", "activity"]);

    const reset = await putPreferences(staffId, { order: null });
    expect(reset.json()).toMatchObject({ customOrder: false });
    expect(await storedOrder(staffId)).toBeNull();
    expect((await myLiveActivities(staffId)).json().activities).toHaveLength(1);

    // The organizer order sent back as the user's: nothing stored, so a later
    // organizer reorder still applies.
    const same = await putPreferences(staffId, { order: ["activity", "attendee_activity"] });
    expect(same.json()).toMatchObject({ customOrder: false });
    expect(await storedOrder(staffId)).toBeNull();
    await allowLiveActivities({
      maxConcurrent: 1,
      kinds: ["queue", "activity", "attendee_activity"],
    });
    expect((await myLiveActivities(staffId)).json().queue).not.toBeNull();
  });

  it("ignores kinds the user does not receive, and saves order with kinds at once", async () => {
    const staffId = await staffInQueue();
    // accreditation needs accredit:scan, deadline event access: dropped.
    const res = await putPreferences(staffId, {
      order: ["accreditation", "deadline", "queue"],
      kinds: [{ kind: "attendee_activity", enabled: false }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      kinds: [
        { kind: "queue", enabled: true },
        { kind: "activity", enabled: true },
        { kind: "attendee_activity", enabled: false },
      ],
      customOrder: true,
    });
    expect(await storedOrder(staffId)).toEqual(["queue"]);
    // Only unreceived kinds: the same as the organizer order.
    await putPreferences(staffId, { order: ["accreditation"] });
    expect(await storedOrder(staffId)).toBeNull();
  });

  it("serializes concurrent saves: one order wins whole", async () => {
    const staffId = await staffInQueue();
    const orders = [
      ["queue", "attendee_activity", "activity"],
      ["attendee_activity", "queue", "activity"],
      ["queue", "activity", "attendee_activity"],
    ];
    const results = await Promise.all(orders.map((order) => putPreferences(staffId, { order })));
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect(orders).toContainEqual(await storedOrder(staffId));
  });

  it("is personal data: listed in the H54 export bundle", async () => {
    const staffId = await staffInQueue();
    await putPreferences(staffId, { order: ["queue"] });
    const { buildExportBundle } = await import("../../src/modules/exports/bundle.js");
    const bundle = (await buildExportBundle(staffId)) as {
      notifications: { liveActivityKindOrder: { kinds: string[] } | null };
    };
    expect(bundle.notifications.liveActivityKindOrder).toMatchObject({ kinds: ["queue"] });
  });
});
