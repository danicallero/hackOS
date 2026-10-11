import { liveActivityRedirectPath } from "@/lib/live-activities/model";

/**
 * Live Activity tap target without a screen of its own (#966), mapped to the
 * closest existing one:
 * - `hackos://project` (H19 deadline) → the participant's My queue tab,
 *   which lists the team's projects; the deadline goes to `queue:status`
 *   holders, who always have that tab.
 */
const SCREENLESS_LINKS: [RegExp, string][] = [
  [/^(?:hackos:)?\/*project\/?(?:[?#].*)?$/i, "/queue"],
];

/**
 * Rewrites incoming system links before Expo Router resolves them (#966).
 * `hackos://scan?activity=<id>` — the staff Live Activity's tap target and
 * its Scan action — opens the activity scanner bound to that activity;
 * `hackos://project` lands on the screen above;
 * everything else (including `hackos://queue`, `hackos://scan` and
 * `hackos://schedule/<id>`) passes through unchanged.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (__DEV__) {
      const sample =
        require("@/lib/live-activities/dev-samples") as typeof import("@/lib/live-activities/dev-samples");
      const handled = sample.handleDevLiveActivityLink(path);
      if (handled) return handled;
    }
    const trimmed = path.trim();
    for (const [pattern, target] of SCREENLESS_LINKS) if (pattern.test(trimmed)) return target;
    return liveActivityRedirectPath(path) ?? path;
  } catch {
    return path;
  }
}
