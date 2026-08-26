import { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { BULLMQ_CONNECTION_OPTS } from "../src/lib/queues.js";
import { API_VALKEY_CONNECTION_OPTS } from "../src/lib/valkey.js";

describe("Valkey connection policies (#535)", () => {
  it("keeps API commands bounded and disables the offline queue", () => {
    expect(API_VALKEY_CONNECTION_OPTS).toMatchObject({
      maxRetriesPerRequest: 1,
      commandTimeout: 1_000,
      connectTimeout: 1_000,
      enableOfflineQueue: false,
    });
  });

  it("keeps BullMQ's reliable worker retry policy isolated", () => {
    expect(BULLMQ_CONNECTION_OPTS).toEqual({ maxRetriesPerRequest: null });
  });

  it("rejects an API command promptly when Valkey is unavailable", async () => {
    const unavailable = new Redis("redis://127.0.0.1:1", {
      ...API_VALKEY_CONNECTION_OPTS,
      lazyConnect: true,
    });
    unavailable.on("error", () => undefined);
    const startedAt = Date.now();

    await expect(unavailable.get("cache:key")).rejects.toThrow();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    unavailable.disconnect();
  });
});
