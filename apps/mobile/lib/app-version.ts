import { nativeApplicationVersion } from "expo-application";
import Constants from "expo-constants";

// Read the value embedded in the installed binary rather than duplicating the
// release version in each screen. The fallback only applies outside a native
// build, where Expo does not expose an application version.
const commit = Constants.expoConfig?.extra?.buildCommit;
export const appVersionLabel = `v${nativeApplicationVersion ?? "unknown"}${
  typeof commit === "string" && /^[a-f0-9]{7,40}$/i.test(commit) ? ` · ${commit.slice(0, 7)}` : ""
}`;
