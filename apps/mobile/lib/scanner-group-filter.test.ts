const mockSecureStore = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
}));

import * as SecureStore from "expo-secure-store";
import {
  isAccreditationEligible,
  loadScannerGroupFilter,
  matchesScannerGroup,
  saveScannerGroupFilter,
} from "./scanner-group-filter";

function person(role: string | null, hasCapabilities = false) {
  return { role, hasCapabilities };
}

beforeEach(() => {
  mockSecureStore.clear();
  jest.clearAllMocks();
});

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

describe("saveScannerGroupFilter", () => {
  it("applies writes in call order even when an earlier write's I/O resolves later (fast-tap race)", async () => {
    const setItemAsync = SecureStore.setItemAsync as jest.Mock;
    setItemAsync
      .mockImplementationOnce(
        (key: string, value: string) =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              mockSecureStore.set(key, value);
              resolve();
            }, 50);
          }),
      )
      .mockImplementationOnce(
        (key: string, value: string) =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              mockSecureStore.set(key, value);
              resolve();
            }, 5);
          }),
      );

    // Simulates two fast taps: toggling "participant" on, then "mentor" on
    // right after, before the first SecureStore write has settled.
    const first = saveScannerGroupFilter(["participant"]);
    const second = saveScannerGroupFilter(["participant", "mentor"]);
    await Promise.all([first, second]);

    expect(await loadScannerGroupFilter()).toEqual(["participant", "mentor"]);
  });
});
