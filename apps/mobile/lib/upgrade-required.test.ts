import { act, renderHook } from "@testing-library/react-native";
import { clientBuildHeaders } from "./client-build";
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
