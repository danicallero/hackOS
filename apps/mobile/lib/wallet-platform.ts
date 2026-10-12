import { DeviceType } from "expo-device";

export type WalletPurpose = "ticket" | "badge";

export const PKPASS_MIME_TYPE = "application/vnd.apple.pkpass";
/**
 * MIME aliases used by Android pass importers (H28, #624). Keep the Apple
 * type first when an importer accepts several types, and include every alias
 * in the same chooser so older Passbook-compatible apps remain discoverable.
 */
export const ANDROID_PKPASS_MIME_TYPES = [
  PKPASS_MIME_TYPE,
  "application/pkpass",
  "application/vndapplepkpass",
  "application/vnd-com.apple.pkpass",
] as const;
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
