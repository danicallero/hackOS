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
let statsStaff: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  scanner = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
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

  it("excludes anonymized profiles from accredited counts (H54)", async () => {
    const a = await createUser();
    await assignBadge(a, "S-ANON");
    const b = await createUser();
    await assignBadge(b, "S-KEPT");

    const admin = await createUserWithCapabilities(["*"]);
    const anon = await app.inject({
      method: "POST",
      url: `/api/users/${a}/anonymize`,
      headers: asUser(admin),
    });
    expect(anon.statusCode).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: "/api/logistics/stats",
      headers: asUser(statsStaff),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accreditedCount).toBe(1);

    const byRole = await app.inject({
      method: "GET",
      url: "/api/accreditation/stats",
      headers: asUser(admin),
    });
    expect(byRole.statusCode).toBe(200);
    const total = (byRole.json().byRole as Array<{ count: number }>).reduce(
      (sum, r) => sum + r.count,
      0,
    );
    expect(total).toBe(1);
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
