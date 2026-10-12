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
  loadScannerRoleFilter,
  matchesScannerRole,
  saveScannerRoleFilter,
} from "./scanner-group-filter";

function person(role: string | null, hasCapabilities = false) {
  return { role, hasCapabilities };
}

beforeEach(() => {
  mockSecureStore.clear();
  jest.clearAllMocks();
});

describe("matchesScannerRole", () => {
  it("includes unassigned people only when showing everyone", () => {
    expect(matchesScannerRole(person(null), [])).toBe(true);
    expect(matchesScannerRole(person(null, true), ["Day Staff"])).toBe(false);
  });
  it("matches exact custom role names like the People directory", () => {
    expect(matchesScannerRole(person("Day Staff"), ["Day Staff"])).toBe(true);
    expect(matchesScannerRole(person("Participant", true), ["Day Staff"])).toBe(false);
    expect(matchesScannerRole(person("participant"), ["Participant"])).toBe(false);
  });
  it("includes each person once for a multi-role selection", () => {
    const people = [person("Day Staff"), person("Participant", true), person("Sponsor")];
    expect(
      people.filter((row) => matchesScannerRole(row, ["Day Staff", "Participant"])),
    ).toHaveLength(2);
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

describe("saveScannerRoleFilter", () => {
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
    const first = saveScannerRoleFilter(["Participant"]);
    const second = saveScannerRoleFilter(["Participant", "Mentor"]);
    await Promise.all([first, second]);

    expect(await loadScannerRoleFilter()).toEqual(["Participant", "Mentor"]);
  });
});
