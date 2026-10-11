import LiveUpdates from "@/modules/live-updates";
import type { LiveActivityHost } from "./host-types";
import {
  liveActivityKey,
  parseAndroidLiveUpdateId,
  type RunningActivity,
  toLiveUpdateSpec,
} from "./model";

/**
 * Android renderer (#966): promoted ongoing notifications through the local
 * `modules/live-updates` Expo module. The module resolves to null when the
 * native code is absent (an older dev client) or below API 26, and every call
 * then degrades to a no-op.
 */
function available(): boolean {
  try {
    return Boolean(LiveUpdates?.isSupported());
  } catch {
    return false;
  }
}

function show(item: Parameters<LiveActivityHost["start"]>[0], previousPhase: string | null) {
  const spec = toLiveUpdateSpec(item.props, previousPhase);
  // Kinds without an Android rendering yet are not posted.
  if (!spec) return null;
  LiveUpdates?.show(spec);
  return spec.id;
}

export const liveActivityHost: LiveActivityHost = {
  platform: "android",
  supported: available,
  running(): RunningActivity[] {
    if (!available()) return [];
    const running: RunningActivity[] = [];
    for (const id of LiveUpdates?.activeIds() ?? []) {
      const parsed = parseAndroidLiveUpdateId(id);
      if (parsed) running.push({ id, ...parsed });
    }
    return running;
  },
  async start(item, previousPhase) {
    if (!available()) return null;
    try {
      return show(item, previousPhase);
    } catch {
      return null;
    }
  },
  async update(_id, item, previousPhase) {
    if (!available()) return;
    show(item, previousPhase);
  },
  renderMode() {
    try {
      return LiveUpdates?.canPostPromotedNotifications() ? "promoted" : "card";
    } catch {
      return "card";
    }
  },
  consumeDismissals() {
    if (!available()) return {};
    const dismissals: Record<string, string> = {};
    for (const [id, phase] of Object.entries(LiveUpdates?.consumeDismissals() ?? {})) {
      const parsed = parseAndroidLiveUpdateId(id);
      if (parsed && phase) dismissals[liveActivityKey(parsed.kind, parsed.subject)] = phase;
    }
    return dismissals;
  },
  async end(surface) {
    if (!available()) return;
    LiveUpdates?.dismiss(surface.id);
  },
  // Android dismisses a notification as soon as it ends: nothing lingers.
  dismissEnded: async () => undefined,
  pushToken: async () => null,
  onPushToken: () => undefined,
};

export function subscribePushToStartToken(_listener: (token: string) => void): () => void {
  return () => undefined;
}
