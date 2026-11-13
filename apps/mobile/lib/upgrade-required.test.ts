import { act, renderHook } from "@testing-library/react-native";
import { clientBuildHeaders, deviceUserAgentHeaders } from "./client-build";
import {
  isUpgradeRequired,
  markUpgradeRequired,
  resetUpgradeRequired,
  useUpgradeRequired,
} from "./upgrade-required";

jest.mock("expo-application", () => ({ nativeBuildVersion: "42" }));

describe("minimum supported build (#999)", () => {
  afterEach(resetUpgradeRequired);

  it("sends the native build number, and nothing when it is unknown", () => {
    expect(clientBuildHeaders()).toEqual({ "X-HackOS-Build": "42" });
    expect(clientBuildHeaders(null)).toEqual({});
    expect(clientBuildHeaders("1.2.3")).toEqual({});
  });

  it("names the device in the user-agent, and keeps the default when unknown (H4)", () => {
    expect(
      deviceUserAgentHeaders({
        manufacturer: "Apple",
        modelName: "iPhone 15 Pro",
        osName: "iOS",
        osVersion: "18.1",
      }),
    ).toEqual({ "User-Agent": "hackOS/42 (iPhone 15 Pro; iOS 18.1)" });
    expect(
      deviceUserAgentHeaders(
        {
          manufacturer: "samsung",
          modelName: "SM-G991B (5G); é",
          osName: "Android",
          osVersion: "14",
        },
        null,
      ),
    ).toEqual({ "User-Agent": "hackOS (samsung SM-G991B 5G; Android 14)" });
    expect(deviceUserAgentHeaders({ modelName: null })).toEqual({});
  });

  it("recognises only the documented 426 contract", () => {
    expect(isUpgradeRequired(426, "upgrade_required")).toBe(true);
    expect(isUpgradeRequired(426, undefined)).toBe(false);
    expect(isUpgradeRequired(400, "upgrade_required")).toBe(false);
  });

  it("latches until reset", async () => {
    const hook = await renderHook(() => useUpgradeRequired());
    expect(hook.result.current).toBe(false);
    await act(async () => markUpgradeRequired());
    expect(hook.result.current).toBe(true);
  });
});
