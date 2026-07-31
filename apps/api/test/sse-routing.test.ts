import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { describe, expect, it } from "vitest";
import { publicInvalidationFor } from "../src/lib/sse.js";

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
