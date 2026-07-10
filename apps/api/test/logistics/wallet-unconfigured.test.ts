import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { asUser, buildTestApp, createUser, truncateAll } from "../helpers.js";
import { issueTicket } from "./fixtures.js";

/**
 * Deliberately does NOT import wallet-fixtures.ts — config.ts is a
 * module-level singleton parsed once at first import, so this file (which
 * vitest gives its own module graph, same as every other test file here)
 * is the only way to exercise the "provider not configured" path for real,
 * rather than mutating process.env after config has already been read.
 */

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

describe("H28 wallet providers unconfigured", () => {
  it("returns 503 for Apple Wallet instead of an invalid/empty signature", async () => {
    const uid = await createUser();
    await issueTicket(uid, "ticket-unconfigured-apple");

    const res = await app.inject({
      method: "GET",
      url: "/api/me/wallet/apple/ticket.pkpass",
      headers: asUser(uid),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("service_unavailable");
  });

  it("returns 503 for Google Wallet", async () => {
    const uid = await createUser();
    await issueTicket(uid, "ticket-unconfigured-google");

    const res = await app.inject({
      method: "GET",
      url: "/api/me/wallet/google/ticket",
      headers: asUser(uid),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("service_unavailable");
  });
});
