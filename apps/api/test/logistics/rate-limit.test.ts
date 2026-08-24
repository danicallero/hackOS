import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { asUser, buildTestApp, createUser, truncateAll } from "../helpers.js";

/**
 * H538: operational rate limits on scanner mutations, keyed per authenticated
 * staff user (not IP — see docs/rate-limiting.md) and backed by Valkey so
 * they're shared across API replicas. The limiter runs as the FIRST
 * preHandler on every guarded route (before the capability check), so these
 * tests don't need real capabilities or valid fixtures — only that the
 * request is authenticated is required to key the bucket.
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

describe("H538 operational rate limits", () => {
  it("caps the shared 'scan' bucket (check-in/check-in-user/rotate/remove/presence-scan) at 120/min per staff user", async () => {
    const staff = await createUser();

    let last: Awaited<ReturnType<typeof app.inject>> | undefined;
    for (let i = 0; i < 121; i += 1) {
      last = await app.inject({
        method: "POST",
        url: "/api/presence/scan",
        headers: asUser(staff),
        payload: { badgeId: `nonexistent-${i}`, kind: "in" },
      });
    }
    expect(last?.statusCode).toBe(429);
    expect(Number(last?.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("doesn't cross-throttle two different staff users", async () => {
    const staffA = await createUser();
    const staffB = await createUser();

    for (let i = 0; i < 120; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/api/presence/scan",
        headers: asUser(staffA),
        payload: { badgeId: `nonexistent-${i}`, kind: "in" },
      });
      expect(res.statusCode).not.toBe(429);
    }
    // staffA is now at its limit; a different staff user is untouched.
    const stillOk = await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(staffB),
      payload: { badgeId: "nonexistent", kind: "in" },
    });
    expect(stillOk.statusCode).not.toBe(429);
  });

  it("caps the 'meal-batch' bucket at 60/min per staff user, by request not scan count", async () => {
    const staff = await createUser();

    let last: Awaited<ReturnType<typeof app.inject>> | undefined;
    for (let i = 0; i < 61; i += 1) {
      last = await app.inject({
        method: "POST",
        url: "/api/activities/1/meal-scans/batch",
        headers: asUser(staff),
        payload: {
          deviceId: "device-1",
          scans: [{ clientScanId: `c-${i}`, badgeId: "nonexistent" }],
        },
      });
    }
    expect(last?.statusCode).toBe(429);
    expect(Number(last?.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("caps the 'snapshot' bucket at 20/min per staff user", async () => {
    const staff = await createUser();

    let last: Awaited<ReturnType<typeof app.inject>> | undefined;
    for (let i = 0; i < 21; i += 1) {
      last = await app.inject({
        method: "GET",
        url: "/api/scanner/snapshot",
        headers: asUser(staff),
      });
    }
    expect(last?.statusCode).toBe(429);
    expect(Number(last?.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("fails open when Valkey is unreachable, and counts the degraded-store metric", async () => {
    const staff = await createUser();
    const { valkey } = await import("../../src/lib/valkey.js");
    const { register } = await import("../../src/lib/metrics.js");

    const before = (
      await register.getSingleMetricAsString("hackos_rate_limit_store_errors_total")
    ).match(/bucket="scan"} (\d+)/)?.[1];

    const original = valkey.incr.bind(valkey);
    // biome-ignore lint/suspicious/noExplicitAny: monkey-patching a client method for one test
    (valkey as any).incr = async () => {
      throw new Error("simulated Valkey outage");
    };
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/presence/scan",
        headers: asUser(staff),
        payload: { badgeId: "nonexistent", kind: "in" },
      });
      expect(res.statusCode).not.toBe(429);
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: restoring the monkey-patch above
      (valkey as any).incr = original;
    }

    const after = (
      await register.getSingleMetricAsString("hackos_rate_limit_store_errors_total")
    ).match(/bucket="scan"} (\d+)/)?.[1];
    expect(Number(after ?? 0)).toBeGreaterThan(Number(before ?? 0));
  });
});
