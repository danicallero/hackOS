import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import { beforeEach, describe, expect, it } from "vitest";
import { LANGS, translateMessage } from "./i18n";
import {
  isNavItemVisible,
  type NavVisibilityContext,
  PERSONAL_NAV,
  readLastWorkspace,
  WORKSPACES,
  workspaceForPath,
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

function visibleDestinationLabels(ctx: NavVisibilityContext, language: (typeof LANGS)[number]) {
  return [...PERSONAL_NAV, ...WORKSPACES.flatMap((workspace) => workspace.items)]
    .filter((item) => isNavItemVisible(item, ctx))
    .map((item) => translateMessage(language, item.title));
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
  it("gives a decision-only account the Applications workspace without builder or reviewer capability", () => {
    const ctx = contextFor([CAPABILITIES.APPLICATIONS_DECIDE]);
    expect(visibleWorkspaceIds(ctx)).toEqual(["applications"]);
    expect(visibleHrefs(ctx)).toEqual(["/applications"]);
  });

  it("a bare accreditation scanner only sees Logistics", () => {
    const ctx = contextFor([CAPABILITIES.ACCREDIT_SCAN]);
    expect(visibleWorkspaceIds(ctx)).toEqual(["logistics"]);
    expect(visibleHrefs(ctx)).toEqual(["/logistics/accreditation"]);
  });

  it("puts announcement management in Programme, alongside schedule and TV control", () => {
    const ctx = contextFor([CAPABILITIES.ANNOUNCEMENTS_MANAGE]);
    expect(visibleWorkspaceIds(ctx)).toEqual(["programme"]);
    expect(visibleHrefs(ctx)).toEqual(["/announcements"]);
    expect(WORKSPACES.some((workspace) => workspace.id === "communications")).toBe(false);
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

describe("workspace resolution for the top bar (issue #297)", () => {
  it("resolves a workspace route to its workspace", () => {
    expect(workspaceForPath("/queue/rooms")?.id).toBe("liveJudging");
    expect(workspaceForPath("/logistics/presence")?.id).toBe("logistics");
  });

  it("resolves a child route to the workspace of its longest matching parent", () => {
    expect(workspaceForPath("/projects/import")?.id).toBe("projects");
    expect(workspaceForPath("/challenges/12")?.id).toBe("sponsors");
  });

  it("resolves personal-area routes to no workspace, so the top bar stays empty", () => {
    for (const item of PERSONAL_NAV) {
      expect(workspaceForPath(item.href)).toBeNull();
    }
  });

  it("resolves an unknown route to no workspace", () => {
    expect(workspaceForPath("/nowhere")).toBeNull();
  });
});

describe("one name per destination (issue #297)", () => {
  it("gives every sidebar destination a distinct label key", () => {
    const keys = [...PERSONAL_NAV, ...WORKSPACES.flatMap((w) => w.items)].map((i) => i.title);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never labels a multi-destination workspace with one of its own destinations", () => {
    for (const workspace of WORKSPACES.filter((w) => w.items.length > 1)) {
      expect(workspace.items.map((i) => i.title)).not.toContain(workspace.label);
    }
  });
});

describe("cross-capability navigation in every locale (issue #303)", () => {
  const accounts = [
    ["participant + judge", contextFor([], { isRoomJudge: true })],
    ["sponsor + judge", contextFor([], { isRoomJudge: true, isSponsorRep: true })],
    ["admin", contextFor([CAPABILITIES.ADMIN_ALL])],
  ] as const;
  const checks: Array<[string, NavVisibilityContext, (typeof LANGS)[number]]> = accounts.flatMap(
    ([account, context]) =>
      LANGS.map((language): [string, NavVisibilityContext, (typeof LANGS)[number]] => [
        account,
        context,
        language,
      ]),
  );

  it.each(checks)("shows %s every destination once in %s", (_account, context, language) => {
    const labels = visibleDestinationLabels(context, language);

    expect(labels).not.toContain("");
    expect(new Set(labels).size).toBe(labels.length);
  });
});
