import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(async () => ({ ok: true })) } }));

import { api } from "@/lib/api";
import { challengesResource, enterprisesResource, warmRoute } from "./list-resources";
import { peekServerState, resetServerStateForTests, setServerStateIdentity } from "./server-state";

const holds =
  (...caps: Capability[]) =>
  (c: Capability) =>
    caps.includes(c);

describe("navigation warm-up", () => {
  beforeEach(() => {
    resetServerStateForTests();
    setServerStateIdentity(1);
    vi.mocked(api.get).mockClear();
  });
  afterEach(resetServerStateForTests);

  it("fills the exact cache entry the destination page reads", async () => {
    warmRoute("/enterprises", holds(CAPABILITIES.SPONSORS_MANAGE));
    await vi.waitFor(() => expect(peekServerState(enterprisesResource.key)).toEqual({ ok: true }));
    expect(api.get).toHaveBeenCalledWith("/api/enterprises", expect.anything());
  });

  it("never requests a list the viewer lacks the capability for", () => {
    warmRoute("/enterprises", holds());
    warmRoute("/users", holds());
    expect(api.get).not.toHaveBeenCalled();
  });

  it("reads the sponsor's own challenges when not an admin", async () => {
    warmRoute("/challenges", holds());
    await vi.waitFor(() =>
      expect(peekServerState(challengesResource(false).key)).toEqual({ ok: true }),
    );
    expect(api.get).toHaveBeenCalledWith("/api/challenges/mine", expect.anything());
  });

  it("does not refetch a fresh entry and ignores unknown routes", async () => {
    warmRoute("/enterprises", holds(CAPABILITIES.SPONSORS_MANAGE));
    await vi.waitFor(() => expect(peekServerState(enterprisesResource.key)).toBeDefined());
    warmRoute("/enterprises", holds(CAPABILITIES.SPONSORS_MANAGE));
    warmRoute("/nowhere", holds());
    expect(api.get).toHaveBeenCalledOnce();
  });
});
