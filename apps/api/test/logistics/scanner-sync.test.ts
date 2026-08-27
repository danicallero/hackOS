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
  it("contains the local lookup, revocation, and scan-count data", async () => {
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
      expect.objectContaining({
        id: mealId,
        name: "Dinner",
        category: "meal",
        // H50 extension: mirrors the linked schedule item's translations.
        primaryLanguage: "es",
        nameI18n: {},
        descriptionI18n: {},
      }),
    );
    expect(body.activityStates).toContainEqual({
      userId,
      activityId: mealId,
      count: 1,
    });
  });

  it("excludes anonymized profiles from the snapshot (H54)", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const userId = await createUser({ name: "Ada" });
    await assignBadge(userId, "BADGE-ANON");
    await pool.query(`INSERT INTO check_in_logs (user_id, badge_id) VALUES ($1, 'BADGE-ANON')`, [
      userId,
    ]);

    const admin = await createUserWithCapabilities(["*"]);
    const anon = await app.inject({
      method: "POST",
      url: `/api/users/${userId}/anonymize`,
      headers: asUser(admin),
    });
    expect(anon.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: "/api/scanner/snapshot",
      headers: asUser(scanner),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.people.some((p: { userId: number }) => p.userId === userId)).toBe(false);
  });

  it("rejects a revoked badge even after it is reassigned to another person (H54)", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const formerOwner = await createUser();
    await assignBadge(formerOwner, "BADGE-RETIRED");
    await pool.query(`INSERT INTO check_in_logs (user_id, badge_id) VALUES ($1, 'BADGE-RETIRED')`, [
      formerOwner,
    ]);
    const admin = await createUserWithCapabilities(["*"]);
    const removed = await app.inject({
      method: "POST",
      url: `/api/users/${formerOwner}/anonymize`,
      headers: asUser(admin),
    });
    expect(removed.statusCode).toBe(200);

    const retired = await pool.query<{ credential_digest: string }>(
      `SELECT credential_digest FROM scanner_revoked_badges`,
    );
    expect(retired.rows).toHaveLength(1);
    const retiredRow = retired.rows[0];
    if (!retiredRow) throw new Error("Expected one retired badge digest");
    expect(retiredRow.credential_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(retiredRow.credential_digest).not.toContain("BADGE-RETIRED");

    const replacement = await createUser();
    await assignBadge(replacement, "BADGE-RETIRED");
    const meal = await createMeal("Stale badge fixture");
    const staleScan = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/scan`,
      headers: asUser(scanner),
      payload: { badgeId: "BADGE-RETIRED" },
    });

    expect(staleScan.statusCode).toBe(409);
    expect(staleScan.json().error.code).toBe("badge_revoked");
    expect(
      (await pool.query(`SELECT 1 FROM activity_logs WHERE user_id = $1`, [replacement])).rowCount,
    ).toBe(0);
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
