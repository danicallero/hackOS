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

/** TV timetable CRUD (H42): who may edit it, what it rejects, what it records. */

let app: App;
let controllerId: number;
let outsiderId: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  controllerId = await createUserWithCapabilities([CAPABILITIES.TV_CONTROL]);
  outsiderId = await createUser();
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

const iso = (minutesFromNow: number) =>
  new Date(Date.now() + minutesFromNow * 60_000).toISOString();

function slotBody(overrides: Record<string, unknown> = {}) {
  return {
    label: "Hacking",
    startsAt: iso(-30),
    endsAt: iso(180),
    items: [{ mode: "live", payload: { wifi: { show: true } } }],
    ...overrides,
  };
}

describe("tv timetable CRUD (TV_CONTROL)", () => {
  it("creates, lists, edits and deletes a slot", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/tv/slots",
      headers: asUser(controllerId),
      payload: slotBody(),
    });
    expect(created.statusCode).toBe(200);
    const slot = created.json();
    expect(slot).toMatchObject({ label: "Hacking" });
    // Items are normalised: an absent dwell is stored as null, not dropped.
    expect(slot.items).toEqual([
      { mode: "live", payload: { wifi: { show: true } }, seconds: null },
    ]);

    const listed = await app.inject({
      method: "GET",
      url: "/api/tv/slots",
      headers: asUser(controllerId),
    });
    expect(listed.json().items).toHaveLength(1);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/tv/slots/${slot.id}`,
      headers: asUser(controllerId),
      payload: { label: "Hacking (day 2)" },
    });
    expect(patched.statusCode).toBe(200);
    // An omitted field keeps its value rather than being nulled.
    expect(patched.json()).toMatchObject({ label: "Hacking (day 2)", startsAt: slot.startsAt });

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/tv/slots/${slot.id}`,
      headers: asUser(controllerId),
    });
    expect(removed.statusCode).toBe(200);

    const empty = await app.inject({
      method: "GET",
      url: "/api/tv/slots",
      headers: asUser(controllerId),
    });
    expect(empty.json().items).toEqual([]);
  });

  it("puts a created slot on the screens immediately", async () => {
    await app.inject({
      method: "POST",
      url: "/api/tv/slots",
      headers: asUser(controllerId),
      payload: slotBody({ items: [{ mode: "sponsors" }] }),
    });

    // The public feed is what the TV wall polls — no capability, no auth.
    const state = await app.inject({ method: "GET", url: "/api/tv/mode" });
    expect(state.json()).toMatchObject({ mode: "sponsors", source: "slot" });
  });

  it("rejects a window that ends before it starts, and an empty item list", async () => {
    const backwards = await app.inject({
      method: "POST",
      url: "/api/tv/slots",
      headers: asUser(controllerId),
      payload: slotBody({ startsAt: iso(120), endsAt: iso(60) }),
    });
    expect(backwards.statusCode).toBe(400);

    const empty = await app.inject({
      method: "POST",
      url: "/api/tv/slots",
      headers: asUser(controllerId),
      payload: slotBody({ items: [] }),
    });
    expect(empty.statusCode).toBe(400);
  });

  it("refuses everything without TV_CONTROL", async () => {
    for (const [method, url] of [
      ["GET", "/api/tv/slots"],
      ["POST", "/api/tv/slots"],
      ["PATCH", "/api/tv/slots/1"],
      ["DELETE", "/api/tv/slots/1"],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        headers: asUser(outsiderId),
        payload: method === "GET" || method === "DELETE" ? undefined : slotBody(),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it("404s on a slot that isn't there", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/tv/slots/999999",
      headers: asUser(controllerId),
      payload: { label: "ghost" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("audits every mutation (H53)", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const created = await app.inject({
      method: "POST",
      url: "/api/tv/slots",
      headers: asUser(controllerId),
      payload: slotBody(),
    });
    const { id } = created.json();
    await app.inject({
      method: "PATCH",
      url: `/api/tv/slots/${id}`,
      headers: asUser(controllerId),
      payload: { label: "renamed" },
    });
    await app.inject({
      method: "DELETE",
      url: `/api/tv/slots/${id}`,
      headers: asUser(controllerId),
    });

    const { rows } = await pool.query(
      `SELECT action, actor_id FROM audit_log WHERE entity_type = 'tv_slot' AND entity_id = $1
        ORDER BY id ASC`,
      [String(id)],
    );
    expect(rows.map((r: { action: string }) => r.action)).toEqual(["create", "update", "delete"]);
    expect(rows.every((r: { actor_id: number }) => r.actor_id === controllerId)).toBe(true);
  });
});

describe("tv override lifecycle (H42)", () => {
  it("overrides a running slot and hands back on DELETE", async () => {
    await app.inject({
      method: "POST",
      url: "/api/tv/slots",
      headers: asUser(controllerId),
      payload: slotBody({ items: [{ mode: "rooms" }] }),
    });

    const override = await app.inject({
      method: "PATCH",
      url: "/api/tv/mode",
      headers: asUser(controllerId),
      payload: { mode: "live", payload: null },
    });
    expect(override.json()).toMatchObject({ mode: "live", source: "override" });

    const back = await app.inject({
      method: "DELETE",
      url: "/api/tv/mode",
      headers: asUser(controllerId),
    });
    expect(back.json()).toMatchObject({ mode: "rooms", source: "slot" });
  });

  it("keeps clearing the override behind TV_CONTROL", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/tv/mode",
      headers: asUser(outsiderId),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("tv venue config (H42)", () => {
  it("serves the venue Wi-Fi publicly once configured, and never on the public event feed", async () => {
    const { pool } = await import("../../src/db/pool.js");

    const before = await app.inject({ method: "GET", url: "/api/tv/config" });
    expect(before.json()).toEqual({ wifi: null });

    await pool.query(
      `INSERT INTO event_config (id, wifi_ssid, wifi_password)
       VALUES (1, 'hackos-guest', 's3cr3t')
       ON CONFLICT (id) DO UPDATE SET wifi_ssid = EXCLUDED.wifi_ssid,
         wifi_password = EXCLUDED.wifi_password`,
    );

    // Seeding by raw SQL bypasses the write path that would normally evict
    // the GET read cache, so the first response above would otherwise stick.
    const { invalidateReadCache } = await import("../../src/lib/read-cache.js");
    await invalidateReadCache();

    const after = await app.inject({ method: "GET", url: "/api/tv/config" });
    expect(after.json()).toEqual({ wifi: { ssid: "hackos-guest", password: "s3cr3t" } });

    // The website's feed must not start carrying venue credentials.
    const publicEvent = await app.inject({ method: "GET", url: "/api/public/event" });
    expect(JSON.stringify(publicEvent.json())).not.toContain("s3cr3t");
  });
});
