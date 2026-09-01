import { ROLE_FILTER_ALL, ROLE_FILTER_OPTIONS, SCANNER_GROUP_FILTER_OPTIONS } from "./role-filters";
import { SCANNER_GROUP_VALUES } from "./scanner-group-filter";

describe("ROLE_FILTER_OPTIONS", () => {
  it("covers every filterable role category exactly once", () => {
    const values = ROLE_FILTER_OPTIONS.map((option) => option.value);
    expect(values).toEqual(["admin", "staff", "sponsor", "mentor", "judge", "participant"]);
    expect(new Set(values).size).toBe(values.length);
  });

  it("exposes the all-roles sentinel row separately from the category list", () => {
    expect(ROLE_FILTER_ALL).toEqual({ labelKey: "roleAll", icon: "person.2" });
    expect(ROLE_FILTER_OPTIONS.some((option) => (option.labelKey as string) === "roleAll")).toBe(
      false,
    );
  });
});

describe("SCANNER_GROUP_FILTER_OPTIONS", () => {
  it("is the general scanner's subset of the canonical role-filter list, not a second copy", () => {
    // Regression guard: this used to be an independent `GROUP_FILTERS`
    // literal in general-scanner-screen.tsx that could (and did) drift from
    // people-directory-screen.tsx's own `ROLE_FILTERS` literal. Both screens
    // now derive from `ROLE_FILTER_OPTIONS`, so every scanner row must still
    // be found there with the exact same label/icon.
    for (const option of SCANNER_GROUP_FILTER_OPTIONS) {
      expect(ROLE_FILTER_OPTIONS).toContainEqual(option);
    }
  });

  it("only ever contains the scanner's operational groups (never admin or judge)", () => {
    const values = SCANNER_GROUP_FILTER_OPTIONS.map((option) => option.value);
    expect(values.sort()).toEqual([...SCANNER_GROUP_VALUES].sort());
    expect(values).not.toContain("admin");
    expect(values).not.toContain("judge");
  });
});
