import { nativeApplicationVersion } from "expo-application";
import Constants from "expo-constants";

/** `v1.0.2 · abc1234`: the commit is embedded by app.config.ts at build time. */
export function formatAppVersion(version: string | null, commit: unknown): string {
  const label = `v${version ?? "unknown"}`;
  return typeof commit === "string" && commit ? `${label} · ${commit}` : label;
}

// Read the value embedded in the installed binary rather than duplicating the
// release version in each screen. The fallback only applies outside a native
// build, where Expo does not expose an application version.
export const appVersionLabel = formatAppVersion(
  nativeApplicationVersion,
  Constants.expoConfig?.extra?.buildCommit,
);
