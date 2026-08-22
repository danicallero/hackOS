import { DeviceType } from "expo-device";

/** H28: PassKit's add-pass button is only safe on iPhone; iPad doesn't support it. */
export function supportsAppleWalletButton(
  platform: string,
  deviceType: DeviceType | null,
): boolean {
  return platform === "ios" && deviceType === DeviceType.PHONE;
}

/** H28: macOS handles the pass file itself, like the web download flow. */
export function supportsAppleWalletFileHandoff(
  platform: string,
  deviceType: DeviceType | null,
): boolean {
  return platform === "ios" && deviceType === DeviceType.DESKTOP;
}
