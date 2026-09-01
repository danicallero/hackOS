import { roleDisplayName, roleFilterOptionsFromRoster } from "./role-filters";
import { SCANNER_GROUP_OPTIONS } from "./scanner-group-filter";

const t = (key: string) => `t:${key}`;

describe("roleFilterOptionsFromRoster", () => {
  it("derives one row per distinct role present on the roster, sorted by label", () => {
    const options = roleFilterOptionsFromRoster(
      [
        { role: "Day Staff" },
        { role: "Event Director" },
        { role: "Day Staff" },
        { role: "Participant" },
      ],
      (role) => roleDisplayName(role, t),
    );
    expect(options.map((option) => option.value).sort()).toEqual(
      ["Day Staff", "Event Director", "Participant"].sort(),
    );
    expect(new Set(options.map((option) => option.value)).size).toBe(options.length);
  });

  it("omits people with no visible role from the filter list", () => {
    const options = roleFilterOptionsFromRoster([{ role: null }], (role) =>
      roleDisplayName(role, t),
    );
    expect(options).toEqual([]);
  });

  it("shows an arbitrary custom role name verbatim (H8: no more fixed category enum)", () => {
    const options = roleFilterOptionsFromRoster([{ role: "Event Director" }], (role) =>
      roleDisplayName(role, t),
    );
    expect(options).toEqual([
      { value: "Event Director", label: "Event Director", icon: "checkmark.seal" },
    ]);
  });

  it("gives the well-known seeded role names their cosmetic icon", () => {
    const options = roleFilterOptionsFromRoster([{ role: "Sponsor" }], (role) =>
      roleDisplayName(role, t),
    );
    expect(options).toEqual([{ value: "Sponsor", label: "Sponsor", icon: "briefcase" }]);
  });
});

describe("roleDisplayName", () => {
  it("shows a real role name verbatim, untranslated (H8: no more fixed category enum)", () => {
    expect(roleDisplayName("Day Staff", t)).toBe("Day Staff");
    expect(roleDisplayName("Event Director", t)).toBe("Event Director");
  });

  it("falls back to the translated Unassigned label when there is no visible role", () => {
    expect(roleDisplayName(null, t)).toBe("t:roleUnassigned");
  });
});

describe("SCANNER_GROUP_OPTIONS", () => {
  it("only ever contains the scanner's four operational groups (never admin or judge)", () => {
    const values = SCANNER_GROUP_OPTIONS.map((option) => option.value);
    expect(values.sort()).toEqual(["mentor", "participant", "sponsor", "staff"]);
    expect(values).not.toContain("admin");
    expect(values).not.toContain("judge");
  });
});
