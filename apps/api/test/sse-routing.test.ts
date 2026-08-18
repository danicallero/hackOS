import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { afterAll, describe, expect, it, vi } from "vitest";
import { broadcast, publicInvalidationFor } from "../src/lib/sse.js";
import { valkey } from "../src/lib/valkey.js";

afterAll(async () => {
  const { closeValkey } = await import("../src/lib/valkey.js");
  await closeValkey();
});

describe("public SSE invalidation routing", () => {
  it("maps queue and TV changes only to the public-TV topic with an empty envelope", () => {
    for (const source of [SSE_TOPICS.QUEUE, SSE_TOPICS.TV]) {
      expect(publicInvalidationFor(source)).toEqual({
        topic: SSE_TOPICS.PUBLIC_TV,
        type: EVENTS.DATA_CHANGED,
        data: {},
      });
    }
  });

  it("maps content only to public-content and never mirrors public/global/unrelated domains", () => {
    expect(publicInvalidationFor(SSE_TOPICS.CONTENT)).toEqual({
      topic: SSE_TOPICS.PUBLIC_CONTENT,
      type: EVENTS.DATA_CHANGED,
      data: {},
    });
    for (const source of [
      SSE_TOPICS.LOGISTICS,
      SSE_TOPICS.EXPORTS,
      SSE_TOPICS.GLOBAL,
      SSE_TOPICS.PUBLIC_TV,
      SSE_TOPICS.PUBLIC_CONTENT,
    ]) {
      expect(publicInvalidationFor(source)).toBeNull();
    }
  });
});

describe("broadcast resilience", () => {
  // Every domain call site awaits broadcast() *after* its own transaction
  // already committed (a scan recorded, a badge assigned, …). A Valkey
  // outage must never turn that already-durable write into a failed HTTP
  // response for the caller — realtime notification is strictly best-effort.
  it("swallows a publish failure and returns null instead of throwing", async () => {
    vi.spyOn(valkey, "incr").mockRejectedValueOnce(new Error("valkey unreachable"));
    await expect(
      broadcast(SSE_TOPICS.LOGISTICS, EVENTS.LOGISTICS_ACCREDITED, { userId: 1 }),
    ).resolves.toBeNull();
  });

  it("still throws synchronously on a caller programming error (bad public payload)", async () => {
    await expect(
      broadcast(SSE_TOPICS.PUBLIC_TV, EVENTS.DATA_CHANGED, { unexpected: "payload" }),
    ).rejects.toThrow();
  });
});
