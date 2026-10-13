import { nativeBuildVersion } from "expo-application";

/** Native build number sent on every API request; the API enforces `MOBILE_MIN_BUILD` (#999). */
export const CLIENT_BUILD_HEADER = "X-HackOS-Build";

/** Empty when the build number is unknown (web preview, dev client without a native build). */
export function clientBuildHeaders(
  build: string | null = nativeBuildVersion,
): Record<string, string> {
  return build && /^\d+$/.test(build) ? { [CLIENT_BUILD_HEADER]: build } : {};
}
