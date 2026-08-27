import "./env.js";
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
import { issueTicket } from "./fixtures.js";

/**
 * A first idempotent execution that fails with a 5xx must not have that
 * failure replayed as the permanent result — mobile's offline scan queue
 * reuses the scan id as the Idempotency-Key, so a persisted 500 would jam
 * that scan forever (H22, H25, H26; issue #534).
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

afterEach(() => {
  vi.restoreAllMocks();
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

/** Makes the ticket-lookup query inside checkIn() throw exactly once. */
async function failNextTicketLookup() {
  const { pool } = await import("../../src/db/pool.js");
  const original = pool.query.bind(pool);
  let failed = false;
  return vi.spyOn(pool, "query").mockImplementation(((text: unknown, params?: unknown) => {
    if (!failed && typeof text === "string" && text.includes("FROM tickets WHERE token")) {
      failed = true;
      return Promise.reject(new Error("simulated transient failure"));
    }
    return original(text as string, params as unknown[]);
  }) as typeof pool.query);
}

describe("idempotencyGuard 5xx handling", () => {
  it("does not replay a transient 500; the same key/body retries and succeeds", async () => {
    const uid = await createUser();
    const token = await issueTicket(uid);
    const headers = { ...asUser(staff), "idempotency-key": "transient-500" };
    const payload = { ticketToken: token, badgeId: "B-500" };

    const spy = await failNextTicketLookup();
    const failed = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers,
      payload,
    });
    expect(failed.statusCode).toBe(500);
    spy.mockRestore();

    const { pool } = await import("../../src/db/pool.js");
    const scope = `POST /api/accreditation/check-in u:${staff}`;
    const afterFailure = await pool.query(
      `SELECT * FROM idempotency_keys WHERE key = $1 AND scope = $2`,
      ["transient-500", scope],
    );
    expect(afterFailure.rows).toHaveLength(0);

    const retry = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers,
      payload,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.headers["idempotency-replayed"]).toBeUndefined();

    const logs = await pool.query(`SELECT * FROM check_in_logs WHERE user_id = $1`, [uid]);
    expect(logs.rows).toHaveLength(1);

    const record = await pool.query(
      `SELECT response_status FROM idempotency_keys WHERE key = $1 AND scope = $2`,
      ["transient-500", scope],
    );
    expect(record.rows[0].response_status).toBe(200);

    const replay = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers,
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(
      (await pool.query(`SELECT * FROM check_in_logs WHERE user_id = $1`, [uid])).rows,
    ).toHaveLength(1);
  });

  it("lets a concurrent retry win after a transient failure releases the key", async () => {
    const uid = await createUser();
    const token = await issueTicket(uid);
    const headers = { ...asUser(staff), "idempotency-key": "transient-500-concurrent" };
    const payload = { ticketToken: token, badgeId: "B-500-C" };

    const spy = await failNextTicketLookup();
    const failed = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers,
      payload,
    });
    expect(failed.statusCode).toBe(500);
    spy.mockRestore();

    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: "/api/accreditation/check-in", headers, payload }),
      app.inject({ method: "POST", url: "/api/accreditation/check-in", headers, payload }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    // Exactly one executes (200); the other either replays it (200) or sees
    // the still-in-flight window (409) — never a stuck-forever failure.
    expect(codes[0]).toBe(200);
    expect([200, 409]).toContain(codes[1]);

    const { pool } = await import("../../src/db/pool.js");
    const logs = await pool.query(`SELECT * FROM check_in_logs WHERE user_id = $1`, [uid]);
    expect(logs.rows).toHaveLength(1);
  });

  it("still persists and replays a 4xx business error (no different-body retry needed)", async () => {
    const uid = await createUser();
    const token = await issueTicket(uid);
    const headers = { ...asUser(staff), "idempotency-key": "ticket-as-badge" };
    const payload = { ticketToken: token, badgeId: token };

    const first = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers,
      payload,
    });
    expect(first.statusCode).toBe(409);

    const replay = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers,
      payload,
    });
    expect(replay.statusCode).toBe(409);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
  });

  it("keeps a self-removal marker across a 503 so a retry can replay completion (H54)", async () => {
    const { idempotencyOnSend } = await import("../../src/lib/idempotency.js");
    const { pool } = await import("../../src/db/pool.js");
    const key = "self-removal-storage-failure";
    const scope = "POST /api/me/anonymize u:42";
    await pool.query(
      `INSERT INTO idempotency_keys (key, scope, request_hash)
       VALUES ($1, $2, 'request-hash')`,
      [key, scope],
    );

    await idempotencyOnSend(
      {
        idempotency: {
          key,
          scope,
          hash: "request-hash",
          replayed: false,
          preserveOnFailure: true,
        },
      } as never,
      { statusCode: 503 } as never,
      { error: { code: "removal_storage_pending" } },
    );

    const pending = await pool.query(
      `SELECT response_status, response_body FROM idempotency_keys WHERE key = $1 AND scope = $2`,
      [key, scope],
    );
    expect(pending.rows).toEqual([{ response_status: null, response_body: null }]);
  });

  it("does not let a late response overwrite a finalized removal result", async () => {
    const { idempotencyOnSend } = await import("../../src/lib/idempotency.js");
    const { pool } = await import("../../src/db/pool.js");
    const key = "self-removal-late-response";
    const scope = "POST /api/me/anonymize removal-complete";
    await pool.query(
      `INSERT INTO idempotency_keys
         (key, scope, request_hash, response_status, response_body, completed_at)
       VALUES ($1, $2, 'request-hash', 200, '{"status":"completed","anonymized":true}', now())`,
      [key, scope],
    );

    await idempotencyOnSend(
      {
        idempotency: {
          key,
          scope,
          hash: "request-hash",
          replayed: false,
        },
      } as never,
      { statusCode: 202 } as never,
      { status: "pending_exit", pendingExit: true, accessRevoked: true },
    );

    const finalized = await pool.query(
      `SELECT response_status, response_body
         FROM idempotency_keys WHERE key = $1 AND scope = $2`,
      [key, scope],
    );
    expect(finalized.rows).toEqual([
      { response_status: 200, response_body: { status: "completed", anonymized: true } },
    ]);
  });
});
