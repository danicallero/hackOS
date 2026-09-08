import { isAccreditationEligible, matchesScannerGroup } from "./scanner-group-filter";

function person(role: string | null, hasCapabilities = false) {
  return { role, hasCapabilities };
}

describe("matchesScannerGroup", () => {
  it("matches everyone when no groups are selected", () => {
    expect(matchesScannerGroup(person("Participant"), [])).toBe(true);
    expect(matchesScannerGroup(person(null), [])).toBe(true);
  });

  it("matches only the selected role for single-role groups", () => {
    expect(matchesScannerGroup(person("Participant"), ["participant"])).toBe(true);
    expect(matchesScannerGroup(person("Mentor"), ["participant"])).toBe(false);
  });

  it("matches the staff group via hasCapabilities, not a role-name spelling (H8)", () => {
    expect(matchesScannerGroup(person("Event Director", true), ["staff"])).toBe(true);
    expect(matchesScannerGroup(person(null, true), ["staff"])).toBe(true);
    expect(matchesScannerGroup(person("Sponsor", false), ["staff"])).toBe(false);
  });

  it("matches any of multiple selected groups", () => {
    expect(matchesScannerGroup(person("Sponsor"), ["participant", "sponsor"])).toBe(true);
    expect(matchesScannerGroup(person("Mentor"), ["participant", "sponsor"])).toBe(false);
  });

  it("matches role names case-insensitively (H8: role is now a free-text role name, not a fixed enum)", () => {
    expect(matchesScannerGroup(person("participant"), ["participant"])).toBe(true);
    expect(matchesScannerGroup(person("SPONSOR"), ["sponsor"])).toBe(true);
  });

  it("never matches an unrelated custom role name with no capabilities against the fixed groups", () => {
    expect(matchesScannerGroup(person("Event Director", false), ["staff"])).toBe(false);
    expect(matchesScannerGroup(person("Event Director", false), ["sponsor"])).toBe(false);
  });
});

describe("isAccreditationEligible", () => {
  it("uses the assigned-role event entitlement instead of capabilities or role names", () => {
    expect(isAccreditationEligible({ eventAccess: true })).toBe(true);
    expect(isAccreditationEligible({ eventAccess: false })).toBe(false);
  });

  it("does not infer event access from application status", () => {
    expect(isAccreditationEligible({ eventAccess: false })).toBe(false);
  });
});
