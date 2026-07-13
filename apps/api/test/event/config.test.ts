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

/** H45/H47: event config — public hacking window + admin edit. */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
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

async function getApp(): Promise<App> {
  if (!app) app = await buildTestApp();
  return app;
}

describe("event config (H45/H47)", () => {
  it("serves public defaults with no auth even after truncation", async () => {
    const a = await getApp();
    const res = await a.inject({ method: "GET", url: "/api/public/event" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      hackingStartsAt: null,
      hackingEndsAt: null,
      timezone: "Europe/Madrid",
      showStartCountdown: false,
      judgingStartsAt: null,
      judgingEndsAt: null,
    });
  });

  it("requires SCHEDULE_MANAGE to edit", async () => {
    const a = await getApp();
    const pleb = await createUser();
    const res = await a.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(pleb),
      payload: { name: "hackOS" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("upserts the hacking window and reveals it publicly", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const start = "2026-07-04T09:00:00.000Z";
    const end = "2026-07-05T09:00:00.000Z";
    const put = await a.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: { name: "hackOS 2026", hackingStartsAt: start, hackingEndsAt: end },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().name).toBe("hackOS 2026");

    const pub = await a.inject({ method: "GET", url: "/api/public/event" });
    expect(new Date(pub.json().hackingStartsAt).toISOString()).toBe(start);
    expect(new Date(pub.json().hackingEndsAt).toISOString()).toBe(end);
  });

  it("rejects an end before the start", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const res = await a.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: {
        hackingStartsAt: "2026-07-05T09:00:00.000Z",
        hackingEndsAt: "2026-07-04T09:00:00.000Z",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("round-trips showStartCountdown, defaulting to false", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const put = await a.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: { showStartCountdown: true },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().showStartCountdown).toBe(true);

    const pub = await a.inject({ method: "GET", url: "/api/public/event" });
    expect(pub.json().showStartCountdown).toBe(true);
  });

  it("upserts the venue and Wallet pass back fields", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const put = await a.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: {
        venueName: "Facultade de Informática, UDC",
        venueLatitude: 43.3332,
        venueLongitude: -8.4115,
        passBackFields: [
          { label: "Schedule", value: "https://example.com/schedule" },
          { label: "Code of Conduct", value: "https://example.com/conduct" },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      venueName: "Facultade de Informática, UDC",
      venueLatitude: 43.3332,
      venueLongitude: -8.4115,
      passBackFields: [
        { label: "Schedule", value: "https://example.com/schedule" },
        { label: "Code of Conduct", value: "https://example.com/conduct" },
      ],
    });

    const pub = await a.inject({ method: "GET", url: "/api/public/event" });
    expect(pub.json().venueName).toBe("Facultade de Informática, UDC");
  });

  it("upserts Wallet pass field-label overrides", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const put = await a.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: { passFieldLabels: { participant: "Hacker", email: "Contact" } },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().passFieldLabels).toEqual({ participant: "Hacker", email: "Contact" });

    const pub = await a.inject({ method: "GET", url: "/api/public/event" });
    expect(pub.json().passFieldLabels).toEqual({ participant: "Hacker", email: "Contact" });
  });

  it("round-trips the event start (doors open) independently of the hacking window", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const doorsOpen = "2026-07-04T08:00:00.000Z";
    const put = await a.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: { eventStartsAt: doorsOpen, hackingStartsAt: "2026-07-04T10:00:00.000Z" },
    });
    expect(put.statusCode).toBe(200);
    expect(new Date(put.json().eventStartsAt).toISOString()).toBe(doorsOpen);

    const pub = await a.inject({ method: "GET", url: "/api/public/event" });
    expect(new Date(pub.json().eventStartsAt).toISOString()).toBe(doorsOpen);
  });

  it("round-trips Wallet pass field-visibility toggles, defaulting to visible", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);

    const before = await a.inject({ method: "GET", url: "/api/public/event" });
    expect(before.json().passFieldVisibility).toEqual({});

    const put = await a.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: { passFieldVisibility: { email: false, university: false } },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().passFieldVisibility).toEqual({ email: false, university: false });
  });

  it("rejects an unknown Wallet pass field-visibility key", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const res = await a.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: { passFieldVisibility: { event: false } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("exposes the organizer name the pass's 'Organized by' field is filled with", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const res = await a.inject({ method: "GET", url: "/api/event", headers: asUser(manager) });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().organizerName).toBe("string");
    expect(res.json().organizerName.length).toBeGreaterThan(0);
  });

  it("rejects an unknown Wallet pass field-label key", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const res = await a.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: { passFieldLabels: { notARealKey: "x" } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects venue coordinates set on only one axis", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
    const res = await a.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: { venueLatitude: 43.3332 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("exposes the judging window (queue_settings) publicly, read-only", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.QUEUE_ADMIN]);
    const start = "2026-07-05T18:00:00.000Z";
    const end = "2026-07-05T22:00:00.000Z";
    const patch = await a.inject({
      method: "PATCH",
      url: "/api/queue/settings",
      headers: asUser(admin),
      payload: { scheduleStartAt: start, scheduleEndAt: end },
    });
    expect(patch.statusCode).toBe(200);

    const pub = await a.inject({ method: "GET", url: "/api/public/event" });
    expect(new Date(pub.json().judgingStartsAt).toISOString()).toBe(start);
    expect(new Date(pub.json().judgingEndsAt).toISOString()).toBe(end);
  });
});
