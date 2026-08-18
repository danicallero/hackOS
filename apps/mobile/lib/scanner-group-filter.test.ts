import { matchesScannerGroup } from "./scanner-group-filter";

describe("matchesScannerGroup", () => {
  it("matches everyone when no groups are selected", () => {
    expect(matchesScannerGroup("participant", [])).toBe(true);
    expect(matchesScannerGroup("unassigned", [])).toBe(true);
  });

  it("matches only the selected role for single-role groups", () => {
    expect(matchesScannerGroup("participant", ["participant"])).toBe(true);
    expect(matchesScannerGroup("mentor", ["participant"])).toBe(false);
  });

  it("matches both admins and staff for the staff group", () => {
    expect(matchesScannerGroup("admin", ["staff"])).toBe(true);
    expect(matchesScannerGroup("staff", ["staff"])).toBe(true);
    expect(matchesScannerGroup("sponsor", ["staff"])).toBe(false);
  });

  it("matches any of multiple selected groups", () => {
    expect(matchesScannerGroup("sponsor", ["participant", "sponsor"])).toBe(true);
    expect(matchesScannerGroup("mentor", ["participant", "sponsor"])).toBe(false);
  });
});
