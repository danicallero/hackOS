import { DeviceType } from "expo-device";

/** H28: PassKit's add-pass button is only safe on mobile iOS devices. */
export function supportsAppleWalletButton(
  platform: string,
  deviceType: DeviceType | null,
): boolean {
  return (
    platform === "ios" && (deviceType === DeviceType.PHONE || deviceType === DeviceType.TABLET)
  );
}

/** H28: macOS handles the pass file itself, like the web download flow. */
export function supportsAppleWalletFileHandoff(
  platform: string,
  deviceType: DeviceType | null,
): boolean {
  return platform === "ios" && deviceType === DeviceType.DESKTOP;
}
