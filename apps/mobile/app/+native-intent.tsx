import { liveActivityRedirectPath } from "@/lib/live-activities/model";

/**
 * Rewrites incoming system links before Expo Router resolves them (#966).
 * `hackos://scan?activity=<id>` — the staff Live Activity's tap target and
 * its Scan action — opens the activity scanner bound to that activity;
 * everything else (including `hackos://queue`) passes through unchanged.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (__DEV__) {
      const sample =
        require("@/lib/live-activities/dev-samples") as typeof import("@/lib/live-activities/dev-samples");
      const handled = sample.handleDevLiveActivityLink(path);
      if (handled) return handled;
    }
    return liveActivityRedirectPath(path) ?? path;
  } catch {
    return path;
  }
}
