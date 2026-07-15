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
import { assignBadge, createActivity, createMeal } from "./fixtures.js";

let app: App;
let scanner: number;
let doorOp: number;
let manager: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  scanner = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
  doorOp = await createUserWithCapabilities([CAPABILITIES.PRESENCE_SCAN]);
  manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
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

describe("GET /api/activities/scannable (H25/H26)", () => {
  it("gets meals and registrable activities from schedule management", async () => {
    const start = new Date("2030-01-01T12:00:00.000Z");
    const create = async (title: string, type: string, requiresScan = false) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/schedule",
        headers: asUser(manager),
        payload: {
          title,
          type,
          requiresScan,
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + 60 * 60_000).toISOString(),
        },
      });
      expect(res.statusCode).toBe(201);
      return res.json() as { id: number; requiresScan: boolean };
    };

    const lunch = await create("Lunch", "meal");
    const workshop = await create("Workshop", "workshop", true);
    await create("Opening", "ceremony");

    expect(lunch.requiresScan).toBe(true);
    const res = await app.inject({
      method: "GET",
      url: "/api/activities/scannable",
      headers: asUser(scanner),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ activityId: number; name: string }>;
    expect(items.map((item) => item.name).sort()).toEqual(["Lunch", "Workshop"]);

    const workshopActivity = items.find((item) => item.name === "Workshop");
    expect(workshopActivity?.activityId).toBeDefined();
    const attendee = await createUser();
    await assignBadge(attendee, "SCHEDULE-WORKSHOP");
    const scan = await app.inject({
      method: "POST",
      url: `/api/activities/${workshopActivity?.activityId}/scan`,
      headers: asUser(scanner),
      payload: { badgeId: "SCHEDULE-WORKSHOP" },
    });
    expect(scan.statusCode).toBe(200);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/schedule/${workshop.id}`,
      headers: asUser(manager),
      payload: { requiresScan: false },
    });
    expect(updated.statusCode).toBe(200);

    const afterUpdate = await app.inject({
      method: "GET",
      url: "/api/activities/scannable?category=activity",
      headers: asUser(scanner),
    });
    expect(afterUpdate.json().items).toEqual([]);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/schedule/${workshop.id}`,
      headers: asUser(manager),
    });
    expect(deleted.statusCode).toBe(200);
  });

  it("lists meals and registrable activities with counts for a scan operator", async () => {
    const meal = await createMeal("Lunch");
    const talk = await createActivity({ requiresScan: true, name: "Talk" });
    // Not scannable — must be excluded.
    await createActivity({ requiresScan: false, name: "Opening" });

    const a = await createUser();
    await assignBadge(a, "S-A");
    await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/scan`,
      headers: asUser(scanner),
      payload: { badgeId: "S-A" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/activities/scannable",
      headers: asUser(scanner),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ activityId: number; name: string; count: number }>;
    const names = items.map((i) => i.name).sort();
    expect(names).toEqual(["Lunch", "Talk"]);
    expect(items.find((i) => i.activityId === meal)?.count).toBe(1);
    expect(items.find((i) => i.name === "Opening")).toBeUndefined();
    expect(items.find((i) => i.activityId === talk)?.count).toBe(0);
  });

  it("filters by category", async () => {
    await createMeal("Dinner");
    await createActivity({ requiresScan: true, name: "Workshop" });

    const meals = await app.inject({
      method: "GET",
      url: "/api/activities/scannable?category=meal",
      headers: asUser(scanner),
    });
    expect(meals.json().items.map((i: { name: string }) => i.name)).toEqual(["Dinner"]);

    const activities = await app.inject({
      method: "GET",
      url: "/api/activities/scannable?category=activity",
      headers: asUser(scanner),
    });
    expect(activities.json().items.map((i: { name: string }) => i.name)).toEqual(["Workshop"]);
  });

  it("does NOT require the LOGISTICS_STATS capability", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/activities/scannable",
      headers: asUser(scanner),
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects a user without scan or stats capability", async () => {
    const nobody = await createUser();
    const res = await app.inject({
      method: "GET",
      url: "/api/activities/scannable",
      headers: asUser(nobody),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("presence reads for door operators (H24)", () => {
  it("lets a PRESENCE_SCAN operator read occupancy and hours", async () => {
    const estimate = await app.inject({
      method: "GET",
      url: "/api/presence/estimate",
      headers: asUser(doorOp),
    });
    expect(estimate.statusCode).toBe(200);
    expect(estimate.json()).toHaveProperty("presentCount");

    const hours = await app.inject({
      method: "GET",
      url: "/api/presence/hours",
      headers: asUser(doorOp),
    });
    expect(hours.statusCode).toBe(200);
    expect(Array.isArray(hours.json())).toBe(true);
  });

  it("rejects a user with neither presence nor stats capability", async () => {
    const nobody = await createUser();
    const res = await app.inject({
      method: "GET",
      url: "/api/presence/hours",
      headers: asUser(nobody),
    });
    expect(res.statusCode).toBe(403);
  });
});
