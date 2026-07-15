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
  assignBadge,
  createIntolerance,
  createMeal,
  issueTicket,
  makeConfirmed,
  setIntolerances,
} from "./fixtures.js";

let app: App;
let scanner: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  scanner = await createUserWithCapabilities([
    CAPABILITIES.ACCREDIT_SCAN,
    CAPABILITIES.ACTIVITY_SCAN,
  ]);
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

describe("H22-H26 native scanner snapshot", () => {
  it("contains the local lookup, revocation, entitlement, and scan-count data", async () => {
    const userId = await createUser({ name: "Ada" });
    await makeConfirmed(userId);
    const ticketToken = await issueTicket(userId, "ticket-local");
    await assignBadge(userId, "BADGE-OLD");
    const intolerance = await createIntolerance(scanner, {
      en: "Gluten",
      es: "Gluten",
      gl: "Glute",
    });
    await setIntolerances(userId, [intolerance], "Severe");
    const mealId = await createMeal("Dinner");

    const rotate = await app.inject({
      method: "POST",
      url: "/api/accreditation/rotate",
      headers: { ...asUser(scanner), "idempotency-key": "rotation-for-snapshot" },
      payload: {
        userId,
        currentBadgeId: "BADGE-OLD",
        newBadgeId: "BADGE-NEW",
        reason: "lost",
      },
    });
    expect(rotate.statusCode).toBe(200);

    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`INSERT INTO meal_entitlements (user_id, activity_id) VALUES ($1, $2)`, [
      userId,
      mealId,
    ]);
    await pool.query(
      `INSERT INTO activity_logs (user_id, activity_id, logged_by) VALUES ($1, $2, $3)`,
      [userId, mealId, scanner],
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/scanner/snapshot",
      headers: asUser(scanner),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.people).toContainEqual(
      expect.objectContaining({
        userId,
        ticketToken,
        badgeId: "BADGE-NEW",
        revokedBadgeIds: ["BADGE-OLD"],
        accepted: true,
        confirmed: true,
        foodIntoleranceNotes: "Severe",
      }),
    );
    expect(body.activities).toContainEqual(
      expect.objectContaining({ id: mealId, name: "Dinner", category: "meal" }),
    );
    expect(body.activityStates).toContainEqual({
      userId,
      activityId: mealId,
      count: 1,
      entitled: true,
    });
  });

  it("requires a scanner or logistics capability", async () => {
    const participant = await createUser();
    const response = await app.inject({
      method: "GET",
      url: "/api/scanner/snapshot",
      headers: asUser(participant),
    });
    expect(response.statusCode).toBe(403);
  });
});
