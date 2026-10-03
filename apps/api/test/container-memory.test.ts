import { describe, expect, it } from "vitest";
import { parseMemorySample, refreshServiceMemory } from "../src/lib/container-memory.js";
import { register } from "../src/lib/metrics.js";

const valid = {
  timestamp: 100,
  memory: 1024,
  limit: 2048,
  swap: 0,
  swap_limit: -1,
  reclaimable_cache: 256,
  limit_events: 0,
  oom_events: 0,
  oom_kills: 0,
};

describe("container-local memory samples (#544)", () => {
  it("accepts real measurements and unlimited swap", () => {
    expect(parseMemorySample(JSON.stringify(valid), 120)).toEqual(valid);
  });
  it("rejects stale, future, malformed and incomplete readings rather than reporting zero", () => {
    for (const value of [
      { ...valid, timestamp: 1 },
      { ...valid, timestamp: 130 },
      { ...valid, memory: -5 },
      { ...valid, swap: null },
      { ...valid, reclaimable_cache: 2048 },
      {},
    ])
      expect(() => parseMemorySample(JSON.stringify(value), 120)).toThrow();
    expect(() => parseMemorySample("invalid", 120)).toThrow();
  });
  it("marks absent shared samples unavailable without fabricated RAM", async () => {
    await refreshServiceMemory("api");
    const metrics = await register.metrics();
    expect(metrics).toContain('hackos_service_memory_sample_available{service="postgres"} 0');
    expect(metrics).not.toContain('hackos_service_memory_used_bytes{service="postgres"}');
  });
});
