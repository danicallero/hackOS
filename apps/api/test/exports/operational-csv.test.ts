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
import {
  activityLog,
  checkIn,
  createApplicationResponse,
  createMeal,
  timeLog,
} from "./fixtures.js";

/** H54: operational CSV exports, gated by exports:run. */

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
  const { pool } = await import("../../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

for (const path of ["attendance.csv", "meals.csv", "applications.csv", "staff-scan-stats.csv"]) {
  it(`GET /api/exports/${path} 403s without exports:run`, async () => {
    const noCaps = await createUser();
    const res = await app.inject({
      method: "GET",
      url: `/api/exports/${path}`,
      headers: asUser(noCaps),
    });
    expect(res.statusCode).toBe(403);
  });
}

describe("attendance.csv", () => {
  it("includes check-ins and door scans for multiple users, correctly escaped", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const userA = await createUser({ name: 'Comma, "Quote" Person' });
    const userB = await createUser({ name: "Plain Person" });
    await checkIn(userA, staff);
    await timeLog(userB, staff, "in");

    const res = await app.inject({
      method: "GET",
      url: "/api/exports/attendance.csv",
      headers: asUser(staff),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain("user_id,name,surname,email,event,occurred_at");
    expect(res.body).toContain('"Comma, ""Quote"" Person"');
    expect(res.body).toContain("Plain Person");
  });
});

describe("meals.csv", () => {
  it("includes meal redemptions for multiple users", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const userA = await createUser({ name: "Meal Eater" });
    const mealId = await createMeal("Dinner");
    await activityLog(userA, mealId, staff);

    const res = await app.inject({
      method: "GET",
      url: "/api/exports/meals.csv",
      headers: asUser(staff),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("meal_name,logged_at,logged_by,notes");
    expect(res.body).toContain("Meal Eater");
    expect(res.body).toContain("Dinner");
  });
});

describe("staff-scan-stats.csv", () => {
  it("ranks staff by scan counts, busiest first", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const busyOperator = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
    await pool.query(`UPDATE users SET name = 'Busy Operator' WHERE id = $1`, [busyOperator]);
    const quietOperator = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
    await pool.query(`UPDATE users SET name = 'Quiet Operator' WHERE id = $1`, [quietOperator]);
    const userA = await createUser();
    const userB = await createUser();
    await checkIn(userA, busyOperator);
    await checkIn(userB, busyOperator);
    await timeLog(userA, quietOperator, "in");

    const res = await app.inject({
      method: "GET",
      url: "/api/exports/staff-scan-stats.csv",
      headers: asUser(staff),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain(
      "staff_id,name,surname,accreditation_count,presence_count,activity_count,total",
    );
    const lines = res.body.trim().split("\r\n");
    expect(lines[1]).toContain("Busy Operator");
    expect(lines[1]).toContain(",2,0,0,2");
    expect(lines[2]).toContain("Quiet Operator");
    expect(lines[2]).toContain(",0,1,0,1");
  });
});

describe("applications.csv", () => {
  it("includes application responses for multiple users", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const userA = await createUser({ name: "Applicant One" });
    const userB = await createUser({ name: "Applicant Two" });
    await createApplicationResponse(userA, { appName: "App One", status: "review" });
    await createApplicationResponse(userB, { appName: "App Two", status: "confirmed" });

    const res = await app.inject({
      method: "GET",
      url: "/api/exports/applications.csv",
      headers: asUser(staff),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Applicant One");
    expect(res.body).toContain("Applicant Two");
    expect(res.body).toContain("dietary_data_state");
    expect(res.body).toContain("not_provided");
  });
});
