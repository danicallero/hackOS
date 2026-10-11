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
    });
    // No activity:scan, no accredit:scan, no queue:status with event access.
    expect(
      (await getPreferences(plainId)).json().kinds.map((k: { kind: string }) => k.kind),
    ).toEqual(["queue", "attendee_activity"]);
    expect((await getPreferences(outsiderId)).json()).toEqual({ kinds: [] });

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
