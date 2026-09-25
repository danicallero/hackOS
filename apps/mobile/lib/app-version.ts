import { nativeApplicationVersion } from "expo-application";

// Read the value embedded in the installed binary rather than duplicating the
// release version in each screen. The fallback only applies outside a native
// build, where Expo does not expose an application version.
export const appVersionLabel = `v${nativeApplicationVersion ?? "unknown"}`;
