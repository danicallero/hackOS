import {
  ACCREDITATION_LIVE_ACTIVITY_SUBJECT,
  DEADLINE_LIVE_ACTIVITY_SUBJECT,
  type LiveActivityKind,
  type LiveActivityProps,
  liveActivityStaleDate,
  QUEUE_LIVE_ACTIVITY_SUBJECT,
  relevanceForRank,
} from "@hackos/shared/live-activities";
import { addPushToStartTokenListener, after, type LiveActivity } from "expo-widgets";
import { AccreditationActivity } from "@/widgets/accreditation-activity";
import { AttendeeActivity } from "@/widgets/attendee-activity";
import { DeadlineActivity } from "@/widgets/deadline-activity";
import { QueueActivity } from "@/widgets/queue-activity";
import { StaffActivity } from "@/widgets/staff-activity";
import type { LiveActivityHost } from "./host-types";
import type { RunningActivity } from "./model";
import { readLiveActivityState, updateLiveActivityState } from "./store";

/**
 * iOS ActivityKit renderer (#966). Importing the widget modules registers
 * every layout with the widget extension at launch — required before APNs
 * can push-to-start an activity the app never started itself.
 */
type AnyInstance = LiveActivity<LiveActivityProps>;

interface Factory {
  start(
    props: LiveActivityProps,
    url?: string,
    staleDate?: Date,
    relevanceScore?: number,
  ): AnyInstance;
  getInstances(): AnyInstance[];
}

/** One `createLiveActivity` per kind (names: `LIVE_ACTIVITY_WIDGET_NAMES`). */
const FACTORIES = {
  queue: QueueActivity,
  activity: StaffActivity,
  attendee_activity: AttendeeActivity,
  deadline: DeadlineActivity,
  accreditation: AccreditationActivity,
} as unknown as Partial<Record<LiveActivityKind, Factory>>;

/**
 * Kinds with a single subject per person: a push-started activity of these
 * is identified by its kind alone. The others (staff and attendee
 * activities) need the remembered id → subject pairing.
 */
const FIXED_SUBJECTS: Partial<Record<LiveActivityKind, string>> = {
  queue: QUEUE_LIVE_ACTIVITY_SUBJECT,
  deadline: DEADLINE_LIVE_ACTIVITY_SUBJECT,
  accreditation: ACCREDITATION_LIVE_ACTIVITY_SUBJECT,
};

const instances = new Map<string, AnyInstance>();
/**
 * Ended with a delayed dismissal and still on the Lock Screen. ActivityKit
 * keeps them in `Activity.activities` until dismissed, but `getInstances()`
 * lists only active ones, so these handles are the only way to remove them.
 */
const lingering = new Map<string, AnyInstance>();
/** One token subscription per activity, removed once the activity is gone. */
const tokenListeners = new Map<string, { remove(): void }>();
/**
 * ActivityKit id → subject for multi-subject kinds; push-started activities
 * are unknown until adopted. Persisted as `iosStaffSubjects` (the name
 * predates the attendee kind).
 */
let subjects: Record<string, string> = {};
void readLiveActivityState().then((state) => {
  subjects = { ...state.iosStaffSubjects, ...subjects };
});

/**
 * After an activity ends, how long its final state may stay on the Lock Screen.
 * Kept short: a 15-minute window made finished activities look stuck (#966).
 */
const FINISHED_DISMISSAL_MS = 30 * 1000;
/**
 * Same `stale-date` the API sends (`liveActivityStaleDate`): an upcoming
 * staff or attendee activity turns live at its start (the widget reads
 * `isStale`, H25, H26, H59), everything else is shown as outdated after its
 * own end, or 30 min ahead for the queue.
 */
function staleDateFor(props: LiveActivityProps): Date {
  return liveActivityStaleDate(props, Date.now());
}

function safeInstances(factory: Factory): AnyInstance[] {
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

function rememberSubject(id: string, subject: string | null) {
  if (subject) subjects[id] = subject;
  else delete subjects[id];
  const snapshot = { ...subjects };
  void updateLiveActivityState((state) => ({ ...state, iosStaffSubjects: snapshot }));
}

export const liveActivityHost: LiveActivityHost = {
  platform: "ios",
  supported: () => true,
  running(): RunningActivity[] {
    const running: RunningActivity[] = [];
    const seen = new Set<string>();
    for (const [kind, factory] of Object.entries(FACTORIES) as [LiveActivityKind, Factory][]) {
      for (const instance of safeInstances(factory)) {
        const id = instance.getId();
        seen.add(id);
        instances.set(id, instance);
        // The queue reports a null subject (the model maps it); the other
        // single-subject kinds report theirs.
        const subject = kind === "queue" ? null : (FIXED_SUBJECTS[kind] ?? subjects[id] ?? null);
        running.push({ id, kind, subject });
      }
    }
    for (const id of Object.keys(subjects)) {
      if (!seen.has(id)) rememberSubject(id, null);
    }
    // Ended or swiped away outside the app: drop their token subscriptions.
    for (const id of [...instances.keys()]) if (!seen.has(id)) forget(id);
    return running;
  },
  async start(item) {
    try {
      const factory = FACTORIES[item.props.kind];
      if (!factory) return null;
      // A local start or update replaces the whole ActivityKit content, so
      // it must carry the rank's relevance too: without it the score is 0
      // and iOS orders the Dynamic Island by start time instead (#966).
      const instance = factory.start(
        item.props,
        item.props.url,
        staleDateFor(item.props),
        relevanceForRank(item.props.rank),
      );
      const id = instance.getId();
      if (!id) return null;
      instances.set(id, instance);
      if (!(item.kind in FIXED_SUBJECTS)) rememberSubject(id, item.subject);
      return id;
    } catch {
      // Live Activities disabled in Settings, or the per-app limit reached.
      return null;
    }
  },
  async update(id, item) {
    const instance = instances.get(id);
    if (!instance) return;
    if (!(item.kind in FIXED_SUBJECTS)) rememberSubject(id, item.subject);
    await instance.update(item.props, staleDateFor(item.props), relevanceForRank(item.props.rank));
  },
  async end(surface, mode) {
    const instance = instances.get(surface.id);
    if (!instance) return;
    forget(surface.id);
    if (!(surface.kind in FIXED_SUBJECTS)) rememberSubject(surface.id, null);
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
