import { DeviceType } from "expo-device";

export type WalletPurpose = "ticket" | "badge";

export const PKPASS_MIME_TYPE = "application/vnd.apple.pkpass";
/**
 * MIME aliases used by Android pass importers (H28, #624). Keep the Apple
 * type first so handlers that support the canonical type win, but also try
 * the aliases used by older Passbook-compatible apps.
 */
export const ANDROID_PKPASS_MIME_TYPES = [
  PKPASS_MIME_TYPE,
  "application/pkpass",
  "application/vndapplepkpass",
  "application/vnd-com.apple.pkpass",
] as const;
export type AndroidPkpassMimeType = (typeof ANDROID_PKPASS_MIME_TYPES)[number];
export const ANDROID_VIEW_ACTION = "android.intent.action.VIEW";
/** Android's Intent.FLAG_GRANT_READ_URI_PERMISSION (H28, #624). */
export const ANDROID_GRANT_READ_URI_PERMISSION = 1;

/**
 * Build the Android VIEW handoff expected by wallet importers such as
 * PassAndroid. The file provider URI and explicit read grant let the target
 * app read the authenticated, app-private download (H28, #624).
 */
export function createAndroidPkpassViewIntent(
  contentUri: string,
  mimeType: AndroidPkpassMimeType = PKPASS_MIME_TYPE,
): {
  data: string;
  type: AndroidPkpassMimeType;
  flags: typeof ANDROID_GRANT_READ_URI_PERMISSION;
} {
  if (!contentUri.startsWith("content://")) {
    throw new Error("Android .pkpass handoff requires a content URI");
  }

  return {
    data: contentUri,
    type: mimeType,
    flags: ANDROID_GRANT_READ_URI_PERMISSION,
  };
}

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
