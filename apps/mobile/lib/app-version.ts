import { nativeApplicationVersion } from "expo-application";
import Constants from "expo-constants";
/** `v1.0.4 · abc1234`: the commit is embedded by app.config.ts at build time. */
export function formatAppVersion(version: string | null, commit: unknown): string {
  const label = `v${version ?? "unknown"}`;
  return typeof commit === "string" && /^[a-f0-9]{7,40}$/i.test(commit)
    ? `${label} · ${commit.slice(0, 7)}`
    : label;
}

// Expo config keeps the visible label in sync with the JavaScript bundle;
// nativeApplicationVersion is the fallback for builds without that metadata.
export const appVersionLabel = formatAppVersion(
  Constants.expoConfig?.version ?? nativeApplicationVersion,
  Constants.expoConfig?.extra?.buildCommit,
);
