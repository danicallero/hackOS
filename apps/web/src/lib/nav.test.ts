import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import { beforeEach, describe, expect, it } from "vitest";
import {
  isNavItemVisible,
  type NavVisibilityContext,
  PERSONAL_NAV,
  readLastWorkspace,
  WORKSPACES,
  writeLastWorkspace,
} from "./nav";

/** Mirrors the server-side `*` admin wildcard (apps/api/src/lib/capabilities.ts). */
function contextFor(
  capabilities: Capability[],
  associations: { isRoomJudge?: boolean; isSponsorRep?: boolean } = {},
): NavVisibilityContext {
  const caps = new Set<string>(capabilities);
  const can = (capability: Capability) => caps.has(CAPABILITIES.ADMIN_ALL) || caps.has(capability);
  return {
    can,
    canAny: (...cs: Capability[]) => cs.some(can),
    isRoomJudge: associations.isRoomJudge ?? false,
    isSponsorRep: associations.isSponsorRep ?? false,
  };
}

function visibleWorkspaceIds(ctx: NavVisibilityContext): string[] {
  return WORKSPACES.filter((w) => w.items.some((item) => isNavItemVisible(item, ctx))).map(
    (w) => w.id,
  );
}

function visibleHrefs(ctx: NavVisibilityContext): string[] {
  return WORKSPACES.flatMap((w) => w.items)
    .filter((item) => isNavItemVisible(item, ctx))
    .map((item) => item.href);
}

describe("stable personal area (audit §3.1)", () => {
  it("is visible to every authenticated account regardless of capability", () => {
    const ctx = contextFor([]);
    for (const item of PERSONAL_NAV) {
      expect(isNavItemVisible(item, ctx)).toBe(true);
    }
  });
});

describe("participant + judge (H8/H55)", () => {
  const ctx = contextFor([], { isRoomJudge: true });

  it("keeps the personal queue and gains Live judging without any capability grant", () => {
    expect(visibleWorkspaceIds(ctx)).toEqual(expect.arrayContaining(["projects", "liveJudging"]));
  });

  it("does not unlock queue operations, which requires an actual capability, not the judge association alone", () => {
    expect(visibleHrefs(ctx)).not.toContain("/queue");
  });

  it("does not unlock unrelated workspaces (sponsors, logistics, access/audit)", () => {
    expect(visibleWorkspaceIds(ctx)).not.toEqual(
      expect.arrayContaining(["sponsors", "logistics", "accessAudit"]),
    );
  });
});

describe("sponsor representative + judge (H8/H55)", () => {
  const ctx = contextFor([], { isRoomJudge: true, isSponsorRep: true });

  it("sees the union of the sponsor and judging workspaces, not just one", () => {
    const ids = visibleWorkspaceIds(ctx);
    expect(ids).toEqual(expect.arrayContaining(["sponsors", "liveJudging", "projects"]));
  });

  it("gains rooms via the sponsor association even without queue:admin", () => {
    expect(visibleHrefs(ctx)).toContain("/queue/rooms");
  });

  it("gains judging via the room-judge association even without judge:panel", () => {
    expect(visibleHrefs(ctx)).toContain("/judging");
  });
});

describe("admin wildcard (H8)", () => {
  const ctx = contextFor([CAPABILITIES.ADMIN_ALL]);

  it("sees every workspace and every item", () => {
    expect(visibleWorkspaceIds(ctx)).toEqual(WORKSPACES.map((w) => w.id));
    for (const item of WORKSPACES.flatMap((w) => w.items)) {
      expect(isNavItemVisible(item, ctx)).toBe(true);
    }
  });
});

describe("capability-gated workspace, no association or wildcard", () => {
  it("a bare accreditation scanner only sees Logistics", () => {
    const ctx = contextFor([CAPABILITIES.ACCREDIT_SCAN]);
    expect(visibleWorkspaceIds(ctx)).toEqual(["logistics"]);
    expect(visibleHrefs(ctx)).toEqual(["/logistics/accreditation"]);
  });

  it("holds no work workspace with no capability and no association", () => {
    const ctx = contextFor([]);
    expect(visibleWorkspaceIds(ctx)).toEqual([]);
  });
});

describe("route stability (deep links, issue #187)", () => {
  it("keeps every previously published href unchanged", () => {
    const hrefs = [...PERSONAL_NAV, ...WORKSPACES.flatMap((w) => w.items)].map((i) => i.href);
    const legacyHrefs = [
      "/dashboard",
      "/timetable",
      "/my-applications",
      "/my-project",
      "/my-queue",
      "/wallet",
      "/inbox",
      "/settings/profile",
      "/applications",
      "/projects",
      "/queue",
      "/judging",
      "/queue/rooms",
      "/logistics/accreditation",
      "/logistics/meals",
      "/logistics/activities",
      "/logistics/presence",
      "/logistics/stats",
      "/schedule",
      "/tv/control",
      "/enterprises",
      "/challenges",
      "/announcements",
      "/settings/event",
      "/settings/libraries",
      "/users",
      "/permissions",
      "/audit",
    ];
    for (const legacy of legacyHrefs) {
      expect(hrefs).toContain(legacy);
    }
  });

  it("has no duplicate hrefs across the personal area and workspaces", () => {
    const hrefs = [...PERSONAL_NAV, ...WORKSPACES.flatMap((w) => w.items)].map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("last-workspace persistence per device (audit §3.3, issue #187)", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        removeItem: (key: string) => store.delete(key),
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });
  });

  it("returns null before anything was opened", () => {
    expect(readLastWorkspace()).toBeNull();
  });

  it("remembers the last workspace opened on this device", () => {
    writeLastWorkspace("sponsors");
    expect(readLastWorkspace()).toBe("sponsors");
  });

  it("overwrites the previous choice when a different workspace opens", () => {
    writeLastWorkspace("sponsors");
    writeLastWorkspace("liveJudging");
    expect(readLastWorkspace()).toBe("liveJudging");
  });
});
