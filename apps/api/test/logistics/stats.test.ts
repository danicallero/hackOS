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
let manager: number;
let statsStaff: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  scanner = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
  manager = await createUserWithCapabilities([CAPABILITIES.SCHEDULE_MANAGE]);
  statsStaff = await createUserWithCapabilities([CAPABILITIES.LOGISTICS_STATS]);
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

describe("H27 logistics stats", () => {
  it("reports accredited count, meal served/repeats, and activity attendance", async () => {
    const meal = await createMeal("Lunch");
    const workshop = await createActivity({ requiresScan: true, name: "Talk" });

    const a = await createUser();
    await assignBadge(a, "S-A");
    const b = await createUser();
    await assignBadge(b, "S-B");

    for (const uid of [a, b]) {
      await app.inject({
        method: "POST",
        url: `/api/activities/${meal}/entitlements`,
        headers: asUser(manager),
        payload: { userId: uid },
      });
    }

    // a eats twice (one repeat), b once
    await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/scan`,
      headers: asUser(scanner),
      payload: { badgeId: "S-A" },
    });
    await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/scan`,
      headers: asUser(scanner),
      payload: { badgeId: "S-A", allowRepeat: true },
    });
    await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/scan`,
      headers: asUser(scanner),
      payload: { badgeId: "S-B" },
    });
    // a attends the workshop
    await app.inject({
      method: "POST",
      url: `/api/activities/${workshop}/scan`,
      headers: asUser(scanner),
      payload: { badgeId: "S-A" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/logistics/stats",
      headers: asUser(statsStaff),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accreditedCount).toBe(2);

    const lunch = body.meals.find((m: { name: string }) => m.name === "Lunch");
    expect(lunch.served).toBe(3);
    expect(lunch.distinctPeople).toBe(2);
    expect(lunch.repeats).toBe(1);

    const talk = body.activities.find((x: { name: string }) => x.name === "Talk");
    expect(talk.scans).toBe(1);
    expect(talk.attendees).toBe(1);
  });

  it("requires LOGISTICS_STATS", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/logistics/stats",
      headers: asUser(scanner),
    });
    expect(res.statusCode).toBe(403);
  });
});
