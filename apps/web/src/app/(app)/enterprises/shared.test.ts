import { describe, expect, it } from "vitest";
import { resolveUrlTab } from "@/lib/url-tab";
import {
  ENTERPRISE_TAB_ALIASES,
  type Enterprise,
  enterpriseTabs,
  groupEnterprises,
} from "./shared";

describe("enterpriseTabs (#928, #929)", () => {
  it("shows every tab to managers", () => {
    expect(enterpriseTabs({ canManage: true, isSponsorRep: false })).toEqual([
      "profile",
      "challenges",
      "judges",
      "members",
      "stand",
    ]);
  });

  it("shows challenges and stand tags but not members to the enterprise's rep", () => {
    expect(enterpriseTabs({ canManage: false, isSponsorRep: true })).toEqual([
      "profile",
      "challenges",
      "judges",
      "stand",
    ]);
  });

  it("hides the challenges tab when it could only be empty", () => {
    expect(enterpriseTabs({ canManage: false, isSponsorRep: false })).toEqual([
      "profile",
      "judges",
    ]);
  });

  it("maps removed tab links to profile", () => {
    const options = {
      values: enterpriseTabs({ canManage: true, isSponsorRep: false }),
      defaultValue: "profile" as const,
      aliases: ENTERPRISE_TAB_ALIASES,
    };
    expect(resolveUrlTab("overview", options)).toBe("profile");
    expect(resolveUrlTab("invitations", options)).toBe("profile");
    expect(resolveUrlTab("members", options)).toBe("members");
  });
});

describe("groupEnterprises (H45)", () => {
  const e = (
    id: number,
    name: string,
    kind: Enterprise["kind"],
    priority: number | null,
    position: number | null = null,
  ) => ({ id, name, kind, priority, position }) as Enterprise;

  it("groups by priority only and honours manual position", () => {
    const groups = groupEnterprises([
      e(1, "Zed", "sponsor", 2),
      e(2, "Entity", "collaborator", 1),
      e(3, "Alpha", "sponsor", 2, 2),
      e(4, "Beta", "collaborator", 2, 1),
      e(5, "Main", "sponsor", 1),
      e(6, "Loose", "sponsor", null),
    ]);
    expect(groups.map((g) => [g.priority, g.items.map((i) => i.name)])).toEqual([
      [1, ["Entity", "Main"]],
      [2, ["Beta", "Alpha", "Zed"]],
      [null, ["Loose"]],
    ]);
  });
});
