import "./env.js";
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
import { activityLog, createActivity, createMeal, timeLog } from "./fixtures.js";

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  app ??= await buildTestApp();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

function lines(text: string): string[] {
  return text.trim().split("\r\n");
}

describe("activity attendance exports", () => {
  it("requires exports:run", async () => {
    const plain = await createUser();
    const res = await app.inject({
      method: "GET",
      url: "/api/exports/activities/catalog",
      headers: asUser(plain),
    });
    expect(res.statusCode).toBe(403);

    const exportRoute = await app.inject({
      method: "POST",
      url: "/api/exports/activities.csv",
      headers: { ...asUser(plain), "idempotency-key": "activity-export-denied" },
      payload: { activity_ids: [1] },
    });
    expect(exportRoute.statusCode).toBe(403);
  });

  it("lists meals and explicitly scannable activities, with live counts", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const meal = await createMeal("Dinner");
    await createActivity({ name: "Workshop", requiresScan: true });
    await createActivity({ name: "Not exportable", requiresScan: false });
    const person = await createUser({ name: "Ada" });
    await activityLog(person, meal, staff);

    const res = await app.inject({
      method: "GET",
      url: "/api/exports/activities/catalog?language=en",
      headers: asUser(staff),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      activities: Array<{ id: number; name: string; scan_count: number; distinct_people: number }>;
    };
    expect(body.activities.map((activity) => activity.name)).toEqual(
      expect.arrayContaining(["Dinner", "Workshop"]),
    );
    expect(body.activities.find((activity) => activity.name === "Not exportable")).toBeUndefined();
    expect(body.activities.find((activity) => activity.id === meal)).toMatchObject({
      scan_count: 1,
      distinct_people: 1,
    });
  });

  it("exports one row per person or one row per raw scan and omits test subjects", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const meal = await createMeal("Dinner");
    const activity = await createActivity({ name: "Workshop", requiresScan: true });
    const included = await createUser({ name: "Included", email: "included@test.local" });
    const excluded = await createUser({ name: "Excluded", email: "excluded@test.local" });
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [excluded]);
    await activityLog(included, meal, staff, "first");
    await activityLog(included, meal, staff, "second");
    await activityLog(excluded, meal, staff, "fixture");
    await activityLog(included, activity, staff, "workshop");

    const people = await app.inject({
      method: "POST",
      url: "/api/exports/activities.csv",
      headers: { ...asUser(staff), "idempotency-key": "activity-export-people" },
      payload: { activity_ids: [meal, activity], mode: "people", language: "en" },
    });
    expect(people.statusCode).toBe(200);
    expect(people.headers["content-disposition"]).toContain("activity-attendance.csv");
    const peopleRows = lines(people.body);
    expect(peopleRows[0]).toContain("attendance_count");
    expect(peopleRows.filter((row) => row.includes("included@test.local"))).toHaveLength(2);
    expect(peopleRows.some((row) => row.includes("excluded@test.local"))).toBe(false);
    expect(peopleRows.some((row) => row.includes(",2,"))).toBe(true);

    const scans = await app.inject({
      method: "POST",
      url: "/api/exports/activities.csv",
      headers: { ...asUser(staff), "idempotency-key": "activity-export-scans" },
      payload: { activity_ids: [meal], mode: "scans", language: "en" },
    });
    expect(scans.statusCode).toBe(200);
    expect(scans.headers["content-disposition"]).toContain("activity-scans.csv");
    const scanRows = lines(scans.body);
    expect(scanRows[0]).toContain("source_scan_id");
    expect(scanRows.filter((row) => row.includes("included@test.local"))).toHaveLength(2);
    expect(scanRows.some((row) => row.includes("excluded@test.local"))).toBe(false);
  });
});

describe("raw presence register export", () => {
  it("requires logistics:stats and excludes non-current subjects", async () => {
    const exportStaff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const noStats = await app.inject({
      method: "GET",
      url: "/api/exports/presence-log.csv",
      headers: asUser(exportStaff),
    });
    expect(noStats.statusCode).toBe(403);

    const statsStaff = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
    const included = await createUser({ name: "Present", email: "present@test.local" });
    const excluded = await createUser({ name: "Fixture", email: "fixture@test.local" });
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [excluded]);
    await timeLog(included, statsStaff, "in");
    await timeLog(excluded, statsStaff, "out");

    const res = await app.inject({
      method: "GET",
      url: "/api/exports/presence-log.csv",
      headers: asUser(statsStaff),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("presence-register.csv");
    const rows = lines(res.body);
    expect(rows[0]).toContain("scanned_by_name");
    expect(rows.some((row) => row.includes("present@test.local"))).toBe(true);
    expect(rows.some((row) => row.includes("fixture@test.local"))).toBe(false);
  });
});
