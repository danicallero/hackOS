import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../src/app.js";
import {
  asUser,
  authorizationContextFor,
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

  it("readyz reports Valkey degradation without rejecting the API replica", async () => {
    app = await buildTestApp();
    const { valkey } = await import("../src/lib/valkey.js");
    vi.spyOn(valkey, "ping").mockRejectedValueOnce(new Error("valkey unavailable"));

    const res = await app.inject({ method: "GET", url: "/readyz" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "degraded", postgres: "ok", valkey: "down" });
  });

  it("metrics serves the Prometheus registry, unauthenticated (#540)", async () => {
    app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/plain/);
    expect(res.body).toContain("hackos_db_pool_total");
    expect(res.body).toContain("hackos_sse_local_connections");
  });

  it("serves Swagger docs for the API", async () => {
    app = await buildTestApp();

    const json = await app.inject({ method: "GET", url: "/documentation/json" });
    expect(json.statusCode).toBe(200);
    const spec = json.json() as {
      openapi: string;
      info: { title: string };
      components: {
        securitySchemes: {
          sessionToken: { type: string };
          bearerToken: { type: string };
        };
      };
      paths: Record<
        string,
        Record<string, { tags?: string[]; security?: Record<string, string[]>[] }>
      >;
    };
    const operationAt = (path: string, method: string) => {
      const operation = spec.paths[path]?.[method];
      expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
      return operation as { tags?: string[]; security?: Record<string, string[]>[] };
    };
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toBe("hackOS API");
    expect(spec.components.securitySchemes.sessionToken.type).toBe("apiKey");
    expect(spec.components.securitySchemes.bearerToken.type).toBe("http");
    expect(operationAt("/api/me", "get").tags).toEqual(["identity"]);
    const catchAllOperations = Object.entries(spec.paths).flatMap(([path, methods]) =>
      Object.entries(methods)
        .filter(([method]) =>
          ["get", "post", "put", "patch", "delete", "options", "head"].includes(method),
        )
        .filter(([, operation]) => operation.tags?.includes("api"))
        .map(([method]) => `${method.toUpperCase()} ${path}`),
    );
    expect(catchAllOperations).toEqual([]);
    const untaggedOperations = Object.entries(spec.paths).flatMap(([path, methods]) =>
      Object.entries(methods)
        .filter(([method]) =>
          ["get", "post", "put", "patch", "delete", "options", "head"].includes(method),
        )
        .filter(([, operation]) => !operation.tags?.length)
        .map(([method]) => `${method.toUpperCase()} ${path}`),
    );
    expect(untaggedOperations).toEqual([]);
    expect(operationAt("/api/projects/reconciliation", "get").tags).toEqual(["projects"]);
    expect(operationAt("/api/challenges", "get").tags).toEqual(["challenges"]);
    expect(operationAt("/api/realtime/stream", "get").tags).toEqual(["foundation"]);
    expect(operationAt("/api/presence/lookup", "post").tags).toEqual(["logistics"]);
    expect(operationAt("/api/statistics/query", "post").tags).toEqual(["statistics"]);
    expect(operationAt("/api/exports/applications.csv", "get").tags).toEqual(["exports"]);
    expect(operationAt("/api/me", "get").security).toEqual([
      { sessionToken: [] },
      { bearerToken: [] },
    ]);
    expect(operationAt("/api/auth/sign-up/email", "post").tags).toEqual(["auth"]);
    expect(operationAt("/api/auth/sign-in/email", "post").tags).toEqual(["auth"]);
    expect(operationAt("/api/auth/get-session", "get").tags).toEqual(["auth"]);
    expect(spec.paths["/api/auth/{*}"]).toBeUndefined();
    expect(operationAt("/healthz", "get").security).toEqual([]);
    expect(operationAt("/readyz", "get").security).toEqual([]);
    expect(operationAt("/api/tv/stream", "get").security).toEqual([]);
    expect(operationAt("/api/queue/stream", "get").security).toEqual([
      { sessionToken: [] },
      { bearerToken: [] },
    ]);
    expect(operationAt("/api/events/stream", "get").security).toEqual([
      { sessionToken: [] },
      { bearerToken: [] },
    ]);

    const ui = await app.inject({ method: "GET", url: "/documentation/" });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers["content-type"]).toContain("text/html");
  });

  it("resolves capabilities through the user's assigned-role chain (H8)", async () => {
    const { createRole, assignRole } = await import("./helpers.js");
    const { getEffectiveCapabilities, userHasCapability } = await import(
      "../src/lib/capabilities.js"
    );

    const userId = await createUser();
    // One assigned role leaves accredit:scan at the implicit INHERIT
    // default; the other ALLOWs it — resolution must fall through to it
    // regardless of relative position (no DENY exists to short-circuit).
    const inheriting = await createRole([]);
    const granting = await createRole([CAPABILITIES.ACCREDIT_SCAN]);
    await assignRole(userId, inheriting);
    await assignRole(userId, granting);

    const context = await authorizationContextFor(userId);
    const caps = await getEffectiveCapabilities(context);
    expect(caps.has(CAPABILITIES.ACCREDIT_SCAN)).toBe(true);
    expect(await userHasCapability(context, CAPABILITIES.QUEUE_OPERATE)).toBe(false);
  });

  it("wildcard * grants every capability check (admin)", async () => {
    const { userHasCapability } = await import("../src/lib/capabilities.js");
    const adminId = await createUserWithCapabilities(["*"]);
    const context = await authorizationContextFor(adminId);
    expect(await userHasCapability(context, CAPABILITIES.QUEUE_ADMIN)).toBe(true);
    expect(await userHasCapability(context, CAPABILITIES.AUDIT_READ)).toBe(true);
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

    // #994: a replay inside the retention window (6 days) survives the purge
    // and still returns the stored response; past 8 days it re-executes.
    const { pool } = await import("../src/db/pool.js");
    const { purgeExpiredIdempotencyKeys } = await import("../src/lib/idempotency.js");
    const send = () =>
      app.inject({
        method: "POST",
        url: "/scan",
        headers: { "idempotency-key": key },
        payload: { badge: "B1" },
      });
    await pool.query(`UPDATE idempotency_keys SET created_at = now() - interval '6 days'`);
    await purgeExpiredIdempotencyKeys();
    const inWindow = await send();
    expect(inWindow.headers["idempotency-replayed"]).toBe("true");
    expect(inWindow.json()).toEqual({ execution: 1, got: "B1" });
    await pool.query(`UPDATE idempotency_keys SET created_at = now() - interval '8 days'`);
    await purgeExpiredIdempotencyKeys();
    expect((await send()).json()).toEqual({ execution: 2, got: "B1" });
  });

  it("SSE broadcast fans out through valkey to a subscribed envelope", async () => {
    const { broadcast } = await import("../src/lib/sse.js");
    const envelope = await broadcast("queue", "queue.entry.status_changed", { entryId: 7 });
    expect(envelope).not.toBeNull();
    expect(envelope?.type).toBe("queue.entry.status_changed");
    expect(Number(envelope?.id)).toBeGreaterThan(0);
    expect(envelope?.data).toEqual({ entryId: 7 });
  });
});

describe("idempotency_keys retention (#994)", () => {
  it("purges only expired rows and replays inside the window", async () => {
    const { pool } = await import("../src/db/pool.js");
    const { purgeExpiredIdempotencyKeys } = await import("../src/lib/idempotency.js");
    const row = (k: string, status: number | null, age: string) =>
      pool.query(
        `INSERT INTO idempotency_keys (key, scope, request_hash, response_status, response_body, created_at)
         VALUES ($1, 's', 'h', $2, '{"ok":true}', now() - $3::interval)`,
        [k, status, age],
      );
    await row("old-done", 200, "8 days");
    await row("new-done", 200, "6 days");
    await row("old-inflight", null, "2 days");
    await row("new-inflight", null, "1 minute");

    expect(await purgeExpiredIdempotencyKeys()).toBe(2);
    const { rows } = await pool.query(`SELECT key FROM idempotency_keys ORDER BY key`);
    expect(rows.map((r) => r.key)).toEqual(["new-done", "new-inflight"]);
  });
});
