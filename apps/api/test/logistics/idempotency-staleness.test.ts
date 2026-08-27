import "./env.js";
import { createHash } from "node:crypto";
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

function hashRequest(body: unknown): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        method: "POST",
        url: "/api/accreditation/check-in",
        params: {},
        body,
      }),
    )
    .digest("hex");
}

/**
 * A first idempotent execution that never reaches idempotencyOnSend (dropped
 * connection, backgrounded app, server restart) leaves response_status NULL.
 * Without a staleness window that key would 409 "still in flight" forever —
 * which is exactly the offline scanner queue's stuck-forever failure mode,
 * since mobile reuses the persisted scan id as the Idempotency-Key on every
 * retry (H22, H25, H26).
 */

let app: App;
let staff: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  staff = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
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

describe("idempotencyGuard staleness reclaim", () => {
  it("keeps rejecting a fresh in-flight duplicate", async () => {
    const uid = await createUser();
    const token = await issueTicket(uid);
    const headers = { ...asUser(staff), "idempotency-key": "fresh-in-flight" };
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `INSERT INTO idempotency_keys (key, scope, request_hash)
       VALUES ($1, $2, $3)`,
      [
        "fresh-in-flight",
        `POST /api/accreditation/check-in u:${staff}`,
        hashRequest({ ticketToken: token, badgeId: "B-STALE", method: "qr" }),
      ],
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers,
      payload: { ticketToken: token, badgeId: "B-STALE", method: "qr" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("reclaims and re-executes an abandoned in-flight key older than the staleness window", async () => {
    const uid = await createUser();
    const token = await issueTicket(uid);
    const key = "abandoned-in-flight";
    const scope = `POST /api/accreditation/check-in u:${staff}`;
    const body = { ticketToken: token, badgeId: "B-RECLAIM", method: "qr" };
    const hash = hashRequest(body);

    const { pool } = await import("../../src/db/pool.js");
    // Simulate a first attempt that started 31s ago and never completed.
    await pool.query(
      `INSERT INTO idempotency_keys (key, scope, request_hash, created_at)
       VALUES ($1, $2, $3, now() - interval '31 seconds')`,
      [key, scope, hash],
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers: { ...asUser(staff), "idempotency-key": key },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().badgeId).toBe("B-RECLAIM");

    const logs = await pool.query(`SELECT * FROM check_in_logs WHERE user_id = $1`, [uid]);
    expect(logs.rows).toHaveLength(1);

    const record = await pool.query(
      `SELECT response_status FROM idempotency_keys WHERE key = $1 AND scope = $2`,
      [key, scope],
    );
    expect(record.rows[0].response_status).toBe(200);
  });
});
