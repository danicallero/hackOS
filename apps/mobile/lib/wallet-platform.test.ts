jest.mock("expo-device", () => ({
  DeviceType: { UNKNOWN: 0, PHONE: 1, TABLET: 2, DESKTOP: 3, TV: 4 },
}));

import { DeviceType } from "expo-device";
import { supportsAppleWalletButton, supportsAppleWalletFileHandoff } from "./wallet-platform";

describe("supportsAppleWalletButton", () => {
  it.each([
    DeviceType.PHONE,
    DeviceType.TABLET,
  ])("allows the native PassKit button on iOS device type %s", (deviceType) => {
    expect(supportsAppleWalletButton("ios", deviceType)).toBe(true);
  });

  it.each([
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
