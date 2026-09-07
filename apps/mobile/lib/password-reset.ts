import { EVENT_WEBSITE_URL } from "./env";

export const NATIVE_PASSWORD_RESET_REDIRECT = "hackos://reset-password";

/**
 * Android recovery uses the browser reset form until the native callback can
 * reliably receive Better Auth's token on every Android build. The API
 * callback appends the token to this URL before redirecting, so the browser
 * form can complete the reset without exposing the raw API response.
 */
export function passwordResetRedirect(platform = process.env.EXPO_OS): string {
  if (platform === "android") {
    return `${EVENT_WEBSITE_URL.replace(/\/+$/, "")}/reset-password`;
  }
  return NATIVE_PASSWORD_RESET_REDIRECT;
}
