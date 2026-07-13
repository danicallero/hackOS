import "./env.js";
import "./wallet-fixtures.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import { assignBadge, createBadgePass, issueTicket } from "./fixtures.js";

/**
 * H28. Uses real certs/keys from wallet-fixtures.ts, so this exercises the
 * actual openssl signing and RS256 JWT-signing code paths — not a mocked
 * stand-in. Only external HTTP (Google's OAuth + Wallet API, Apple's APNs)
 * is stubbed, same as test/notifications/push.test.ts.
 */

const pushState = vi.hoisted(() => ({
  lastRequest: null as { path: string; topic: string } | null,
  status: 200,
}));

vi.mock("node:http2", () => {
  return {
    connect: vi.fn(() => {
      const session = new EventEmitter() as EventEmitter & Record<string, unknown>;
      session.close = () => {};
      session.request = (headers: Record<string, string>) => {
        pushState.lastRequest = { path: headers[":path"]!, topic: headers["apns-topic"]! };
        const stream = new EventEmitter() as EventEmitter & Record<string, unknown>;
        stream.setEncoding = () => {};
        stream.end = () => {
          queueMicrotask(() => {
            stream.emit("response", { ":status": pushState.status });
            stream.emit("end");
          });
        };
        return stream;
      };
      return session;
    }),
  };
});

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  app ??= await buildTestApp();
  pushState.lastRequest = null;
  pushState.status = 200;
});

