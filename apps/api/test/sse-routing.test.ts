import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { afterAll, describe, expect, it, vi } from "vitest";
import { broadcast, publicInvalidationFor } from "../src/lib/sse.js";
import { mutationDomainForPath, publicContentMutationForPath } from "../src/lib/sse-routing.js";
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

  it("maps content changes only to public-content", () => {
    expect(publicInvalidationFor(SSE_TOPICS.CONTENT)).toEqual({
      topic: SSE_TOPICS.PUBLIC_CONTENT,
      type: EVENTS.DATA_CHANGED,
      data: {},
    });
    for (const source of [
      SSE_TOPICS.LOGISTICS,
      SSE_TOPICS.EXPORTS,
      SSE_TOPICS.APPLICATIONS,
      SSE_TOPICS.PROJECTS,
      SSE_TOPICS.IDENTITY,
      SSE_TOPICS.SPONSORS,
      SSE_TOPICS.AUDIT,
      SSE_TOPICS.PUBLIC_TV,
      SSE_TOPICS.PUBLIC_CONTENT,
    ]) {
      expect(publicInvalidationFor(source)).toBeNull();
    }
  });
});

describe("domain mutation routing", () => {
  it("keeps application and project changes on separate refresh topics", () => {
    expect(mutationDomainForPath("/api/applications/12?tab=responses")).toBe(
      SSE_TOPICS.APPLICATIONS,
    );
    expect(mutationDomainForPath("/api/responses/batch/decide")).toBe(SSE_TOPICS.APPLICATIONS);
    expect(mutationDomainForPath("/api/projects/4")).toBe(SSE_TOPICS.PROJECTS);
    expect(mutationDomainForPath("/api/me/projects/4/invites")).toBe(SSE_TOPICS.PROJECTS);
    expect(mutationDomainForPath("/api/challenges/3/repos/bulk-add")).toBe(SSE_TOPICS.PROJECTS);
  });

  it("routes identity, sponsor and catalogue writes without treating reads as mutations", () => {
    expect(mutationDomainForPath("/api/permission-groups/2/members")).toBe(SSE_TOPICS.IDENTITY);
    expect(mutationDomainForPath("/api/enterprises/4/judges/9")).toBe(SSE_TOPICS.SPONSORS);
    expect(mutationDomainForPath("/api/invites/enterprise-links/4/withdraw")).toBe(
      SSE_TOPICS.SPONSORS,
    );
    expect(mutationDomainForPath("/api/challenges/3/publish")).toBe(SSE_TOPICS.SPONSORS);
    expect(mutationDomainForPath("/api/food-intolerances/2")).toBe(SSE_TOPICS.LOGISTICS);
    expect(mutationDomainForPath("/api/applications")).toBe(SSE_TOPICS.APPLICATIONS);
    expect(mutationDomainForPath("/api/applicationship/2")).toBeNull();
    expect(mutationDomainForPath("/api/unknown/write")).toBeNull();
  });

  it("keeps public-content mirrors narrower than the authenticated sponsor domain", () => {
    expect(publicContentMutationForPath("/api/enterprises/4")).toBe(true);
    expect(publicContentMutationForPath("/api/enterprises/visibility")).toBe(true);
    expect(publicContentMutationForPath("/api/enterprises/4/logo")).toBe(true);
    expect(publicContentMutationForPath("/api/enterprises/4/judges/9")).toBe(false);
    expect(publicContentMutationForPath("/api/invites/enterprise-links/4/withdraw")).toBe(false);
    expect(publicContentMutationForPath("/api/challenges/3/publish")).toBe(true);
    expect(publicContentMutationForPath("/api/challenges/3/winners/1")).toBe(false);
    expect(publicContentMutationForPath("/api/event")).toBe(false);
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
