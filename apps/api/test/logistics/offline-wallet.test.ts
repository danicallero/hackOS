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
import { assignBadge, createMeal, issueTicket } from "./fixtures.js";

let app: App;
let scanner: number;
let manager: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  scanner = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
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

async function grant(activityId: number, userId: number) {
  await app.inject({
    method: "POST",
    url: `/api/activities/${activityId}/entitlements`,
    headers: asUser(manager),
    payload: { userId },
  });
}

describe("H25 offline meal scan queue", () => {
  it("accepts a local scanner batch and the worker processes each scan once", async () => {
    const meal = await createMeal();
    const uid = await createUser();
    await assignBadge(uid, "OFF-1");
    await grant(meal, uid);

    const res = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/meal-scans/batch`,
      headers: asUser(scanner),
      payload: {
        deviceId: "scanner-a",
        scans: [{ clientScanId: "scan-1", badgeId: "OFF-1" }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(1);

    const { processMealScanBatch } = await import("../../src/modules/logistics/offline-meals.js");
    await processMealScanBatch({ data: { batchId: res.json().batchId } } as never);

    const { pool } = await import("../../src/db/pool.js");
    const logs = await pool.query(
      `SELECT source_device_id, source_scan_id FROM activity_logs WHERE user_id = $1`,
      [uid],
    );
    expect(logs.rows).toHaveLength(1);
    expect(logs.rows[0].source_device_id).toBe("scanner-a");

    await processMealScanBatch({ data: { batchId: res.json().batchId } } as never);
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM activity_logs WHERE user_id = $1`,
      [uid],
    );
    expect(after.rows[0].n).toBe(1);
  });

  it("deduplicates client scan ids from the same device", async () => {
    const meal = await createMeal();
    const uid = await createUser();
    await assignBadge(uid, "OFF-2");
    await grant(meal, uid);

    const payload = {
      deviceId: "scanner-b",
      scans: [{ clientScanId: "same", badgeId: "OFF-2" }],
    };
    const first = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/meal-scans/batch`,
      headers: asUser(scanner),
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/activities/${meal}/meal-scans/batch`,
      headers: asUser(scanner),
      payload,
    });
    expect(first.json().accepted).toBe(1);
    expect(second.json().accepted).toBe(0);
    expect(second.json().duplicate).toBe(1);
  });
});

describe("H28 Apple Wallet PassKit", () => {
  it("issues a ticket pkpass and serves it through the native PassKit route", async () => {
    const uid = await createUser({ name: "Wallet" });
    await issueTicket(uid, "ticket-wallet-1");

    const res = await app.inject({
      method: "GET",
      url: "/api/me/wallet/apple/ticket.pkpass",
      headers: asUser(uid),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/vnd.apple.pkpass");
    expect(res.rawPayload.subarray(0, 4).toString("hex")).toBe("504b0304");

    const { pool } = await import("../../src/db/pool.js");
    const pass = await pool.query(
      `SELECT serial_number, authentication_token FROM wallet_passes WHERE user_id = $1`,
      [uid],
    );
    const serial = pass.rows[0].serial_number;
    const token = pass.rows[0].authentication_token;

    const native = await app.inject({
      method: "GET",
      url: `/api/wallet/apple/v1/passes/pass.local.hackos/${serial}`,
      headers: { authorization: `ApplePass ${token}` },
    });
    expect(native.statusCode).toBe(200);
    expect(native.rawPayload.subarray(0, 4).toString("hex")).toBe("504b0304");
  });

  it("registers and lists changed serials for an Apple device", async () => {
    const uid = await createUser();
    await issueTicket(uid, "ticket-wallet-2");
    await app.inject({
      method: "GET",
      url: "/api/me/wallet/apple/ticket.pkpass",
      headers: asUser(uid),
    });

    const { pool } = await import("../../src/db/pool.js");
    const pass = await pool.query(
      `SELECT serial_number, authentication_token FROM wallet_passes WHERE user_id = $1`,
      [uid],
    );
    const serial = pass.rows[0].serial_number;
    const token = pass.rows[0].authentication_token;

    const register = await app.inject({
      method: "POST",
      url: `/api/wallet/apple/v1/devices/device-1/registrations/pass.local.hackos/${serial}`,
      headers: { authorization: `ApplePass ${token}` },
      payload: { pushToken: "push-1" },
    });
    expect(register.statusCode).toBe(201);

    const changed = await app.inject({
      method: "GET",
      url: "/api/wallet/apple/v1/devices/device-1/registrations/pass.local.hackos",
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().serialNumbers).toContain(serial);
  });

  it("issues a fresh active badge pass after badge rotation voids the old serial", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
    const uid = await createUser();
    await assignBadge(uid, "BADGE-OLD");

    const first = await app.inject({
      method: "GET",
      url: "/api/me/wallet/apple/badge.pkpass",
      headers: asUser(uid),
    });
    expect(first.statusCode).toBe(200);

    const rotate = await app.inject({
      method: "POST",
      url: "/api/accreditation/rotate",
      headers: asUser(staff),
      payload: { userId: uid, newBadgeId: "BADGE-NEW", reason: "lost" },
    });
    expect(rotate.statusCode).toBe(200);

    const second = await app.inject({
      method: "GET",
      url: "/api/me/wallet/apple/badge.pkpass",
      headers: asUser(uid),
    });
    expect(second.statusCode).toBe(200);

    const { pool } = await import("../../src/db/pool.js");
    const passes = await pool.query(
      `SELECT status FROM wallet_passes WHERE user_id = $1 AND purpose = 'badge' ORDER BY id`,
      [uid],
    );
    expect(passes.rows.map((r: { status: string }) => r.status)).toEqual(["voided", "active"]);
  });
});
