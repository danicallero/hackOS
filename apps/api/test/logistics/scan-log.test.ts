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
import { issueTicket } from "./fixtures.js";

let app: App;
let operatorA: number;
let operatorB: number;
let statsStaff: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  operatorA = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
  operatorB = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
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

async function checkIn(staffId: number, badgeId: string) {
  const uid = await createUser();
  const token = await issueTicket(uid);
  const res = await app.inject({
    method: "POST",
    url: "/api/accreditation/check-in",
    headers: asUser(staffId),
    payload: { ticketToken: token, badgeId, method: "qr" },
  });
  expect(res.statusCode).toBe(200);
  return uid;
}

describe("staff scan stats and scan-log (extends H22-H27)", () => {
  it("GET /api/me/logistics/stats counts only the caller's own scans", async () => {
    await checkIn(operatorA, "S-A1");
    await checkIn(operatorA, "S-A2");
    await checkIn(operatorB, "S-B1");

    const resA = await app.inject({
      method: "GET",
      url: "/api/me/logistics/stats",
      headers: asUser(operatorA),
    });
    expect(resA.statusCode).toBe(200);
    expect(resA.json()).toEqual({
      accreditationCount: 2,
      presenceCount: 0,
      activityCount: 0,
    });

    const resB = await app.inject({
      method: "GET",
      url: "/api/me/logistics/stats",
      headers: asUser(operatorB),
    });
    expect(resB.json().accreditationCount).toBe(1);
  });

  it("GET /api/logistics/stats/by-staff ranks every staff member with at least one scan", async () => {
    await checkIn(operatorA, "S-A1");
    await checkIn(operatorA, "S-A2");
    await checkIn(operatorB, "S-B1");

    const res = await app.inject({
      method: "GET",
      url: "/api/logistics/stats/by-staff",
      headers: asUser(statsStaff),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ staffId: number; total: number }>;
    const a = items.find((i) => i.staffId === operatorA);
    const b = items.find((i) => i.staffId === operatorB);
    expect(a?.total).toBe(2);
    expect(b?.total).toBe(1);
    // busiest first
    expect(items[0]?.staffId).toBe(operatorA);
  });

  it("GET /api/logistics/stats/by-staff requires LOGISTICS_STATS, not just a scan capability", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/logistics/stats/by-staff",
      headers: asUser(operatorA),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /api/logistics/scan-log defaults to the caller's own scans, most recent first", async () => {
    await checkIn(operatorA, "S-A1");
    await checkIn(operatorA, "S-A2");

    const res = await app.inject({
      method: "GET",
      url: "/api/logistics/scan-log",
      headers: asUser(operatorA),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].source).toBe("accreditation");
    // createUser() never sets a surname (NULL in the DB) — must come back as
    // "", never the literal string "null" (a past bug: String(null) === "null").
    expect(body.items[0].subjectSurname).toBe("");
  });

  it("GET /api/logistics/scan-log rejects viewing another staff member's scans without LOGISTICS_STATS", async () => {
    await checkIn(operatorB, "S-B1");

    const res = await app.inject({
      method: "GET",
      url: `/api/logistics/scan-log?staffId=${operatorB}`,
      headers: asUser(operatorA),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /api/logistics/scan-log allows LOGISTICS_STATS holders to view another staff member's scans", async () => {
    await checkIn(operatorB, "S-B1");

    const res = await app.inject({
      method: "GET",
      url: `/api/logistics/scan-log?staffId=${operatorB}`,
      headers: asUser(statsStaff),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
  });

  it("requires a scan or stats capability at all", async () => {
    const noCaps = await createUser();
    const res = await app.inject({
      method: "GET",
      url: "/api/logistics/scan-log",
      headers: asUser(noCaps),
    });
    expect(res.statusCode).toBe(403);
  });
});
