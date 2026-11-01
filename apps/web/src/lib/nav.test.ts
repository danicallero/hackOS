import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import { beforeEach, describe, expect, it } from "vitest";
import { LANGS, translateMessage } from "./i18n";
import {
  isNavItemVisible,
  type NavVisibilityContext,
  PERSONAL_NAV,
  readLastWorkspace,
  visibleNavGroups,
  visibleSubDestinations,
  WORKSPACES,
  workspaceForPath,
  writeLastWorkspace,
} from "./nav";

/** Mirrors the server-side `*` admin wildcard (apps/api/src/lib/capabilities.ts). */
function contextFor(
  capabilities: Capability[],
  associations: {
    isEnterpriseJudge?: boolean;
    isSponsorRep?: boolean;
    isPureApplicant?: boolean;
    hasProject?: boolean;
    hasQueueItems?: boolean;
  } = {},
): NavVisibilityContext {
  const caps = new Set<string>(capabilities);
  const can = (capability: Capability) => caps.has(CAPABILITIES.ADMIN_ALL) || caps.has(capability);
  return {
    can,
    canAny: (...cs: Capability[]) => cs.some(can),
    isEnterpriseJudge: associations.isEnterpriseJudge ?? false,
    isSponsorRep: associations.isSponsorRep ?? false,
    isPureApplicant: associations.isPureApplicant ?? false,
    hasProject: associations.hasProject ?? true,
    hasQueueItems: associations.hasQueueItems ?? true,
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

describe("dynamic statistics visibility", () => {
  it("shows Stats to a reader with a published panel and no global capability", () => {
    const ctx = contextFor([], {});
    expect(
      isNavItemVisible(
        WORKSPACES.flatMap((w) => w.items).find((item) => item.href === "/logistics/stats")!,
        { ...ctx, hasStatisticsPanels: true },
      ),
    ).toBe(true);
  });

  it("keeps Stats hidden when no panel is published", () => {
    const ctx = contextFor([], {});
    expect(
      isNavItemVisible(
        WORKSPACES.flatMap((w) => w.items).find((item) => item.href === "/logistics/stats")!,
        { ...ctx, hasStatisticsPanels: false },
      ),
    ).toBe(false);
  });
});

describe("accounts without current role-derived event access", () => {
  const ctx = contextFor([], { isPureApplicant: true });

  it("hides the diary and keeps inbox inside Home", () => {
    const hidden = ["/people", "/inbox"];
    const visible = PERSONAL_NAV.filter((item) => isNavItemVisible(item, ctx)).map(
      (item) => item.href,
    );
    for (const href of hidden) expect(visible).not.toContain(href);
  });

  it("keeps Home, applications, Projects and profile", () => {
    const visible = PERSONAL_NAV.filter((item) => isNavItemVisible(item, ctx)).map(
      (item) => item.href,
    );
    expect(visible).toEqual(["/event", "/my-applications", "/my-project", "/settings/profile"]);
  });

  it("a room judge or sponsor rep still keeps operational workspaces, but not event-only personal nav", () => {
    const judge = contextFor([], { isEnterpriseJudge: true, isPureApplicant: true });
    const sponsor = contextFor([], { isSponsorRep: true, isPureApplicant: true });
    for (const ctx of [judge, sponsor]) {
      const visible = PERSONAL_NAV.filter((item) => isNavItemVisible(item, ctx)).map(
        (item) => item.href,
      );
      expect(visible).toEqual(["/event", "/my-applications", "/my-project", "/settings/profile"]);
    }
    expect(visibleWorkspaceIds(judge)).toContain("liveJudging");
    expect(visibleWorkspaceIds(sponsor)).toContain("sponsors");
  });
});

describe("event diary (#934, #935)", () => {
  const hrefs = (ctx: NavVisibilityContext) =>
    PERSONAL_NAV.filter((item) => isNavItemVisible(item, ctx)).map((item) => item.href);

  it("shows the diary to every attendee, with no capability", () => {
    expect(hrefs(contextFor([]))).toContain("/people");
  });

  it("hides the diary without current event access", () => {
    const ctx = contextFor([], { isPureApplicant: true });
    expect(hrefs(ctx)).not.toContain("/people");
  });
});

describe("personal projects (issue #424, #852)", () => {
  it("keeps My projects visible before either a project or queue exists", () => {
    const participant = contextFor([], { hasProject: false, hasQueueItems: false });
    const sponsor = contextFor([], {
      isSponsorRep: true,
      hasProject: false,
      hasQueueItems: false,
    });
    for (const ctx of [participant, sponsor]) {
      const visible = PERSONAL_NAV.filter((item) => isNavItemVisible(item, ctx)).map(
        (item) => item.href,
      );
      // #852 planning happens before a project exists, so its shared entry
      // must remain reachable for every admitted participant.
      expect(visible).toContain("/my-project");
      expect(visible).not.toContain("/my-queue");
    }
  });

  it("keeps My projects visible whether the caller has a project or queue data", () => {
    const onlyProject = contextFor([], { hasProject: true, hasQueueItems: false });
    const onlyQueue = contextFor([], { hasProject: false, hasQueueItems: true });
    expect(
      PERSONAL_NAV.filter((item) => isNavItemVisible(item, onlyProject)).map((i) => i.href),
    ).toEqual(expect.arrayContaining(["/my-project"]));
    expect(
      PERSONAL_NAV.filter((item) => isNavItemVisible(item, onlyQueue)).map((i) => i.href),
    ).toEqual(expect.arrayContaining(["/my-project"]));
  });
});

describe("participant + judge (H8/H55)", () => {
  const ctx = contextFor([], { isEnterpriseJudge: true });

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
  const ctx = contextFor([], { isEnterpriseJudge: true, isSponsorRep: true });

  it("sees the union of the sponsor and judging workspaces, not just one", () => {
    const ids = visibleWorkspaceIds(ctx);
    expect(ids).toEqual(expect.arrayContaining(["sponsors", "liveJudging", "projects"]));
  });

  it("does not gain rooms via the sponsor association alone (queue:admin only)", () => {
    expect(visibleHrefs(ctx)).not.toContain("/queue/rooms");
  });

  it("gains judging via the room-judge association even without judge:panel", () => {
    expect(visibleHrefs(ctx)).toContain("/judging");
  });
});

describe("sponsor queue management (H46/H55)", () => {
  it("shows queue operations to a sponsor representative without staff capabilities", () => {
    expect(visibleHrefs(contextFor([], { isSponsorRep: true }))).toContain("/queue");
  });

  it("shows queue operations to an org-wide sponsor manager", () => {
    expect(visibleHrefs(contextFor([CAPABILITIES.SPONSORS_MANAGE]))).toContain("/queue");
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
  it("does not expose Manage schedule to an unrelated capability holder", () => {
    const ctx = contextFor([CAPABILITIES.APPLICATIONS_DECIDE]);
    expect(visibleWorkspaceIds(ctx)).toEqual(["applications"]);
    expect(visibleHrefs(ctx)).toEqual(["/applications"]);
  });

  it("does not expose Manage schedule to a logistics scanner", () => {
    const ctx = contextFor([CAPABILITIES.ACCREDIT_SCAN]);
    expect(visibleWorkspaceIds(ctx)).toEqual(["logistics"]);
    expect(visibleHrefs(ctx)).toEqual(["/logistics/presence"]);
  });

  it("exposes Manage schedule only with schedule-management capability", () => {
    const ctx = contextFor([CAPABILITIES.SCHEDULE_MANAGE]);
    expect(visibleWorkspaceIds(ctx)).toEqual(["programme"]);
    expect(visibleHrefs(ctx)).toEqual(["/schedule"]);
  });

  it("exposes the schedule to a read-only holder", () => {
    const ctx = contextFor([CAPABILITIES.SCHEDULE_READ]);
    expect(visibleWorkspaceIds(ctx)).toEqual(["programme"]);
    expect(visibleHrefs(ctx)).toEqual(["/schedule"]);
  });

  it("keeps announcement management in Programme without adding Manage schedule", () => {
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
    const hrefs = [...PERSONAL_NAV, ...WORKSPACES.flatMap((w) => w.items)].flatMap((i) => [
      i.href,
      ...(i.activePaths ?? []),
    ]);
    const legacyHrefs = [
      "/timetable",
      "/my-applications",
      "/my-project",
      "/inbox",
      "/settings/profile",
      "/applications",
      "/projects",
      "/queue",
      "/judging",
      // /my-queue, /wallet, /logistics/accreditation and /logistics/meals are deliberately
      // gone from here: their content was merged into a single destination and the old hrefs now
      // redirect server-side (see their page.tsx files) instead of being
      // live nav items — deep links still resolve, just not via nav.
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
    expect(workspaceForPath("/projects/123")?.id).toBe("projects");
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
    ["participant + judge", contextFor([], { isEnterpriseJudge: true })],
    ["sponsor + judge", contextFor([], { isEnterpriseJudge: true, isSponsorRep: true })],
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

// H18: subpages retain their stable URLs without adding sidebar entries.
describe("grouped personal destinations", () => {
  it("keeps gallery inside Projects and inbox/event inside Home", () => {
    expect(PERSONAL_NAV.find((item) => item.href === "/my-project")?.activePaths).toContain(
      "/gallery",
    );
    expect(PERSONAL_NAV.find((item) => item.href === "/event")?.activePaths).toEqual([
      "/timetable",
      "/inbox",
      "/challenge",
    ]);
    expect(
      PERSONAL_NAV.some((item) => ["/gallery", "/inbox", "/timetable"].includes(item.href)),
    ).toBe(false);
  });
});

describe("visibleNavGroups (quick search, #1182)", () => {
  const groupsFor = (ctx: NavVisibilityContext) =>
    visibleNavGroups((item) => isNavItemVisible(item, ctx)).map((group) => ({
      id: group.id,
      hrefs: group.items.map((item) => item.href),
    }));

  it("lists only the personal area for an account without work capabilities", () => {
    const groups = groupsFor(contextFor([]));
    expect(groups.map((group) => group.id)).toEqual(["personal"]);
    expect(groups[0].hrefs).toContain("/event");
  });

  it("adds exactly the workspaces and items the capabilities grant", () => {
    const groups = groupsFor(contextFor([CAPABILITIES.USERS_READ]));
    expect(groups.map((group) => group.id)).toEqual(["personal", "accessAudit"]);
    expect(groups[1].hrefs).toEqual(["/users"]);
  });

  it("matches the sidebar's workspace set for an administrator", () => {
    const ctx = contextFor([CAPABILITIES.ADMIN_ALL]);
    const ids = groupsFor(ctx).map((group) => group.id);
    expect(ids).toEqual(["personal", ...visibleWorkspaceIds(ctx)]);
  });
});

describe("quick search sub-destinations (#1182)", () => {
  const hrefsFor = (ctx: NavVisibilityContext) =>
    visibleSubDestinations((item) => isNavItemVisible(item, ctx)).map((entry) => entry.item.href);

  it("lists only the event settings sections the caller can manage", () => {
    const hrefs = hrefsFor(contextFor([CAPABILITIES.WALLET_MANAGE]));
    expect(hrefs).toContain("/settings/event?tab=wallet");
    expect(hrefs).not.toContain("/settings/event?tab=venue");
    expect(hrefs).not.toContain("/settings/event?tab=danger");
  });

  it("lists only profile views for a caller without capabilities", () => {
    const hrefs = hrefsFor(contextFor([]));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((href) => href.startsWith("/settings/profile?tab="))).toBe(true);
  });

  it("points every view at its destination with a tab", () => {
    for (const item of WORKSPACES.flatMap((w) => w.items)) {
      for (const subItem of item.subItems ?? []) {
        expect(subItem.href.startsWith(`${item.href}?tab=`)).toBe(true);
      }
    }
  });
});
