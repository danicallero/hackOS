import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { invalidateSharedCache, sharedCache } from "../src/lib/shared-cache.js";
import { broadcast } from "../src/lib/sse.js";

afterAll(async () => {
  const { stopQueues } = await import("../src/lib/queues.js");
  const { closeValkey } = await import("../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

describe("sharedCache (H18, H47, H45)", () => {
  it("computes once for concurrent callers and serves later ones from the cache", async () => {
    const namespace = `test-${Date.now()}`;
    let computed = 0;
    const compute = async () => {
      computed++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { value: computed };
    };
    const results = await Promise.all(
      Array.from({ length: 20 }, () => sharedCache(namespace, "k", 30, compute)),
    );
    expect(computed).toBe(1);
    expect(new Set(results.map((result) => result.value))).toEqual(new Set([1]));
    expect(await sharedCache(namespace, "k", 30, compute)).toEqual({ value: 1 });
    expect(computed).toBe(1);
  });

  it("recomputes after the namespace is invalidated", async () => {
    const namespace = `test-${Date.now()}-inv`;
    let computed = 0;
    const compute = async () => ({ value: ++computed });
    await sharedCache(namespace, "k", 30, compute);
    await invalidateSharedCache(namespace);
    expect(await sharedCache(namespace, "k", 30, compute)).toEqual({ value: 2 });
  });

  it.each([
    [SSE_TOPICS.CONTENT, "content"],
    [SSE_TOPICS.SPONSORS, "public-content"],
    [SSE_TOPICS.PUBLIC_CONTENT, "public-content"],
    [SSE_TOPICS.QUEUE, "tv"],
    [SSE_TOPICS.PROJECTS, "gallery"],
  ])("a %s broadcast invalidates the %s cache", async (topic, namespace) => {
    let computed = 0;
    const compute = async () => ({ value: ++computed });
    await sharedCache(namespace, `broadcast-${topic}`, 30, compute);
    await broadcast(
      topic,
      topic === SSE_TOPICS.PUBLIC_CONTENT ? EVENTS.DATA_CHANGED : EVENTS.DOMAIN_CHANGED,
      {},
    );
    const next = await sharedCache(namespace, `broadcast-${topic}`, 30, compute);
    expect(next.value).toBe(computed);
    expect(computed).toBeGreaterThan(1);
  });
});
