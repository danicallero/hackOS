import {
  googleProviderFetch,
  lastGoogleObject,
  stubGoogleProvider,
} from "./google-provider-fixtures.js";
import "./env.js";
import "./wallet-fixtures.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import sharp from "sharp";
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
  lastRequest: null as { path: string; topic: string; pushType: string } | null,
  status: 200,
  requestError: null as Error | null,
  requests: [] as string[],
  failToken: null as string | null,
}));

vi.mock("node:http2", () => {
  return {
    connect: vi.fn(() => {
      const session = new EventEmitter() as EventEmitter & Record<string, unknown>;
      session.close = () => {};
      session.request = (headers: Record<string, string>) => {
        pushState.requests.push(headers[":path"]!);
        const requestStatus =
          headers[":path"] === `/3/device/${pushState.failToken}` ? 500 : pushState.status;
        pushState.lastRequest = {
          path: headers[":path"]!,
          topic: headers["apns-topic"]!,
          pushType: headers["apns-push-type"]!,
        };
        const stream = new EventEmitter() as EventEmitter & Record<string, unknown>;
        stream.setEncoding = () => {};
        stream.setTimeout = () => {};
        stream.end = () => {
          if (pushState.requestError) {
            const error = pushState.requestError;
            queueMicrotask(() => stream.emit("error", error));
            return;
          }
          queueMicrotask(() => {
            stream.emit("response", { ":status": requestStatus });
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
  stubGoogleProvider();
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  app ??= await buildTestApp();
  pushState.lastRequest = null;
  pushState.status = 200;
  pushState.requestError = null;
  pushState.requests = [];
  pushState.failToken = null;
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

function pngDimensions(buf: Buffer) {
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
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
    expect(res.headers["x-apple-pass-type-identifier"]).toBe(PASS_TYPE_IDENTIFIER);
    expect(res.headers["x-apple-pass-serial-number"]).toMatch(/^ticket-/);
    expect(res.rawPayload.subarray(0, 4).toString("hex")).toBe("504b0304");

    const entries = readStoredZipEntries(res.rawPayload);
    assertValidDetachedSignature(entries["manifest.json"]!, entries.signature!);

    // PassKit refuses to render a pass whose bundle has no icon, even though
    // it accepts the download and shows the "Add to Wallet" prompt — a bug
    // that a status-code/signature-only check like the above would miss.
    const manifest = JSON.parse(entries["manifest.json"]!.toString());
    const imageFiles = [
      "icon.png",
      "icon@2x.png",
      "icon@3x.png",
      "logo.png",
      "logo@2x.png",
      "strip.png",
      "strip@2x.png",
      "strip@3x.png",
    ];
    for (const name of imageFiles) {
      expect(entries[name]).toBeDefined();
      pngDimensions(entries[name]!);
      expect(manifest[name]).toBe(createHash("sha1").update(entries[name]!).digest("hex"));
    }
    expect(pngDimensions(entries["strip.png"]!)).toEqual({ width: 375, height: 98 });
    expect(pngDimensions(entries["strip@2x.png"]!)).toEqual({ width: 750, height: 196 });
    expect(pngDimensions(entries["strip@3x.png"]!)).toEqual({ width: 1125, height: 294 });

    const { pool } = await import("../../src/db/pool.js");
    const pass = await pool.query(
      `SELECT serial_number, authentication_token FROM wallet_passes WHERE user_id = $1`,
      [uid],
    );
    const serial = pass.rows[0].serial_number;
    const token = pass.rows[0].authentication_token;

    const ticket = await app.inject({
      method: "GET",
      url: "/api/me/ticket",
      headers: asUser(uid),
    });
    expect(ticket.statusCode).toBe(200);
    expect(ticket.json().applePassSerialNumbers).toEqual({ ticket: serial, badge: null });

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
      `INSERT INTO event_config
          (id, name, tagline, hacking_starts_at, venue_name, venue_latitude, venue_longitude, pass_back_fields)
       VALUES (1, 'hackUDC', 'Build something great', '2026-02-27T16:30:00+01:00',
               'Facultade de Informática, UDC', 43.3332, -8.4115,
               '[{"label":"Schedule","value":"https://example.com/schedule"}]'::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, tagline = EXCLUDED.tagline, hacking_starts_at = EXCLUDED.hacking_starts_at,
         venue_name = EXCLUDED.venue_name, venue_latitude = EXCLUDED.venue_latitude,
         venue_longitude = EXCLUDED.venue_longitude, pass_back_fields = EXCLUDED.pass_back_fields`,
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

    // The device appends `v1/...` to webServiceURL — baking `/v1` into it made
    // Wallet call `/v1/v1/...`, so registrations 404'd and updates never
    // reached devices (H28).
    expect(pass.webServiceURL).toMatch(/\/api\/wallet\/apple$/);
    expect(pass.relevantDate).toBe(new Date("2026-02-27T16:30:00+01:00").toISOString());
    expect(pass.eventTicket.headerFields[0]).toMatchObject({ key: "when" });
    // No primaryFields: PassKit renders them overlaid on the strip image,
    // which collided with the "hackUDC" branding baked into that artwork.
    expect(pass.eventTicket.primaryFields).toBeUndefined();
    expect(pass.eventTicket.secondaryFields).toContainEqual({
      key: "name",
      label: "Participant",
      value: "Ada Lovelace",
    });
    expect(pass.eventTicket.secondaryFields).toContainEqual({
      key: "role",
      label: "Role",
      value: "Participant",
    });
    expect(pass.eventTicket.auxiliaryFields).toContainEqual({
      key: "purpose",
      label: "Pass",
      value: "Ticket",
    });
    expect(pass.eventTicket.auxiliaryFields).toContainEqual({
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
      value: "hackUDC",
    });
    expect(pass.eventTicket.backFields).toContainEqual({
      key: "venue",
      label: "Location",
      value: "Facultade de Informática, UDC",
    });
    expect(pass.eventTicket.backFields).toContainEqual({
      key: "custom-0",
      label: "Schedule",
      value: "https://example.com/schedule",
      attributedValue: '<a href="https://example.com/schedule">Schedule</a>',
    });
    expect(pass.locations).toEqual([
      {
        latitude: 43.3332,
        longitude: -8.4115,
        relevantText: "Facultade de Informática, UDC",
      },
    ]);
    // Links the pass to the mobile app (H28): numeric Adam ID (coerced from
    // the env string) + deep-link launch URL from MOBILE_APP_SCHEME.
    expect(pass.associatedStoreIdentifiers).toEqual([1234567890]);
    expect(pass.appLaunchURL).toBe("hackos://");
    expect(pass.foregroundColor).toBe("rgb(250,250,250)");
    expect(pass.backgroundColor).toBe("rgb(163,213,255)");
    expect(pass.labelColor).toBe("rgb(3,8,70)");
    expect(pass.suppressStripShine).toBe(true);
  });

  it("applies admin-overridden pass field labels, falling back to defaults for the rest (H28)", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const uid = await createUser({ name: "Ada", email: "ada@test.local" });
    await pool.query(
      `INSERT INTO event_config (id, pass_field_labels)
       VALUES (1, '{"participant":"Hacker","email":"Contact"}'::jsonb)
       ON CONFLICT (id) DO UPDATE SET pass_field_labels = EXCLUDED.pass_field_labels`,
    );
    await issueTicket(uid, "ticket-wallet-labels");

    const res = await app.inject({
      method: "GET",
      url: "/api/me/wallet/apple/ticket.pkpass",
      headers: asUser(uid),
    });
    expect(res.statusCode).toBe(200);

    const entries = readStoredZipEntries(res.rawPayload);
    const pass = JSON.parse(entries["pass.json"]!.toString());

    // Overridden labels apply...
    expect(pass.eventTicket.secondaryFields).toContainEqual({
      key: "name",
      label: "Hacker",
      value: "Ada",
    });
    expect(pass.eventTicket.auxiliaryFields).toContainEqual({
      key: "email",
      label: "Contact",
      value: "ada@test.local",
    });
    // ...and untouched keys keep their default label.
    expect(pass.eventTicket.secondaryFields).toContainEqual({
      key: "role",
      label: "Role",
      value: "Participant",
    });
    expect(pass.eventTicket.auxiliaryFields).toContainEqual({
      key: "purpose",
      label: "Pass",
      value: "Ticket",
    });
  });

  it("pushes every Apple pass when event config actually changes, but not on a no-op save (H28, H45/H47)", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { PASS_TYPE_IDENTIFIER } = await import("../../src/modules/logistics/wallet.js");
    const uid = await createUser();
    await issueTicket(uid, "ticket-wallet-refresh");
    await app.inject({
      method: "GET",
      url: "/api/me/wallet/apple/ticket.pkpass",
      headers: asUser(uid),
    });
    const before = await pool.query(
      `SELECT id, serial_number, authentication_token, update_tag FROM wallet_passes WHERE user_id = $1`,
      [uid],
    );
    const passId = before.rows[0].id;
    const serial = before.rows[0].serial_number;
    const token = before.rows[0].authentication_token;
    await app.inject({
      method: "POST",
      url: `/api/wallet/apple/v1/devices/device-refresh/registrations/${PASS_TYPE_IDENTIFIER}/${serial}`,
      headers: { authorization: `ApplePass ${token}` },
      payload: { pushToken: "push-refresh" },
    });

    const manager = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);

    // A no-op save (identical values) must not bump update_tag or push.
    const noop = await app.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: {},
    });
    expect(noop.statusCode).toBe(200);
    const afterNoop = await pool.query(`SELECT update_tag FROM wallet_passes WHERE id = $1`, [
      passId,
    ]);
    expect(afterNoop.rows[0].update_tag).toBe(before.rows[0].update_tag);
    expect(pushState.lastRequest).toBeNull();

    // An actual change bumps update_tag and pushes registered devices.
    const changed = await app.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: { name: "hackUDC 2026" },
    });
    expect(changed.statusCode).toBe(200);
    const afterChange = await pool.query(`SELECT update_tag FROM wallet_passes WHERE id = $1`, [
      passId,
    ]);
    expect(afterChange.rows[0].update_tag).not.toBe(before.rows[0].update_tag);

    // The queue job isn't executed inline in this test process — invoke the
    // processor directly with the bumped pass id, same pattern the badge
    // rotation sync test uses instead of waiting on worker timing.
    const { processWalletSync } = await import("../../src/modules/logistics/wallet-sync.js");
    await processWalletSync({ data: { passIds: [passId] } } as never);
    expect(pushState.lastRequest).toEqual({
      path: "/3/device/push-refresh",
      topic: PASS_TYPE_IDENTIFIER,
      pushType: "alert",
    });
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

  it("accepts tokenless polling only for registered device identifiers (H28)", async () => {
    const { PASS_TYPE_IDENTIFIER } = await import("../../src/modules/logistics/wallet.js");
    const { pool } = await import("../../src/db/pool.js");
    const owner = await createUser();
    const other = await createUser();
    await issueTicket(owner, "ticket-wallet-token-owner");
    await issueTicket(other, "ticket-wallet-token-other");

    await app.inject({
      method: "GET",
      url: "/api/me/wallet/apple/ticket.pkpass",
      headers: asUser(owner),
    });
    await app.inject({
      method: "GET",
      url: "/api/me/wallet/apple/ticket.pkpass",
      headers: asUser(other),
    });
    const passes = await pool.query(
      `SELECT user_id, serial_number, authentication_token FROM wallet_passes WHERE user_id = ANY($1)`,
      [[owner, other]],
    );
    const ownerPass = passes.rows.find((pass) => pass.user_id === owner)!;
    const baseUrl = `/api/wallet/apple/v1/devices/device-token/registrations/${PASS_TYPE_IDENTIFIER}`;

    const register = await app.inject({
      method: "POST",
      url: `${baseUrl}/${ownerPass.serial_number}`,
      headers: { authorization: `ApplePass ${ownerPass.authentication_token}` },
      payload: { pushToken: "push-token" },
    });
    expect(register.statusCode).toBe(201);

    const poll = await app.inject({ method: "GET", url: baseUrl });
    expect(poll.statusCode).toBe(200);
    expect(poll.json().serialNumbers).toEqual([ownerPass.serial_number]);
    expect(
      (await app.inject({ method: "GET", url: baseUrl.replace("device-token", "unknown-device") }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `${baseUrl}/${ownerPass.serial_number}`,
          payload: { pushToken: "forged" },
        })
      ).statusCode,
    ).toBe(401);
  });

  it.each([
    0, 60_000,
  ])("reports an event-config bump with %i ms clock skew (H28 / #896)", async (clockSkew) => {
    // Pre-0504 regression: issuance wrote millisecond tags, bumps wrote
    // second tags, and the endpoint compared them AS TEXT — so this exact
    // sequence (poll, change event, poll again with the stored lastUpdated)
    // could answer 204 and the device never refetched, which is how both
    // APNs pushes and pull-to-refresh looked "broken".
    const { PASS_TYPE_IDENTIFIER } = await import("../../src/modules/logistics/wallet.js");
    const { pool } = await import("../../src/db/pool.js");
    const uid = await createUser();
    await issueTicket(uid, "ticket-wallet-poll");
    await app.inject({
      method: "GET",
      url: "/api/me/wallet/apple/ticket.pkpass",
      headers: asUser(uid),
    });
    const pass = await pool.query(
      `SELECT serial_number, authentication_token, update_tag FROM wallet_passes WHERE user_id = $1`,
      [uid],
    );
    const serial = pass.rows[0].serial_number;
    await app.inject({
      method: "POST",
      url: `/api/wallet/apple/v1/devices/device-poll/registrations/${PASS_TYPE_IDENTIFIER}/${serial}`,
      headers: { authorization: `ApplePass ${pass.rows[0].authentication_token}` },
      payload: { pushToken: "push-poll" },
    });

    const otherUser = await createUser();
    await issueTicket(otherUser, "ticket-wallet-poll-other");
    await app.inject({
      method: "GET",
      url: "/api/me/wallet/apple/ticket.pkpass",
      headers: asUser(otherUser),
    });
    const otherPass = await pool.query(
      `SELECT serial_number, authentication_token FROM wallet_passes WHERE user_id = $1`,
      [otherUser],
    );
    const otherSerial = otherPass.rows[0].serial_number;
    await app.inject({
      method: "POST",
      url: `/api/wallet/apple/v1/devices/device-poll/registrations/${PASS_TYPE_IDENTIFIER}/${otherSerial}`,
      headers: { authorization: `ApplePass ${otherPass.rows[0].authentication_token}` },
      payload: { pushToken: "push-poll" },
    });

    // H28 / #896: model an issuance clock ahead of the database without
    // relying on the machine's actual clock skew or elapsed test time.
    await pool.query(
      `UPDATE wallet_passes
          SET update_tag = ((extract(epoch FROM clock_timestamp()) * 1000)::bigint + $2)::text
        WHERE user_id = $1`,
      [uid, clockSkew],
    );

    // First poll: device stores lastUpdated, as Wallet does.
    const first = await app.inject({
      method: "GET",
      url: `/api/wallet/apple/v1/devices/device-poll/registrations/${PASS_TYPE_IDENTIFIER}`,
    });
    const lastUpdated: string = first.json().lastUpdated;

    // Nothing changed since → 204, so Wallet doesn't refetch pointlessly.
    const quiet = await app.inject({
      method: "GET",
      url: `/api/wallet/apple/v1/devices/device-poll/registrations/${PASS_TYPE_IDENTIFIER}?passesUpdatedSince=${lastUpdated}`,
    });
    expect(quiet.statusCode).toBe(204);

    // Event config changes (what an organiser edits before wondering why
    // their iPhone won't refresh)…
    const manager = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    const put = await app.inject({
      method: "PUT",
      url: "/api/event",
      headers: asUser(manager),
      payload: { name: "hackUDC poll regression" },
    });
    expect(put.statusCode).toBe(200);

    // …and the bumped tag is canonical integer millis, strictly newer.
    const bumped = await pool.query(`SELECT update_tag FROM wallet_passes WHERE user_id = $1`, [
      uid,
    ]);
    expect(bumped.rows[0].update_tag).toMatch(/^\d{13,}$/);

    // The incremental poll now MUST report the pass as changed.
    const afterChange = await app.inject({
      method: "GET",
      url: `/api/wallet/apple/v1/devices/device-poll/registrations/${PASS_TYPE_IDENTIFIER}?passesUpdatedSince=${lastUpdated}`,
    });
    expect(afterChange.statusCode).toBe(200);
    expect(afterChange.json().serialNumbers.sort()).toEqual([serial, otherSerial].sort());
    expect(Number(afterChange.json().lastUpdated)).toBeGreaterThan(Number(lastUpdated));

    // Repeated/concurrent bumps must advance even while the clock remains
    // behind the tags and all passes must exceed the shared device cursor.
    const { bumpAllAppleWalletUpdateTags } = await import(
      "../../src/modules/logistics/wallet-passes.js"
    );
    await Promise.all([bumpAllAppleWalletUpdateTags(), bumpAllAppleWalletUpdateTags()]);
    const again = await app.inject({
      method: "GET",
      url: `/api/wallet/apple/v1/devices/device-poll/registrations/${PASS_TYPE_IDENTIFIER}?passesUpdatedSince=${afterChange.json().lastUpdated}`,
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().serialNumbers.sort()).toEqual([serial, otherSerial].sort());
    expect(Number(again.json().lastUpdated)).toBeGreaterThan(
      Number(afterChange.json().lastUpdated),
    );
  });

  it("serves Last-Modified and answers 304 until the pass actually changes (H28)", async () => {
    const { PASS_TYPE_IDENTIFIER } = await import("../../src/modules/logistics/wallet.js");
    const { pool } = await import("../../src/db/pool.js");
    const uid = await createUser();
    await issueTicket(uid, "ticket-wallet-304");
    await app.inject({
      method: "GET",
      url: "/api/me/wallet/apple/ticket.pkpass",
      headers: asUser(uid),
    });
    const pass = await pool.query(
      `SELECT id, serial_number, authentication_token FROM wallet_passes WHERE user_id = $1`,
      [uid],
    );
    const serial = pass.rows[0].serial_number;
    const auth = { authorization: `ApplePass ${pass.rows[0].authentication_token}` };
    const url = `/api/wallet/apple/v1/passes/${PASS_TYPE_IDENTIFIER}/${serial}`;

    const fresh = await app.inject({ method: "GET", url, headers: auth });
    expect(fresh.statusCode).toBe(200);
    const lastModified = fresh.headers["last-modified"] as string;
    expect(lastModified).toBeTruthy();

    const unchanged = await app.inject({
      method: "GET",
      url,
      headers: { ...auth, "if-modified-since": lastModified },
    });
    expect(unchanged.statusCode).toBe(304);

    // Bump the tag past the device's copy (next full second, so the
    // second-precision HTTP date comparison can't tie) → full 200 again.
    await pool.query(`UPDATE wallet_passes SET update_tag = $2 WHERE id = $1`, [
      pass.rows[0].id,
      String(Date.now() + 1500),
    ]);
    const changed = await app.inject({
      method: "GET",
      url,
      headers: { ...auth, "if-modified-since": lastModified },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.rawPayload.subarray(0, 4).toString("hex")).toBe("504b0304");
  });

  it("issues a fresh active badge pass after badge rotation voids the old serial", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
    const uid = await createUser();
    const { grantAttendeeRole } = await import("../helpers.js");
    await grantAttendeeRole(uid, "participant");
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

    // H28 / #896: event-wide bumps include voided passes whose rotation
    // path still writes legacy fractional-second tags.
    const { bumpAllAppleWalletUpdateTags } = await import(
      "../../src/modules/logistics/wallet-passes.js"
    );
    expect(await bumpAllAppleWalletUpdateTags()).toHaveLength(2);
    const bumped = await pool.query(`SELECT update_tag FROM wallet_passes WHERE user_id = $1`, [
      uid,
    ]);
    for (const pass of bumped.rows) expect(pass.update_tag).toMatch(/^\d{13,}$/);
  });
});

describe("H28 Google Wallet", () => {
  it("issues a compact save link after synchronizing full pass content through REST", async () => {
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
    expect(claims.origins).toEqual(["http://localhost:3001"]);
    expect(claims.payload.eventTicketClasses).toBeUndefined();
    expect(lastGoogleObject()).toMatchObject({
      classId: "3388000000022222222.hackos_event_ticket",
      ticketHolderName: "Wallet",
      hexBackgroundColor: "#a3d5ff",
      ticketNumber: expect.stringMatching(/^ticket-/),
      ticketType: { defaultValue: { value: "Ticket" } },
      barcode: { value: "ticket-google-1" },
    });
    expect(claims.payload.genericObjects).toBeUndefined();
    expect(jwt.length).toBeLessThan(1800);

    const { pool } = await import("../../src/db/pool.js");
    const row = await pool.query(
      `SELECT platform, google_object_id, google_object_type FROM wallet_passes WHERE user_id = $1`,
      [uid],
    );
    expect(row.rows[0].platform).toBe("google");
    expect(row.rows[0].google_object_id).toBe(claims.payload.eventTicketObjects[0].id);
    expect(row.rows[0].google_object_type).toBe("event_ticket");
  });

  it("includes the configured event schedule and venue in the Event Ticket resources", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const uid = await createUser({ name: "Wallet" });
    await pool.query(`UPDATE users SET surname = 'Holder' WHERE id = $1`, [uid]);
    await pool.query(
      `INSERT INTO event_config
          (id, name, venue_name, venue_latitude, venue_longitude,
           event_starts_at, event_ends_at, hacking_starts_at, hacking_ends_at)
       VALUES (1, 'hackUDC 2026', 'Facultade de Informática', 42.2437866, -8.6952099,
               '2026-09-06T15:00:00Z', '2026-09-07T18:00:00Z',
               '2026-09-06T19:00:00Z', '2026-09-06T22:00:00Z')
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, venue_name = EXCLUDED.venue_name,
         venue_latitude = EXCLUDED.venue_latitude, venue_longitude = EXCLUDED.venue_longitude,
         event_starts_at = EXCLUDED.event_starts_at, event_ends_at = EXCLUDED.event_ends_at,
         hacking_starts_at = EXCLUDED.hacking_starts_at, hacking_ends_at = EXCLUDED.hacking_ends_at`,
    );
    await issueTicket(uid, "ticket-google-event-fields");

    const res = await app.inject({
      method: "GET",
      url: "/api/me/wallet/google/ticket",
      headers: asUser(uid),
    });
    const jwt = res.json().saveUrl.slice("https://pay.google.com/gp/v/save/".length);
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    expect(claims.payload.eventTicketClasses).toBeUndefined();
    expect(lastGoogleObject().classId).toBe("3388000000022222222.hackos_event_ticket");
    expect(lastGoogleObject().validTimeInterval).toEqual({
      start: { date: "2026-09-06T15:00:00.000Z" },
      end: { date: "2026-09-07T18:00:00.000Z" },
    });

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
    const { processWalletSync } = await import("../../src/modules/logistics/wallet-sync.js");
    const pass = await pool.query(
      `SELECT id FROM wallet_passes WHERE user_id = $1 AND platform = 'google'`,
      [uid],
    );
    await processWalletSync({ data: { passIds: [pass.rows[0].id], action: "refresh" } } as never);
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patchCall?.[0]).toBe(
      "https://walletobjects.googleapis.com/walletobjects/v1/eventTicketClass/3388000000022222222.hackos_event_ticket",
    );
    expect(JSON.parse(patchCall![1]!.body as string).eventName.defaultValue.value).toBe(
      "hackUDC 2026",
    );
    expect(JSON.parse(patchCall![1]!.body as string).dateTime).toEqual({
      doorsOpen: "2026-09-06T15:00:00.000Z",
      start: "2026-09-06T15:00:00.000Z",
      end: "2026-09-07T18:00:00.000Z",
    });
    expect(JSON.parse(patchCall![1]!.body as string).venue).toEqual({
      name: { defaultValue: { language: "en-US", value: "Facultade de Informática" } },
      address: { defaultValue: { language: "en-US", value: "Facultade de Informática" } },
    });
    expect(
      JSON.parse(patchCall![1]!.body as string).classTemplateInfo.cardTemplateOverride
        .cardRowTemplateInfos,
    ).toHaveLength(3);

    // PATCH must explicitly clear fields removed in the editor; omission
    // would leave a stale venue/date/image on already saved Google passes.
    await pool.query(
      `UPDATE event_config SET event_starts_at=NULL, event_ends_at=NULL,
         hacking_starts_at=NULL, hacking_ends_at=NULL, venue_name=NULL,
         venue_latitude=NULL, venue_longitude=NULL WHERE id=1`,
    );
    await processWalletSync({ data: { passIds: [pass.rows[0].id], action: "refresh" } } as never);
    const classPatches = fetchMock.mock.calls.filter(
      ([url, init]) => url.includes("/eventTicketClass/") && init?.method === "PATCH",
    );
    expect(JSON.parse(classPatches.at(-1)![1]!.body as string)).toMatchObject({
      dateTime: null,
      venue: null,
      locations: [],
    });
    const objectPatches = fetchMock.mock.calls.filter(
      ([url, init]) => url.includes("/eventTicketObject/") && init?.method === "PATCH",
    );
    expect(JSON.parse(objectPatches.at(-1)![1]!.body as string).validTimeInterval).toBeNull();
  });

  it("migrates a legacy generic ticket before issuing an Event Ticket", async () => {
    const uid = await createUser({ name: "Legacy" });
    await issueTicket(uid, "ticket-google-legacy");
    const { pool } = await import("../../src/db/pool.js");
    const legacyObjectId = "3388000000022222222.ticket_legacy";
    const legacy = await pool.query(
      `INSERT INTO wallet_passes
         (user_id, purpose, platform, serial_number, authentication_token, google_object_id, google_object_type)
       VALUES ($1, 'ticket', 'google', 'legacy-ticket', 'legacy-token', $2, 'generic')
       RETURNING id`,
      [uid, legacyObjectId],
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/me/wallet/google/ticket",
      headers: asUser(uid),
    });
    expect(res.statusCode).toBe(200);

    const passes = await pool.query(
      `SELECT id, status, google_object_id, google_object_type
         FROM wallet_passes WHERE user_id = $1 AND purpose = 'ticket' ORDER BY id`,
      [uid],
    );
    expect(passes.rows).toEqual([
      {
        id: legacy.rows[0].id,
        status: "voided",
        google_object_id: legacyObjectId,
        google_object_type: "generic",
      },
      expect.objectContaining({ status: "active", google_object_type: "event_ticket" }),
    ]);

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
    const { processWalletSync } = await import("../../src/modules/logistics/wallet-sync.js");
    await processWalletSync({ data: { passIds: [legacy.rows[0].id] } } as never);
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patchCall?.[0]).toBe(
      `https://walletobjects.googleapis.com/walletobjects/v1/genericObject/${legacyObjectId}`,
    );
  });
});

