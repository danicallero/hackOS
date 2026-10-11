import type { ActivityLiveProps, QueueLiveProps } from "@hackos/shared/live-activities";
import { addPushToStartTokenListener, after, type LiveActivity } from "expo-widgets";
import { QueueActivity } from "@/widgets/queue-activity";
import { StaffActivity } from "@/widgets/staff-activity";
import type { LiveActivityHost } from "./host-types";
import type { RunningActivity } from "./model";
import { readLiveActivityState, updateLiveActivityState } from "./store";

/**
 * iOS ActivityKit renderer (#966). Importing the widget modules registers both
 * layouts with the widget extension at launch — required before APNs can
 * push-to-start an activity the app never started itself.
 */
type AnyInstance = LiveActivity<QueueLiveProps> | LiveActivity<ActivityLiveProps>;

const instances = new Map<string, AnyInstance>();
/**
 * Ended with a delayed dismissal and still on the Lock Screen. ActivityKit
 * keeps them in `Activity.activities` until dismissed, but `getInstances()`
 * lists only active ones, so these handles are the only way to remove them.
 */
const lingering = new Map<string, AnyInstance>();
/** One token subscription per activity, removed once the activity is gone. */
const tokenListeners = new Map<string, { remove(): void }>();
/** ActivityKit id → staff subject; push-started activities are unknown until adopted. */
let staffSubjects: Record<string, string> = {};
void readLiveActivityState().then((state) => {
  staffSubjects = { ...state.iosStaffSubjects, ...staffSubjects };
});

/** After an activity ends, how long its final state may stay on the Lock Screen (HIG). */
const FINISHED_DISMISSAL_MS = 15 * 60 * 1000;

function safeInstances<T extends object>(factory: {
  getInstances(): LiveActivity<T>[];
}): LiveActivity<T>[] {
  try {
    return factory.getInstances();
  } catch {
    // iOS < 16.2 has no ActivityKit content API.
    return [];
  }
}

function forget(id: string) {
  instances.delete(id);
  tokenListeners.get(id)?.remove();
  tokenListeners.delete(id);
}

function rememberStaffSubject(id: string, subject: string | null) {
  if (subject) staffSubjects[id] = subject;
  else delete staffSubjects[id];
  const snapshot = { ...staffSubjects };
  void updateLiveActivityState((state) => ({ ...state, iosStaffSubjects: snapshot }));
}

export const liveActivityHost: LiveActivityHost = {
  platform: "ios",
  supported: () => true,
  running(): RunningActivity[] {
    const running: RunningActivity[] = [];
    const seen = new Set<string>();
    for (const instance of safeInstances(QueueActivity)) {
      const id = instance.getId();
      seen.add(id);
      instances.set(id, instance);
      running.push({ id, kind: "queue", subject: null });
    }
    const staffIds = new Set<string>();
    for (const instance of safeInstances(StaffActivity)) {
      const id = instance.getId();
      staffIds.add(id);
      seen.add(id);
      instances.set(id, instance);
      running.push({ id, kind: "activity", subject: staffSubjects[id] ?? null });
    }
    for (const id of Object.keys(staffSubjects)) {
      if (!staffIds.has(id)) rememberStaffSubject(id, null);
    }
    // Ended or swiped away outside the app: drop their token subscriptions.
    for (const id of [...instances.keys()]) if (!seen.has(id)) forget(id);
    return running;
  },
  async start(item) {
    try {
      const instance =
        item.props.kind === "queue"
          ? QueueActivity.start(item.props, item.props.url)
          : StaffActivity.start(item.props, item.props.url);
      const id = instance.getId();
      if (!id) return null;
      instances.set(id, instance);
      if (item.kind === "activity") rememberStaffSubject(id, item.subject);
      return id;
    } catch {
      // Live Activities disabled in Settings, or the per-app limit reached.
      return null;
    }
  },
  async update(id, item) {
    const instance = instances.get(id);
    if (!instance) return;
    if (item.kind === "activity") rememberStaffSubject(id, item.subject);
    await (instance as LiveActivity<typeof item.props>).update(item.props);
  },
  async end(surface, mode) {
    const instance = instances.get(surface.id);
    if (!instance) return;
    forget(surface.id);
    if (surface.kind === "activity") rememberStaffSubject(surface.id, null);
    if (mode === "immediate") {
      lingering.delete(surface.id);
      await instance.end("immediate");
      return;
    }
    lingering.set(surface.id, instance);
    await instance.end(after(new Date(Date.now() + FINISHED_DISMISSAL_MS)));
  },
  async dismissEnded() {
    const ended = [...lingering.values()];
    lingering.clear();
    for (const instance of ended) {
      // Already dismissed by the system or the person: nothing to remove.
      await instance.end("immediate").catch(() => undefined);
    }
  },
  async pushToken(id) {
    try {
      return (await instances.get(id)?.getPushToken()) ?? null;
    } catch {
      return null;
    }
  },
  onPushToken(id, listener) {
    const instance = instances.get(id);
    if (!instance || tokenListeners.has(id)) return;
    tokenListeners.set(
      id,
      instance.addPushTokenListener((event) => listener(event.pushToken)),
    );
  },
};

/** iOS 17.2+: the app-wide token APNs uses to start a Live Activity remotely. */
export function subscribePushToStartToken(listener: (token: string) => void): () => void {
  const subscription = addPushToStartTokenListener((event) =>
    listener(event.activityPushToStartToken),
  );
  return () => subscription.remove();
}
