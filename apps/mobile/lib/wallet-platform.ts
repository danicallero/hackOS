import { DeviceType } from "expo-device";

export type WalletPurpose = "ticket" | "badge";

/** The shared Apple pass type ID needs the account-specific serial to disambiguate passes. */
export function resolveAppleWalletPass(
  passTypeIdentifier: string,
  serialNumbers: Partial<Record<WalletPurpose, string | null>> | null | undefined,
  purpose: WalletPurpose,
): { cardIdentifier: string; serialNumber: string } | null {
  const serialNumber = serialNumbers?.[purpose];
  return serialNumber ? { cardIdentifier: passTypeIdentifier, serialNumber } : null;
}

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
