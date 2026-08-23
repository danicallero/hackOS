jest.mock("expo-device", () => ({
  DeviceType: { UNKNOWN: 0, PHONE: 1, TABLET: 2, DESKTOP: 3, TV: 4 },
}));

import { DeviceType } from "expo-device";
import {
  resolveAppleWalletPass,
  supportsAppleWalletButton,
  supportsAppleWalletFileHandoff,
} from "./wallet-platform";

describe("resolveAppleWalletPass", () => {
  it("selects the serial for the currently selected pass purpose", () => {
    expect(
      resolveAppleWalletPass(
        "pass.hackos",
        { ticket: "ticket-account-a", badge: "badge-account-a" },
        "badge",
      ),
    ).toEqual({ cardIdentifier: "pass.hackos", serialNumber: "badge-account-a" });
  });

  it("does not fall back to the shared identifier when the account pass is unknown", () => {
    expect(
      resolveAppleWalletPass("pass.hackos", { ticket: null, badge: null }, "ticket"),
    ).toBeNull();
  });
});

describe("supportsAppleWalletButton", () => {
  it("allows the native PassKit button on iOS phones", () => {
    expect(supportsAppleWalletButton("ios", DeviceType.PHONE)).toBe(true);
  });

  it.each([
    DeviceType.TABLET,
    DeviceType.DESKTOP,
    DeviceType.TV,
    DeviceType.UNKNOWN,
    null,
  ])("does not mount PassKit on unsupported iOS device type %s", (deviceType) => {
    expect(supportsAppleWalletButton("ios", deviceType)).toBe(false);
  });

  it("does not mount PassKit on Android", () => {
    expect(supportsAppleWalletButton("android", DeviceType.PHONE)).toBe(false);
  });

  it("uses the file handoff for an iOS-compatible app running on macOS", () => {
    expect(supportsAppleWalletFileHandoff("ios", DeviceType.DESKTOP)).toBe(true);
  });

  it.each([
    DeviceType.PHONE,
    DeviceType.TABLET,
    DeviceType.UNKNOWN,
    null,
  ])("does not use the macOS file handoff on iOS device type %s", (deviceType) => {
    expect(supportsAppleWalletFileHandoff("ios", deviceType)).toBe(false);
  });

  it("does not use the Apple file handoff on Android", () => {
    expect(supportsAppleWalletFileHandoff("android", DeviceType.DESKTOP)).toBe(false);
  });
});
