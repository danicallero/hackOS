const mockSecureStore = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
}));

import {
  clearAccountRemovalProgress,
  readAccountRemovalProgress,
  saveAccountRemovalProgress,
} from "./removal-progress";

beforeEach(() => {
  mockSecureStore.clear();
  jest.clearAllMocks();
});

describe("account removal progress", () => {
  it("survives a restart without storing identity", async () => {
    await saveAccountRemovalProgress({ action: "anonymize", status: "pending_exit" });

    expect(await readAccountRemovalProgress()).toEqual({
      action: "anonymize",
      status: "pending_exit",
    });
    expect(mockSecureStore.get("hackos_account_removal_progress")).not.toContain("email");
  });

  it("clears the marker", async () => {
    await saveAccountRemovalProgress({ action: "delete", status: "processing" });
    await clearAccountRemovalProgress();

    expect(await readAccountRemovalProgress()).toBeNull();
  });

  it("keeps device-cleanup failure understandable after restart", async () => {
    await saveAccountRemovalProgress({ action: "delete", status: "device_cleanup_pending" });

    expect(await readAccountRemovalProgress()).toEqual({
      action: "delete",
      status: "device_cleanup_pending",
    });
  });

  it("rejects malformed stored values", async () => {
    mockSecureStore.set("hackos_account_removal_progress", '{"action":"user"}');

    expect(await readAccountRemovalProgress()).toBeNull();
  });
});
