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
import { assignBadge, createMeal } from "./fixtures.js";

let app: App;
let doorStaff: number;
let statsStaff: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  doorStaff = await createUserWithCapabilities([CAPABILITIES.PRESENCE_SCAN]);
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

/** assignBadge's trigger stamps badge_assigned_at at "now" — backdate it so backdated test scans aren't rejected as predating assignment. */
async function backdateBadgeAssignment(userId: number, at: Date): Promise<void> {
  await pool.query(`UPDATE users SET badge_assigned_at = $1 WHERE id = $2`, [at, userId]);
}

async function doorScan(badgeId: string, kind: "in" | "out", scannedAt: Date) {
  const res = await app.inject({
    method: "POST",
    url: "/api/presence/scan",
    headers: {
      ...asUser(doorStaff),
      "idempotency-key": `${badgeId}-${kind}-${scannedAt.getTime()}`,
    },
    payload: { badgeId, kind, scannedAt: scannedAt.toISOString() },
  });
  expect(res.statusCode).toBe(200);
}

function parseCsv(text: string): string[][] {
  return text
    .trim()
    .split("\r\n")
    .map((line) => line.split(","));
}

describe("H24/H54 presence hours CSV export", () => {
  it("lists the active roster for the people finder", async () => {
    const uid = await createUser({ name: "Ada", email: "ada-roster@test.local" });
    await pool.query(`UPDATE users SET dni = $1, badge_id = $2 WHERE id = $3`, [
      "12345678A",
      "ROSTER-1",
      uid,
    ]);
    const res = await app.inject({
      method: "GET",
      url: "/api/logistics/people",
      headers: asUser(doorStaff),
    });
    expect(res.statusCode).toBe(200);
    const { items } = res.json() as {
      items: Array<{ userId: number; email: string; dni: string | null; badgeId: string | null }>;
    };
    const entry = items.find((p) => p.userId === uid);
    expect(entry).toMatchObject({
      email: "ada-roster@test.local",
      dni: "12345678A",
      badgeId: "ROSTER-1",
    });
  });

  it("403s the roster for a caller without any logistics capability", async () => {
    const plain = await createUser();
    const res = await app.inject({
      method: "GET",
      url: "/api/logistics/people",
      headers: asUser(plain),
    });
    expect(res.statusCode).toBe(403);
  });

  it("403s the export routes for a caller without logistics:stats", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/presence/hours/export.csv",
      headers: asUser(doorStaff),
    });
    expect(res.statusCode).toBe(403);
  });

  it("exports reduced hours: one row per participant with contact fields", async () => {
    const uid = await createUser({ name: "Grace", email: "grace@test.local" });
    await pool.query(`UPDATE users SET dni = $1 WHERE id = $2`, ["87654321B", uid]);
    await assignBadge(uid, "EXPORT-1");
    const start = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const end = new Date(Date.now() - 60 * 60 * 1000);
    await backdateBadgeAssignment(uid, new Date(Date.now() - 24 * 60 * 60 * 1000));
    await doorScan("EXPORT-1", "in", start);
    await doorScan("EXPORT-1", "out", end);

    const res = await app.inject({
      method: "GET",
      url: "/api/presence/hours/export.csv?format=reduced",
      headers: asUser(statsStaff),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const rows = parseCsv(res.body);
    expect(rows[0]).toEqual(["user_id", "name", "surname", "email", "dni", "hours"]);
    const row = rows.find((r) => r[0] === String(uid));
    expect(row).toBeDefined();
    expect(row?.[3]).toBe("grace@test.local");
    expect(row?.[4]).toBe("87654321B");
    expect(Number(row?.[5])).toBeCloseTo(2, 1);
  });

  it("exports full hours with a detail row per interval, and honors minHours", async () => {
    const uid = await createUser({ name: "Alan", email: "alan@test.local" });
    await assignBadge(uid, "EXPORT-2");
    const start = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const end = new Date(Date.now() - 60 * 60 * 1000);
    await backdateBadgeAssignment(uid, new Date(Date.now() - 24 * 60 * 60 * 1000));
    await doorScan("EXPORT-2", "in", start);
    await doorScan("EXPORT-2", "out", end);

    const full = await app.inject({
      method: "GET",
      url: "/api/presence/hours/export.csv?format=full",
      headers: asUser(statsStaff),
    });
    expect(full.statusCode).toBe(200);
    const rows = parseCsv(full.body);
    expect(rows[0]).toEqual([
      "row_type",
      "user_id",
      "name",
      "surname",
      "email",
      "dni",
      "hours",
      "activity",
      "time_logged_in",
      "time_logged_out",
      "confirmed",
      "expired",
      "time_aggregated",
    ]);
    const summary = rows.find((r) => r[0] === "summary" && r[1] === String(uid));
    const detail = rows.find((r) => r[0] === "detail" && r[1] === String(uid));
    expect(summary).toBeDefined();
    expect(Number(summary?.[6])).toBeCloseTo(4, 1);
    expect(detail).toBeDefined();
    expect(detail?.[7]).toBe(""); // no activity attributed to a pure door in/out window
    expect(detail?.[10]).toBe("true"); // confirmed
    expect(detail?.[11]).toBe("false"); // expired
    expect(Number(detail?.[12])).toBeCloseTo(4, 1); // time_aggregated

    const filtered = await app.inject({
      method: "GET",
      url: "/api/presence/hours/export.csv?format=reduced&minHours=100",
      headers: asUser(statsStaff),
    });
    expect(filtered.statusCode).toBe(200);
    const filteredRows = parseCsv(filtered.body);
    expect(filteredRows).toEqual([["user_id", "name", "surname", "email", "dni", "hours"]]);
  });

  it("attributes a detail row to the activity that contributed the time, and flags expired windows", async () => {
    const uid = await createUser({ name: "Marie", email: "marie@test.local" });
    await assignBadge(uid, "EXPORT-6");
    await backdateBadgeAssignment(uid, new Date(Date.now() - 48 * 60 * 60 * 1000));
    const mealId = await createMeal("Lunch");

    // Door entry now expires unconfirmed (no exit/activity within the 12h window).
    await doorScan("EXPORT-6", "in", new Date(Date.now() - 20 * 60 * 60 * 1000));

    // A separate, recent, activity-only window that should surface with its name.
    const res = await app.inject({
      method: "POST",
      url: `/api/presence/signals/${uid}`,
      headers: { ...asUser(doorStaff), "idempotency-key": `activity-${uid}-lunch` },
      payload: {
        kind: "activity",
        activityId: mealId,
        occurredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
    });
    expect(res.statusCode).toBe(201);

    const full = await app.inject({
      method: "GET",
      url: `/api/presence/hours/export.csv?format=full&userIds=${uid}`,
      headers: asUser(statsStaff),
    });
    expect(full.statusCode).toBe(200);
    const rows = parseCsv(full.body);
    const details = rows.filter((r) => r[0] === "detail" && r[1] === String(uid));

    const expired = details.find((r) => r[11] === "true");
    expect(expired).toBeDefined();
    expect(expired?.[7]).toBe(""); // no activity attributed to the plain door 'in'
    expect(Number(expired?.[12])).toBe(0); // expired windows contribute zero hours

    const activityRow = details.find((r) => r[7] === "Lunch");
    expect(activityRow).toBeDefined();
    expect(activityRow?.[11]).toBe("false"); // not expired
  });

  it("scopes the bulk export to userIds when given", async () => {
    const included = await createUser({ email: "included@test.local" });
    const excluded = await createUser({ email: "excluded@test.local" });
    await assignBadge(included, "EXPORT-3");
    await assignBadge(excluded, "EXPORT-4");
    await backdateBadgeAssignment(included, new Date(Date.now() - 24 * 60 * 60 * 1000));
    await backdateBadgeAssignment(excluded, new Date(Date.now() - 24 * 60 * 60 * 1000));
    const start = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await doorScan("EXPORT-3", "in", start);
    await doorScan("EXPORT-3", "out", new Date());
    await doorScan("EXPORT-4", "in", start);
    await doorScan("EXPORT-4", "out", new Date());

    const res = await app.inject({
      method: "GET",
      url: `/api/presence/hours/export.csv?format=reduced&userIds=${included}`,
      headers: asUser(statsStaff),
    });
    const rows = parseCsv(res.body);
    expect(rows.some((r) => r[0] === String(included))).toBe(true);
    expect(rows.some((r) => r[0] === String(excluded))).toBe(false);
  });

  it("exports a single participant's hours from their profile", async () => {
    const uid = await createUser({ email: "solo@test.local" });
    await assignBadge(uid, "EXPORT-5");
    await backdateBadgeAssignment(uid, new Date(Date.now() - 24 * 60 * 60 * 1000));
    await doorScan("EXPORT-5", "in", new Date(Date.now() - 60 * 60 * 1000));
    await doorScan("EXPORT-5", "out", new Date());

    const res = await app.inject({
      method: "GET",
      url: `/api/presence/hours/${uid}/export.csv`,
      headers: asUser(statsStaff),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain(`presence-hours-${uid}.csv`);
    const rows = parseCsv(res.body);
    expect(rows.some((r) => r[0] === "summary" && r[1] === String(uid))).toBe(true);
  });
});
