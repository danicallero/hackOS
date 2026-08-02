import * as Haptics from "expo-haptics";

import { haptic } from "./haptics";

jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Error: "error", Success: "success", Warning: "warning" },
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
}));

describe("mobile haptics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.EXPO_OS;
  });

  it.each([
    ["selection", "selectionAsync"],
    ["light", "impactAsync"],
    ["medium", "impactAsync"],
    ["success", "notificationAsync"],
    ["warning", "notificationAsync"],
    ["error", "notificationAsync"],
  ] as const)("maps %s to Expo Haptics", async (intent, method) => {
    await haptic(intent);

    const calls = {
      impactAsync: Haptics.impactAsync,
      notificationAsync: Haptics.notificationAsync,
      selectionAsync: Haptics.selectionAsync,
    };
    expect(calls[method]).toHaveBeenCalledTimes(1);
  });

  it("does not reject when the native haptics module fails", async () => {
    (Haptics.selectionAsync as jest.Mock).mockRejectedValueOnce(new Error("unsupported"));

    await expect(haptic("selection")).resolves.toBeUndefined();
  });
});