describe("H28 Wallet deployment defaults", () => {
  it("restores environment-backed fields after a runtime customization", async () => {
    const manager = await createUserWithCapabilities([CAPABILITIES.WALLET_MANAGE]);
    const initial = await app.inject({
      method: "GET",
      url: "/api/event/wallet",
      headers: asUser(manager),
    });
    expect(initial.statusCode).toBe(200);
    const defaults = initial.json();
    const { artwork: _artwork, artworkDefaults: _artworkDefaults, ...body } = defaults;
    const saved = await app.inject({
      method: "PUT",
      url: "/api/event/wallet",
      headers: asUser(manager),
      payload: {
        ...body,
        backgroundColor: "#112233",
        websiteUrl: "https://event.example.org",
        scheduleUrl: "hackos:///schedule",
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().backgroundColor).toBe("#112233");
    const { pool } = await import("../../src/db/pool.js");
    const overrides = await pool.query(
      `SELECT background_color, foreground_color, website_url FROM wallet_settings WHERE id=1`,
    );
    expect(overrides.rows[0]).toEqual({
      background_color: "#112233",
      foreground_color: null,
      website_url: "https://event.example.org",
    });

    const restored = await app.inject({
      method: "DELETE",
      url: "/api/event/wallet",
      headers: asUser(manager),
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      backgroundColor: defaults.backgroundColor,
      websiteUrl: defaults.websiteUrl,
      scheduleUrl: defaults.scheduleUrl,
    });
    const row = await pool.query(
      `SELECT background_color, website_url, schedule_url, apple_options FROM wallet_settings WHERE id=1`,
    );
    expect(row.rows[0]).toEqual({
      background_color: null,
      website_url: null,
      schedule_url: null,
      apple_options: null,
    });
  });

  it("publishes graphics and uses the selected revision in a signed Apple pass", async () => {
    const manager = await createUserWithCapabilities([CAPABILITIES.WALLET_MANAGE]);
    const holder = await createUser({ name: "Artwork" });
    await issueTicket(holder, "ticket-artwork");
    const { uploadWalletArtwork, readWalletArtwork } = await import(
      "../../src/modules/logistics/wallet-settings.js"
    );
    const image = await sharp({
      create: { width: 375, height: 98, channels: 4, background: "#112233" },
    })
      .png()
      .toBuffer();
    const settings = await uploadWalletArtwork(manager, "appleStrip", image);
    const revision = settings.artwork.appleStrip;
    expect(revision?.url).toMatch(/\/api\/wallet\/artwork\/[0-9a-f-]+\/1\.png$/);
    expect(pngDimensions(await readWalletArtwork(revision!.id, 3))).toEqual({
      width: 1125,
      height: 294,
    });
    const pass = await app.inject({
      method: "GET",
      url: "/api/me/wallet/apple/ticket.pkpass",
      headers: asUser(holder),
    });
    expect(pass.statusCode).toBe(200);
    const entries = readStoredZipEntries(pass.rawPayload);
    expect(entries["strip.png"]).toEqual(await readWalletArtwork(revision!.id, 1));
  });

  it("queues a trilingual alert once and delivers it to registered Apple and Google passes", async () => {
    const manager = await createUserWithCapabilities([CAPABILITIES.WALLET_MANAGE]);
    const holder = await createUser({ name: "Alert" });
    await issueTicket(holder, "ticket-alert");
    await app.inject({
      method: "GET",
      url: "/api/me/wallet/apple/ticket.pkpass",
      headers: asUser(holder),
    });
    await app.inject({
      method: "GET",
      url: "/api/me/wallet/google/ticket",
      headers: asUser(holder),
    });
    const { pool } = await import("../../src/db/pool.js");
    const apple = await pool.query(
      `SELECT id FROM wallet_passes WHERE user_id=$1 AND platform='apple'`,
      [holder],
    );
    await pool.query(
      `INSERT INTO wallet_pass_devices(pass_id,device_library_identifier,push_token)
       VALUES($1,'alert-device','alert-push')`,
      [apple.rows[0].id],
    );
    const payload = {
      kind: "alert",
      translations: {
        en: { title: "Doors open", body: "Come to the venue" },
        es: { title: "Abren las puertas", body: "Ven al recinto" },
        gl: { title: "Abren as portas", body: "Vén ao recinto" },
      },
    };
    const headers = { ...asUser(manager), "idempotency-key": "wallet-alert-1" };
    const queued = await app.inject({
      method: "POST",
      url: "/api/event/wallet/operations",
      headers,
      payload,
    });
    expect(queued.statusCode).toBe(202);
    expect(queued.json().total).toBe(2);
    const repeated = await app.inject({
      method: "POST",
      url: "/api/event/wallet/operations",
      headers,
      payload,
    });
    expect(repeated.json().id).toBe(queued.json().id);
    const { processWalletOperations } = await import(
      "../../src/modules/logistics/wallet-operations.js"
    );
    await processWalletOperations();
    const status = await app.inject({
      method: "GET",
      url: `/api/event/wallet/operations/${queued.json().id}`,
      headers: asUser(manager),
    });
    expect(status.json()).toMatchObject({ sent: 2, queued: 0, failed: 0 });
    expect(pushState.requests).toContain("/3/device/alert-push");
    const messageCalls = googleProviderFetch.mock.calls.filter(
      ([url, init]) => url.endsWith("/addMessage") && init?.method === "POST",
    );
    expect(messageCalls).toHaveLength(1);
    expect(JSON.parse(messageCalls[0]![1]!.body as string).message).toMatchObject({
      header: "Doors open",
      body: "Come to the venue",
      messageType: "TEXT_AND_NOTIFY",
    });
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
      pushType: "alert",
    });

    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patchCall?.[0]).toBe(
      `https://walletobjects.googleapis.com/walletobjects/v1/genericObject/${googleObjectId}`,
    );
    expect(JSON.parse(patchCall![1]!.body as string)).toEqual({ state: "EXPIRED" });
  });

  it("notifies Apple devices even when the Google class refresh fails (H28)", async () => {
    const uid = await createUser();
    await assignBadge(uid, "BADGE-PROVIDER-FAIL");
    const appleId = await createBadgePass(uid, "apple");
    await issueTicket(uid, "ticket-provider-fail");
    const { buildGoogleSaveUrl } = await import("../../src/modules/logistics/google-wallet.js");
    await buildGoogleSaveUrl(uid, "ticket");
    const { pool } = await import("../../src/db/pool.js");
    const google = await pool.query(
      `SELECT id FROM wallet_passes WHERE user_id = $1 AND platform = 'google'`,
      [uid],
    );
    await pool.query(
      `INSERT INTO wallet_pass_devices (pass_id, device_library_identifier, push_token) VALUES ($1, 'provider-device', 'provider-push')`,
      [appleId],
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("oauth2")
          ? new Response(JSON.stringify({ access_token: "test-token", expires_in: 3600 }), {
              status: 200,
            })
          : new Response("unavailable", { status: 503 }),
      ),
    );
    const { processWalletSync } = await import("../../src/modules/logistics/wallet-sync.js");
    await expect(
      processWalletSync({ data: { passIds: [appleId, google.rows[0].id], action: "refresh" } }),
    ).rejects.toThrow(/Wallet sync failed|503/);
    expect(pushState.requests).toContain("/3/device/provider-push");
  });

  it("continues to later devices after a push failure and enqueues retries (H28)", async () => {
    const uid = await createUser();
    await assignBadge(uid, "BADGE-DEVICE-FAIL");
    const passId = await createBadgePass(uid, "apple");
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `INSERT INTO wallet_pass_devices (pass_id, device_library_identifier, push_token) VALUES ($1, 'failed-device', 'failed-push'), ($1, 'healthy-device', 'healthy-push')`,
      [passId],
    );
    pushState.failToken = "failed-push";
    const { enqueueWalletSync, processWalletSync } = await import(
      "../../src/modules/logistics/wallet-sync.js"
    );
    await expect(processWalletSync({ data: { passIds: [passId] } })).rejects.toThrow("500");
    expect(pushState.requests).toEqual(
      expect.arrayContaining(["/3/device/failed-push", "/3/device/healthy-push"]),
    );
    await enqueueWalletSync([passId]);
    const { getQueue } = await import("../../src/lib/queues.js");
    const jobs = await getQueue("logistics.wallet-sync").getWaiting();
    expect(
      jobs.some(
        (job) =>
          job.opts.attempts === 5 &&
          job.opts.backoff &&
          typeof job.opts.backoff === "object" &&
          job.opts.backoff.type === "exponential",
      ),
    ).toBe(true);
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

  it("propagates request-level APNs errors without crashing the worker process", async () => {
    const uid = await createUser();
    await assignBadge(uid, "BADGE-DNS-ERROR");
    const { pool } = await import("../../src/db/pool.js");
    const passId = await createBadgePass(uid, "apple");
    await pool.query(
      `INSERT INTO wallet_pass_devices (pass_id, device_library_identifier, push_token)
       VALUES ($1, 'device-dns-error', 'push-dns-error')`,
      [passId],
    );

    pushState.requestError = new Error("getaddrinfo EAI_AGAIN api.push.apple.com");
    const { processWalletSync } = await import("../../src/modules/logistics/wallet-sync.js");

    await expect(processWalletSync({ data: { passIds: [passId] } } as never)).rejects.toThrow(
      "EAI_AGAIN",
    );
  });
});
