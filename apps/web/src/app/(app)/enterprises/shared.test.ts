import { describe, expect, it } from "vitest";
import { resolveUrlTab } from "@/lib/url-tab";
import { ENTERPRISE_TAB_ALIASES, enterpriseTabs } from "./shared";

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
