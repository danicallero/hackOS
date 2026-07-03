import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "./helpers.js";

/**
 * Phase 0 smoke suite: infra reachable, schema applied, and the three core
 * contracts (capabilities H8, audit H53, idempotency) actually work.
 */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../src/lib/valkey.js");
  await valkey.flushdb();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../src/lib/queues.js");
  const { closeValkey } = await import("../src/lib/valkey.js");
  const { pool } = await import("../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

describe("foundation", () => {
  it("healthz reports ok against real postgres + valkey", async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("resolves capabilities through nested groups (H8)", async () => {
    const { pool } = await import("../src/db/pool.js");
    const { getEffectiveCapabilities, userHasCapability } = await import(
      "../src/lib/capabilities.js"
    );

    const userId = await createUser();
    const parent = await pool.query(
      `INSERT INTO permission_groups (name) VALUES ('staff-day') RETURNING id`,
    );
    const child = await pool.query(
      `INSERT INTO permission_groups (name) VALUES ('scanners') RETURNING id`,
    );
    await pool.query(`INSERT INTO group_capabilities (group_id, capability) VALUES ($1, $2)`, [
      child.rows[0].id,
      CAPABILITIES.ACCREDIT_SCAN,
    ]);
    await pool.query(
      `INSERT INTO permission_group_includes (parent_group_id, child_group_id) VALUES ($1, $2)`,
      [parent.rows[0].id, child.rows[0].id],
    );
    await pool.query(`INSERT INTO permission_group_members (user_id, group_id) VALUES ($1, $2)`, [
      userId,
      parent.rows[0].id,
    ]);

    const caps = await getEffectiveCapabilities(userId);
    expect(caps.has(CAPABILITIES.ACCREDIT_SCAN)).toBe(true);
    expect(await userHasCapability(userId, CAPABILITIES.QUEUE_OPERATE)).toBe(false);
  });

  it("wildcard * grants every capability check (admin)", async () => {
    const { userHasCapability } = await import("../src/lib/capabilities.js");
    const adminId = await createUserWithCapabilities(["*"]);
    expect(await userHasCapability(adminId, CAPABILITIES.QUEUE_ADMIN)).toBe(true);
    expect(await userHasCapability(adminId, CAPABILITIES.AUDIT_READ)).toBe(true);
  });

  it("capability guard returns 401 without session, 403 without capability", async () => {
    app = await buildTestApp();
    const { requireCapability } = await import("../src/lib/capabilities.js");
    app.get("/guarded", { preHandler: requireCapability(CAPABILITIES.AUDIT_READ) }, async () => ({
      ok: true,
    }));

    const anon = await app.inject({ method: "GET", url: "/guarded" });
    expect(anon.statusCode).toBe(401);

    const plebId = await createUser();
    const forbidden = await app.inject({
      method: "GET",
      url: "/guarded",
      headers: asUser(plebId),
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe("forbidden");

    const readerId = await createUserWithCapabilities([CAPABILITIES.AUDIT_READ]);
    const ok = await app.inject({ method: "GET", url: "/guarded", headers: asUser(readerId) });
    expect(ok.statusCode).toBe(200);
  });

  it("audit() writes a queryable audit_log row (H53)", async () => {
    const { pool } = await import("../src/db/pool.js");
    const { audit } = await import("../src/lib/audit.js");
    const actorId = await createUser();

    await audit(pool, {
      actorId,
      entityType: "badge",
      entityId: 42,
      action: "rotate",
      before: { badge_id: "OLD" },
      after: { badge_id: "NEW" },
      reason: "lost badge",
      source: "admin",
    });

    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'badge' AND entity_id = '42'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("rotate");
    expect(rows[0].before).toEqual({ badge_id: "OLD" });
    expect(rows[0].actor_id).toBe(actorId);
  });

  it("idempotency: same key replays, different body conflicts", async () => {
    app = await buildTestApp();
    const { idempotencyGuard } = await import("../src/lib/idempotency.js");
    let executions = 0;
    app.post("/scan", { preHandler: idempotencyGuard }, async (req) => {
      executions += 1;
      return { execution: executions, got: (req.body as { badge: string }).badge };
    });

    const key = "scan-abc-1";
    const first = await app.inject({
      method: "POST",
      url: "/scan",
      headers: { "idempotency-key": key },
      payload: { badge: "B1" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ execution: 1, got: "B1" });

    const replay = await app.inject({
      method: "POST",
      url: "/scan",
      headers: { "idempotency-key": key },
      payload: { badge: "B1" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ execution: 1, got: "B1" });
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(executions).toBe(1);

    const mismatch = await app.inject({
      method: "POST",
      url: "/scan",
      headers: { "idempotency-key": key },
      payload: { badge: "B2" },
    });
    expect(mismatch.statusCode).toBe(409);
  });

  it("SSE broadcast fans out through valkey to a subscribed envelope", async () => {
    const { broadcast } = await import("../src/lib/sse.js");
    const envelope = await broadcast("queue", "queue.entry.status_changed", { entryId: 7 });
    expect(envelope.type).toBe("queue.entry.status_changed");
    expect(Number(envelope.id)).toBeGreaterThan(0);
    expect(envelope.data).toEqual({ entryId: 7 });
  });
});
