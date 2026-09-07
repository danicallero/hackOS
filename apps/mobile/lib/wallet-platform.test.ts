jest.mock("expo-device", () => ({
  DeviceType: { UNKNOWN: 0, PHONE: 1, TABLET: 2, DESKTOP: 3, TV: 4 },
}));

import { DeviceType } from "expo-device";
import {
  ANDROID_GRANT_READ_URI_PERMISSION,
  ANDROID_VIEW_ACTION,
  createAndroidPkpassViewIntent,
  PKPASS_MIME_TYPE,
  resolveAppleWalletPass,
  supportsAppleWalletButton,
  supportsAppleWalletFileHandoff,
} from "./wallet-platform";

describe("createAndroidPkpassViewIntent", () => {
  it("opens a content URI with the pkpass MIME type and read grant", () => {
    expect(
      createAndroidPkpassViewIntent(
        "content://com.hackudc.os.FileSystemFileProvider/cache/ticket.pkpass",
      ),
    ).toEqual({
      data: "content://com.hackudc.os.FileSystemFileProvider/cache/ticket.pkpass",
      type: PKPASS_MIME_TYPE,
      flags: ANDROID_GRANT_READ_URI_PERMISSION,
    });
    expect(ANDROID_VIEW_ACTION).toBe("android.intent.action.VIEW");
  });

  it("rejects file URIs so callers cannot leak an app-private path", () => {
    expect(() => createAndroidPkpassViewIntent("file:///data/user/0/hackos/ticket.pkpass")).toThrow(
      "content URI",
    );
  });
});

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
