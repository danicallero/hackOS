import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { LIVE_ACTIVITY_CONFIG_KINDS } from "@hackos/shared/live-activities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createRole,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

/** #966 organizer configuration of Live Activity kinds (H8, H53). */

let app: App;

beforeEach(async () => {
  await truncateAll();
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

function put(userId: number, payload: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: "PUT",
    url: "/api/live-activities/settings",
    headers: { ...asUser(userId), ...headers },
    payload: payload as Record<string, unknown>,
  });
}

function body(order: readonly string[], roleIds: number[] = [], maxConcurrent = 2) {
  return {
    maxConcurrent,
    kinds: order.map((kind) => ({ kind, enabled: kind !== "deadline", roleIds })),
  };
}

describe("Live Activity settings routes", () => {
  it("require a session and the event-settings capability", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/api/live-activities/settings" });
    expect(anonymous.statusCode).toBe(401);
    const outsider = await createUserWithCapabilities([CAPABILITIES.VENUE_MANAGE]);
    const read = await app.inject({
      method: "GET",
      url: "/api/live-activities/settings",
      headers: asUser(outsider),
    });
    expect(read.statusCode).toBe(403);
    expect((await put(outsider, body(LIVE_ACTIVITY_CONFIG_KINDS))).statusCode).toBe(403);
  });

  it("reads missing rows as disabled kinds with no roles, in the default order", async () => {
    const admin = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    const res = await app.inject({
      method: "GET",
      url: "/api/live-activities/settings",
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(200);
    const settings = res.json();
    expect(settings.maxConcurrent).toBe(2);
    expect(settings.kinds.map((k: { kind: string }) => k.kind)).toEqual([
      ...LIVE_ACTIVITY_CONFIG_KINDS,
    ]);
    const { pool } = await import("../../src/db/pool.js");
    const { rows: roles } = await pool.query(`SELECT id, name FROM roles ORDER BY position DESC`);
    expect(settings.roles).toEqual(roles);
    expect(settings.kinds[0]).toEqual({
      kind: "activity",
      enabled: false,
      priority: 0,
      roleIds: [],
      requiredCapability: CAPABILITIES.ACTIVITY_SCAN,
    });
  });

  it("saves order as priority, replaces role lists and audits the change", async () => {
    const admin = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    const staff = await createRole([CAPABILITIES.ACTIVITY_SCAN]);
    const attendees = await createRole([]);
    const order = ["deadline", "activity", "queue", "attendee_activity", "accreditation"] as const;
    const first = await put(admin, body(order, [staff, attendees], 3));
    expect(first.statusCode).toBe(200);
    const saved = first.json();
    expect(saved.maxConcurrent).toBe(3);
    expect(
      saved.kinds.map((k: { kind: string; priority: number }) => [k.kind, k.priority]),
    ).toEqual(order.map((kind, index) => [kind, index]));
    expect(saved.kinds[0]).toMatchObject({ enabled: false, roleIds: [staff, attendees].sort() });
    expect(saved.kinds[1]).toMatchObject({
      enabled: true,
      requiredCapability: CAPABILITIES.ACTIVITY_SCAN,
    });

    // A full permutation in one save (the unique priority is deferred).
    const reversed = [...order].reverse();
    const second = await put(admin, body(reversed, [attendees]));
    expect(second.statusCode).toBe(200);
    expect(second.json().kinds.map((k: { kind: string }) => k.kind)).toEqual(reversed);
    expect(
      second.json().kinds.every((k: { roleIds: number[] }) => k.roleIds.join() === `${attendees}`),
    ).toBe(true);

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT actor_id, action, before, after FROM audit_log
        WHERE entity_type = 'live_activity_settings' ORDER BY id`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ actor_id: admin, action: "update" });
    expect(rows[1].before.maxConcurrent).toBe(3);
    expect(rows[1].after.maxConcurrent).toBe(2);
  });

  it("stores the lead time only as an override, audits it and resets it (H45, #966)", async () => {
    const { config } = await import("../../src/config.js");
    const { pool } = await import("../../src/db/pool.js");
    const admin = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    const readSettings = async () =>
      (
        await app.inject({
          method: "GET",
          url: "/api/live-activities/settings",
          headers: asUser(admin),
        })
      ).json();
    const storedLead = async () =>
      (await pool.query(`SELECT lead_minutes FROM live_activity_settings`)).rows[0]?.lead_minutes ??
      null;

    expect(await readSettings()).toMatchObject({
      leadMinutes: config.LIVE_ACTIVITY_LEAD_MINUTES,
      defaultLeadMinutes: config.LIVE_ACTIVITY_LEAD_MINUTES,
      leadMinutesCustom: false,
    });

    // Omitting it keeps the default and stores nothing.
    expect((await put(admin, body(LIVE_ACTIVITY_CONFIG_KINDS))).statusCode).toBe(200);
    expect(await storedLead()).toBeNull();

    const saved = await put(admin, { ...body(LIVE_ACTIVITY_CONFIG_KINDS), leadMinutes: 45 });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ leadMinutes: 45, leadMinutesCustom: true });
    expect(await storedLead()).toBe(45);
    // A later save without the field leaves the override alone.
    await put(admin, body(LIVE_ACTIVITY_CONFIG_KINDS));
    expect(await storedLead()).toBe(45);

    const { rows } = await pool.query(
      `SELECT before, after FROM audit_log
        WHERE entity_type = 'live_activity_settings' ORDER BY id`,
    );
    expect(rows[1].before.leadMinutes).toBe(config.LIVE_ACTIVITY_LEAD_MINUTES);
    expect(rows[1].after.leadMinutes).toBe(45);

    // Back to the deployment default: by null, or by typing the default itself.
    const reset = await put(admin, { ...body(LIVE_ACTIVITY_CONFIG_KINDS), leadMinutes: null });
    expect(reset.json()).toMatchObject({
      leadMinutes: config.LIVE_ACTIVITY_LEAD_MINUTES,
      leadMinutesCustom: false,
    });
    expect(await storedLead()).toBeNull();
    await put(admin, { ...body(LIVE_ACTIVITY_CONFIG_KINDS), leadMinutes: 45 });
    await put(admin, {
      ...body(LIVE_ACTIVITY_CONFIG_KINDS),
      leadMinutes: config.LIVE_ACTIVITY_LEAD_MINUTES,
    });
    expect(await storedLead()).toBeNull();
  });

  it("validates the lead time between 0 and 240 minutes", async () => {
    const admin = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    for (const leadMinutes of [-1, 241, 1.5, "15"]) {
      const res = await put(admin, { ...body(LIVE_ACTIVITY_CONFIG_KINDS), leadMinutes });
      expect(res.statusCode).toBe(400);
    }
    for (const leadMinutes of [0, 240]) {
      const res = await put(admin, { ...body(LIVE_ACTIVITY_CONFIG_KINDS), leadMinutes });
      expect(res.statusCode).toBe(200);
    }
  });

  it("rejects incomplete, duplicated or out-of-range bodies and unknown roles", async () => {
    const admin = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    const missing = await put(admin, body(LIVE_ACTIVITY_CONFIG_KINDS.slice(1)));
    expect(missing.statusCode).toBe(400);
    const duplicated = await put(admin, body([...LIVE_ACTIVITY_CONFIG_KINDS.slice(1), "queue"]));
    expect(duplicated.statusCode).toBe(400);
    expect((await put(admin, body(LIVE_ACTIVITY_CONFIG_KINDS, [], 6))).statusCode).toBe(400);
    expect((await put(admin, body(LIVE_ACTIVITY_CONFIG_KINDS, [], 0))).statusCode).toBe(400);
    const unknownRole = await put(admin, body(LIVE_ACTIVITY_CONFIG_KINDS, [987654]));
    expect(unknownRole.statusCode).toBe(400);
    expect(unknownRole.json().error.details).toEqual({ roleIds: [987654] });

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM live_activity_kind_settings`);
    expect(rows[0].n).toBe(0);
  });

  it("replays a retried save with the same idempotency key", async () => {
    const admin = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    const headers = { "idempotency-key": "la-settings-1" };
    const first = await put(admin, body(LIVE_ACTIVITY_CONFIG_KINDS), headers);
    const retry = await put(admin, body(LIVE_ACTIVITY_CONFIG_KINDS), headers);
    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'live_activity_settings'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it("drops a deleted role from the configuration it was part of", async () => {
    const admin = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    const role = await createRole([]);
    await put(admin, body(LIVE_ACTIVITY_CONFIG_KINDS, [role]));
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE roles SET deleted_at = now() WHERE id = $1`, [role]);
    const res = await app.inject({
      method: "GET",
      url: "/api/live-activities/settings",
      headers: asUser(admin),
    });
    expect(res.json().kinds.every((k: { roleIds: number[] }) => k.roleIds.length === 0)).toBe(true);
  });
});
