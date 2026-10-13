import "./env.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Other identity suites use FLUSHDB on DB 11. Keep this primitive-only test
// isolated because local workers share one Valkey instance.
// #1035: DB 4 is unclaimed and within Valkey's default 0–15 database range.
process.env.VALKEY_URL = process.env.TEST_VALKEY_URL ?? "redis://localhost:6379/4";

let valkey: typeof import("../../src/lib/valkey.js")["valkey"];
let consumeRateLimit: typeof import("../../src/lib/rate-limit.js")["consumeRateLimit"];

beforeAll(async () => {
  ({ valkey } = await import("../../src/lib/valkey.js"));
  ({ consumeRateLimit } = await import("../../src/lib/rate-limit.js"));
});

afterAll(async () => {
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await closeValkey();
});

describe("#993 rate-limit window TTL", () => {
  it("repairs a counter without a TTL and releases it after the window", async () => {
    const bucket = `issue-993-${randomUUID()}`;
    const key = randomUUID();
    const redisKey = `ratelimit:${bucket}:${key}`;
    const rule = { windowSeconds: 2, max: 1 };

    try {
      await valkey.set(redisKey, "2");
      expect(await valkey.ttl(redisKey)).toBe(-1);

      const blocked = await consumeRateLimit(bucket, key, rule);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
      expect(await valkey.ttl(redisKey)).toBeGreaterThan(0);

      await new Promise((resolve) => setTimeout(resolve, rule.windowSeconds * 1000 + 100));
      await expect(consumeRateLimit(bucket, key, rule)).resolves.toEqual({ allowed: true });
    } finally {
      await valkey.del(redisKey);
    }
  });
});