afterEach(() => {
  vi.unstubAllGlobals();
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

/** wallet.ts's zip is hand-rolled STORE-only with no data descriptors — entries are back-to-back. */
function readStoredZipEntries(buf: Buffer): Record<string, Buffer> {
  const entries: Record<string, Buffer> = {};
  let offset = 0;
  while (offset < buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const nameLen = buf.readUInt16LE(offset + 26);
    const dataLen = buf.readUInt32LE(offset + 18);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen;
    const name = buf.subarray(nameStart, dataStart).toString();
    entries[name] = buf.subarray(dataStart, dataStart + dataLen);
    offset = dataStart + dataLen;
  }
  return entries;
}

/** Regression check for the empty-signature bug: verifies the DER signature cryptographically matches the manifest. */
function assertValidDetachedSignature(manifest: Buffer, signature: Buffer) {
  expect(signature.length).toBeGreaterThan(0);
  const dir = mkdtempSync(join(tmpdir(), "hackos-sig-check-"));
  try {
    const manifestPath = join(dir, "manifest.json");
    const sigPath = join(dir, "signature");
    writeFileSync(manifestPath, manifest);
    writeFileSync(sigPath, signature);
    expect(() =>
      execFileSync("openssl", [
        "smime",
        "-verify",
        "-noverify",
        "-inform",
        "DER",
        "-in",
        sigPath,
        "-content",
        manifestPath,
        "-out",
        "/dev/null",
      ]),
    ).not.toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("H28 Apple Wallet PassKit", () => {
  it("issues a ticket pkpass signed with a real, verifiable signature", async () => {
    const { PASS_TYPE_IDENTIFIER } = await import("../../src/modules/logistics/wallet.js");
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

    const entries = readStoredZipEntries(res.rawPayload);
    assertValidDetachedSignature(entries["manifest.json"]!, entries.signature!);

    // PassKit refuses to render a pass whose bundle has no icon, even though
    // it accepts the download and shows the "Add to Wallet" prompt — a bug
    // that a status-code/signature-only check like the above would miss.
    const manifest = JSON.parse(entries["manifest.json"]!.toString());
    for (const name of ["icon.png", "icon@2x.png", "icon@3x.png"]) {
      expect(entries[name]).toBeDefined();
      expect(entries[name]!.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(manifest[name]).toBe(createHash("sha1").update(entries[name]!).digest("hex"));
    }

    const { pool } = await import("../../src/db/pool.js");
    const pass = await pool.query(
      `SELECT serial_number, authentication_token FROM wallet_passes WHERE user_id = $1`,
      [uid],
    );
    const serial = pass.rows[0].serial_number;
    const token = pass.rows[0].authentication_token;

    const native = await app.inject({
      method: "GET",
      url: `/api/wallet/apple/v1/passes/${PASS_TYPE_IDENTIFIER}/${serial}`,
      headers: { authorization: `ApplePass ${token}` },
    });
    expect(native.statusCode).toBe(200);
    expect(native.rawPayload.subarray(0, 4).toString("hex")).toBe("504b0304");
  });

  it("fills the pass with event, university, and contact fields (H28)", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const uid = await createUser({ name: "Ada", email: "ada@test.local" });
    await pool.query(`UPDATE users SET surname = 'Lovelace' WHERE id = $1`, [uid]);
    const university = await pool.query(
      `INSERT INTO universities (name, proposed_by) VALUES ('UDC', $1) RETURNING id`,
      [uid],
    );
    await pool.query(`UPDATE users SET university_id = $1 WHERE id = $2`, [
      university.rows[0].id,
      uid,
    ]);
    await pool.query(
      `INSERT INTO event_config (id, name, tagline, hacking_starts_at)
       VALUES (1, 'hackUDC', 'Build something great', '2026-02-27T16:30:00+01:00')
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, tagline = EXCLUDED.tagline, hacking_starts_at = EXCLUDED.hacking_starts_at`,
    );
    await issueTicket(uid, "ticket-wallet-fields");

    const res = await app.inject({
      method: "GET",
      url: "/api/me/wallet/apple/ticket.pkpass",
      headers: asUser(uid),
    });
    expect(res.statusCode).toBe(200);

    const entries = readStoredZipEntries(res.rawPayload);
    const pass = JSON.parse(entries["pass.json"]!.toString());

    expect(pass.relevantDate).toBe(new Date("2026-02-27T16:30:00+01:00").toISOString());
    expect(pass.eventTicket.headerFields[0]).toMatchObject({ key: "when" });
    expect(pass.eventTicket.primaryFields).toContainEqual({
      key: "name",
      label: "Participant",
      value: "Ada Lovelace",
    });
    expect(pass.eventTicket.secondaryFields).toContainEqual({
      key: "purpose",
      label: "Pass",
      value: "Ticket",
    });
    expect(pass.eventTicket.secondaryFields).toContainEqual({
      key: "university",
      label: "University",
      value: "UDC",
    });
    expect(pass.eventTicket.auxiliaryFields).toContainEqual({
      key: "email",
      label: "Email",
      value: "ada@test.local",
    });
    expect(pass.eventTicket.backFields).toContainEqual({
      key: "event",
      label: "Event",
      value: "hackUDC — Build something great",
    });
    expect(pass.foregroundColor).toBe("rgb(255,255,255)");
    expect(pass.backgroundColor).toBe("rgb(40,40,40)");
    expect(pass.labelColor).toBe("rgb(255,180,0)");
  });

  it("registers and lists changed serials for an Apple device", async () => {
    const { PASS_TYPE_IDENTIFIER } = await import("../../src/modules/logistics/wallet.js");
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
      url: `/api/wallet/apple/v1/devices/device-1/registrations/${PASS_TYPE_IDENTIFIER}/${serial}`,
      headers: { authorization: `ApplePass ${token}` },
      payload: { pushToken: "push-1" },
    });
    expect(register.statusCode).toBe(201);

    const changed = await app.inject({
      method: "GET",
      url: `/api/wallet/apple/v1/devices/device-1/registrations/${PASS_TYPE_IDENTIFIER}`,
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

describe("H28 Google Wallet", () => {
  it("issues a save link with the object embedded in the JWT payload", async () => {
    const uid = await createUser({ name: "Wallet" });
    await issueTicket(uid, "ticket-google-1");

    const res = await app.inject({
      method: "GET",
      url: "/api/me/wallet/google/ticket",
      headers: asUser(uid),
    });
    expect(res.statusCode).toBe(200);
    const { saveUrl } = res.json();
    expect(saveUrl).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\//);

    const jwt = saveUrl.slice("https://pay.google.com/gp/v/save/".length);
    const [, payloadB64] = jwt.split(".");
    const claims = JSON.parse(Buffer.from(payloadB64!, "base64url").toString("utf8"));
    expect(claims.iss).toBe("test@hackos-test.iam.gserviceaccount.com");
    expect(claims.payload.genericObjects[0].barcode.value).toBe("ticket-google-1");

    const { pool } = await import("../../src/db/pool.js");
    const row = await pool.query(
      `SELECT platform, google_object_id FROM wallet_passes WHERE user_id = $1`,
      [uid],
    );
    expect(row.rows[0].platform).toBe("google");
    expect(row.rows[0].google_object_id).toBe(claims.payload.genericObjects[0].id);
  });
});

describe("H28 badge rotation syncs both platforms", () => {
  it("pushes the voided Apple pass to its devices and expires the Google object", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
    const uid = await createUser();
    await assignBadge(uid, "BADGE-SYNC-OLD");

    const { pool } = await import("../../src/db/pool.js");
    const applePassId = await createBadgePass(uid, "apple");
    await pool.query(
      `INSERT INTO wallet_pass_devices (pass_id, device_library_identifier, push_token)
       VALUES ($1, 'device-sync', 'push-sync')`,
      [applePassId],
    );
    const googlePassId = await createBadgePass(uid, "google");
    const googleRow = await pool.query(`SELECT google_object_id FROM wallet_passes WHERE id = $1`, [
      googlePassId,
    ]);
    const googleObjectId = googleRow.rows[0].google_object_id;

    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "test-token", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const rotate = await app.inject({
      method: "POST",
      url: "/api/accreditation/rotate",
      headers: asUser(staff),
      payload: { userId: uid, newBadgeId: "BADGE-SYNC-NEW", reason: "lost" },
    });
    expect(rotate.statusCode).toBe(200);

    // rotateBadge enqueues onto logistics.wallet-sync (a real BullMQ queue,
    // not executed inline); invoke the processor directly with the voided
    // ids, same pattern test/logistics/offline-wallet.test.ts uses for
    // logistics.meal-scans, instead of waiting on worker timing.
    const { processWalletSync } = await import("../../src/modules/logistics/wallet-sync.js");
    await processWalletSync({ data: { passIds: [applePassId, googlePassId] } } as never);

    const { PASS_TYPE_IDENTIFIER } = await import("../../src/modules/logistics/wallet.js");
    expect(pushState.lastRequest).toEqual({
      path: "/3/device/push-sync",
      topic: PASS_TYPE_IDENTIFIER,
    });

    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patchCall?.[0]).toBe(
      `https://walletobjects.googleapis.com/walletobjects/v1/genericObject/${googleObjectId}`,
    );
    expect(JSON.parse(patchCall![1]!.body as string)).toEqual({ state: "EXPIRED" });
  });

  it("drops the device registration when APNs reports it unregistered (410)", async () => {
    const uid = await createUser();
    await assignBadge(uid, "BADGE-410");
    const { pool } = await import("../../src/db/pool.js");
    const passId = await createBadgePass(uid, "apple");
    await pool.query(
      `INSERT INTO wallet_pass_devices (pass_id, device_library_identifier, push_token)
       VALUES ($1, 'device-gone', 'push-gone')`,
      [passId],
    );

    pushState.status = 410;
    const { processWalletSync } = await import("../../src/modules/logistics/wallet-sync.js");
    await processWalletSync({ data: { passIds: [passId] } } as never);

    const devices = await pool.query(`SELECT 1 FROM wallet_pass_devices WHERE pass_id = $1`, [
      passId,
    ]);
    expect(devices.rows).toHaveLength(0);
  });
});
