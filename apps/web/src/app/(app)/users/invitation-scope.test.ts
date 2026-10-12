import { describe, expect, it } from "vitest";
import { invitationScope } from "./invitation-scope";

describe("invitationScope (#929)", () => {
  it("gives invitation managers every invitation", () => {
    expect(invitationScope({ canInvite: true, canManageSponsors: false })).toBe("all");
    expect(invitationScope({ canInvite: true, canManageSponsors: true })).toBe("all");
  });

  it("limits sponsor managers to sponsor links", () => {
    expect(invitationScope({ canInvite: false, canManageSponsors: true })).toBe("sponsor");
  });

  it("denies everyone else", () => {
    expect(invitationScope({ canInvite: false, canManageSponsors: false })).toBeNull();
  });
});
