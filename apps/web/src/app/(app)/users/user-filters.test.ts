import { describe, expect, it } from "vitest";
import type { UserListItem } from "@/lib/types";
import {
  type FacetSelection,
  facetCounts,
  facetOptions,
  filterUsers,
  NO_APPLICATION,
  NO_ROLE,
} from "./user-filters";

const user = (id: number, extra: Partial<UserListItem>) =>
  ({
    id,
    emailVerified: true,
    visibleRoleName: null,
    applicationStatus: null,
    ...extra,
  }) as UserListItem;

const users = [
  user(1, { visibleRoleName: "Hacker", applicationStatus: "confirmed" }),
  user(2, { visibleRoleName: "Hacker", applicationStatus: "accepted_internal" }),
  user(3, { visibleRoleName: "Mentor", applicationStatus: "confirmed", emailVerified: false }),
  user(4, {}),
];
const none: FacetSelection = { email: [], role: [], spot: [] };

describe("users directory filters", () => {
  it("ANDs categories and ORs values within one", () => {
    const ids = (sel: typeof none) => filterUsers(users, sel).map((u) => u.id);
    expect(ids({ ...none, role: ["Hacker"], spot: ["confirmed"] })).toEqual([1]);
    expect(ids({ ...none, spot: ["confirmed", "accepted_internal"] })).toEqual([1, 2, 3]);
    expect(ids({ ...none, role: [NO_ROLE] })).toEqual([4]);
  });

  it("counts each option under the other active categories only", () => {
    const counts = facetCounts(users, { ...none, role: ["Hacker"] });
    expect(counts.spot.get("confirmed")).toBe(1);
    expect(counts.spot.get(NO_APPLICATION)).toBeUndefined();
    // The role facet ignores its own selection so other roles stay addable.
    expect(counts.role.get("Mentor")).toBe(1);
  });

  it("lists present statuses in workflow order and Unassigned last", () => {
    expect(facetOptions(users, "spot", ["expired"])).toEqual([
      NO_APPLICATION,
      "accepted_internal",
      "confirmed",
      "expired",
    ]);
    expect(facetOptions(users, "role", [])).toEqual(["Hacker", "Mentor", NO_ROLE]);
  });
});
