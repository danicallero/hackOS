import {
  ACCREDITATION_LIVE_ACTIVITY_SUBJECT,
  type ActivityLiveProps,
  type AndroidLiveUpdateMessage,
  activityLiveActivitySubject,
  attendeeActivityLiveActivitySubject,
  DEADLINE_LIVE_ACTIVITY_SUBJECT,
  LIVE_ACTIVITY_KINDS,
  LIVE_ACTIVITY_PROPS_VERSION,
  type LiveActivityKind,
  type LiveActivityProps,
  type MyLiveActivities,
  QUEUE_LIVE_ACTIVITY_SUBJECT,
  type QueueLiveProps,
} from "@hackos/shared/live-activities";
import type { LiveUpdateSpec } from "@/modules/live-updates";

/**
 * Pure Live Activity / Live Update logic (#966; H38 queue, H25/H26 staff
 * activities): which system surfaces should exist, how they map onto the
 * platform renderers and which deep links they open. No native imports, so
 * it is unit tested directly (`model.test.ts`).
 */

/** `theme/colors.ts` `accent` (systemBlue); native notification surfaces take a hex. */
export const LIVE_ACCENT_HEX = "#007AFF";

export interface DesiredActivity {
  kind: LiveActivityKind;
  subject: string;
  props: LiveActivityProps;
}

/** One running system surface; `subject` is null when the app cannot tell (iOS push-to-start). */
export interface RunningActivity {
  id: string;
  kind: LiveActivityKind;
  subject: string | null;
}

export interface ReconcilePlan {
  start: DesiredActivity[];
  update: { id: string; desired: DesiredActivity }[];
  /** Surfaces the server no longer lists. */
  end: RunningActivity[];
  /** Pairings for running surfaces whose subject was unknown until now. */
  adopt: { id: string; subject: string }[];
  /** Surfaces the person swiped away although the server still lists them, with their phase. */
  dismissed: { key: string; phase: string }[];
}

export function liveActivityKey(kind: LiveActivityKind, subject: string): string {
  return `${kind}:${subject}`;
}

function isProps(value: unknown): value is LiveActivityProps {
  if (!value || typeof value !== "object") return false;
  const props = value as Partial<LiveActivityProps>;
  return (
    props.v === LIVE_ACTIVITY_PROPS_VERSION &&
    (Object.values(LIVE_ACTIVITY_KINDS) as unknown[]).includes(props.kind)
  );
}

/**
 * The surfaces the server wants for this device. The queue one never exists
 * outside the judging window (H38), and unknown props versions are skipped
 * rather than rendered half-understood.
 */
export function desiredActivities(response: MyLiveActivities): DesiredActivity[] {
  const desired: DesiredActivity[] = [];
  if (response.judgingWindowOpen && response.queue && isProps(response.queue)) {
    desired.push({
      kind: LIVE_ACTIVITY_KINDS.QUEUE,
      subject: QUEUE_LIVE_ACTIVITY_SUBJECT,
      props: response.queue,
    });
  }
  for (const activity of response.activities) {
    if (!isProps(activity)) continue;
    desired.push({
      kind: LIVE_ACTIVITY_KINDS.ACTIVITY,
      subject: activityLiveActivitySubject(activity.activityId),
      props: activity,
    });
  }
  // H59, H19, H22 kinds: optional fields, absent on older servers.
  for (const item of response.attendeeActivities ?? []) {
    if (!isProps(item)) continue;
    desired.push({
      kind: LIVE_ACTIVITY_KINDS.ATTENDEE_ACTIVITY,
      subject: attendeeActivityLiveActivitySubject(item.scheduleId),
      props: item,
    });
  }
  if (response.deadline && isProps(response.deadline)) {
    desired.push({
      kind: LIVE_ACTIVITY_KINDS.DEADLINE,
      subject: DEADLINE_LIVE_ACTIVITY_SUBJECT,
      props: response.deadline,
    });
  }
  if (response.accreditation && isProps(response.accreditation)) {
    desired.push({
      kind: LIVE_ACTIVITY_KINDS.ACCREDITATION,
      subject: ACCREDITATION_LIVE_ACTIVITY_SUBJECT,
      props: response.accreditation,
    });
  }
  return rankedWithinLimit(desired, response.maxConcurrent);
}

/**
 * The server already ranks the set and cuts it to the device's
 * `maxConcurrent` when sent `deviceId`; this keeps the device within the
 * limit even so, the most important first (`rank` 0; unranked last, in
 * response order).
 */
function rankedWithinLimit(
  desired: DesiredActivity[],
  maxConcurrent: number | undefined,
): DesiredActivity[] {
  const rankOf = (item: DesiredActivity) =>
    typeof item.props.rank === "number" ? item.props.rank : Number.POSITIVE_INFINITY;
  const ranked = desired
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rankOf(a.item) - rankOf(b.item) || a.index - b.index)
    .map(({ item }) => item);
  return typeof maxConcurrent === "number" && Number.isFinite(maxConcurrent) && maxConcurrent >= 1
    ? ranked.slice(0, Math.floor(maxConcurrent))
    : ranked;
}

/** Content identity, ignoring the server's computation timestamp. */
export function propsSignature(props: LiveActivityProps): string {
  const { updatedAt: _updatedAt, ...rest } = props;
  return JSON.stringify(rest);
}

/**
 * Nearest-state reconciliation between the server's list and the surfaces
 * running on the device. Exactly one surface per (kind, subject): missing ones
 * start unless the user dismissed them, changed ones update, duplicates and
 * ones the server dropped end. iOS cannot read a push-started activity's
 * props, so an unidentified staff activity is adopted by a listed subject that
 * has no surface yet — the immediate update makes its content correct either
 * way — and ended when there is none left to adopt it.
 */
export function planReconcile(
  desired: DesiredActivity[],
  running: RunningActivity[],
  memory: {
    signatures: ReadonlyMap<string, string>;
    /** Key → phase at the moment the person dismissed it. */
    dismissed: ReadonlyMap<string, string>;
    /** Keys that had a running surface at the previous reconcile. */
    previouslyRunning: ReadonlySet<string>;
  },
): ReconcilePlan {
  const plan: ReconcilePlan = { start: [], update: [], end: [], adopt: [], dismissed: [] };
  const byKey = new Map<string, RunningActivity[]>();
  const unknown: RunningActivity[] = [];
  for (const surface of running) {
    const subject =
      surface.subject ?? (surface.kind === "queue" ? QUEUE_LIVE_ACTIVITY_SUBJECT : null);
    if (subject === null) {
      unknown.push(surface);
      continue;
    }
    const key = liveActivityKey(surface.kind, subject);
    byKey.set(key, [...(byKey.get(key) ?? []), { ...surface, subject }]);
  }

  const wanted = new Set<string>();
  for (const item of desired) {
    const key = liveActivityKey(item.kind, item.subject);
    wanted.add(key);
    const surfaces = byKey.get(key) ?? [];
    let primary = surfaces[0];
    if (!primary) {
      const adoptIndex = unknown.findIndex((surface) => surface.kind === item.kind);
      if (adoptIndex >= 0) {
        primary = { ...unknown[adoptIndex]!, subject: item.subject };
        unknown.splice(adoptIndex, 1);
        plan.adopt.push({ id: primary.id, subject: item.subject });
        plan.update.push({ id: primary.id, desired: item });
        continue;
      }
    }
    if (!primary) {
      // A dismissal holds until the state meaningfully changes (the team is
      // called, the activity goes live) or the subject leaves the list.
      if (memory.dismissed.get(key) === item.props.phase) continue;
      if (memory.previouslyRunning.has(key) && !memory.dismissed.has(key)) {
        // It ran a moment ago and the server still lists it: the person
        // swiped it away (Dynamic Island / Lock Screen, or Android 14+).
        plan.dismissed.push({ key, phase: item.props.phase });
        continue;
      }
      plan.start.push(item);
      continue;
    }
    if (memory.signatures.get(key) !== propsSignature(item.props)) {
      plan.update.push({ id: primary.id, desired: item });
    }
    plan.end.push(...surfaces.slice(1));
  }

  for (const [key, surfaces] of byKey) {
    if (!wanted.has(key)) plan.end.push(...surfaces);
  }
  plan.end.push(...unknown);
  return plan;
}

/** Dismissed keys stay suppressed only while the server keeps listing them. */
export function pruneDismissed(
  dismissed: Record<string, string>,
  desired: DesiredActivity[],
): Record<string, string> {
  const phases = new Map(
    desired.map((item) => [liveActivityKey(item.kind, item.subject), item.props.phase]),
  );
  return Object.fromEntries(
    Object.entries(dismissed).filter(([key, phase]) => phases.get(key) === phase),
  );
}

/** Local optimistic counter after a first-time scan in the bound activity (H25/H26). */
export function withScannedIncrement(props: ActivityLiveProps, by = 1): ActivityLiveProps {
  return { ...props, scanned: props.scanned + by };
}

/**
 * Next instant a surface changes phase or ends on its own (an activity or
 * schedule item starting or ending, the deadline, the accreditation window),
 * so the foreground app can refresh exactly then instead of polling.
 */
export function nextPhaseBoundary(desired: DesiredActivity[], now: number): number | null {
  let next: number | null = null;
  for (const item of desired) {
    const props = item.props;
    const instants =
      props.kind === "activity" || props.kind === "attendee_activity"
        ? [props.startsAt, props.endsAt]
        : props.kind === "deadline" || props.kind === "accreditation"
          ? [props.endsAt]
          : [];
    for (const iso of instants) {
      const at = Date.parse(iso);
      if (Number.isFinite(at) && at > now && (next === null || at < next)) next = at;
    }
  }
  return next;
}

// ─── Android Live Updates ────────────────────────────────────────────────

/** Notification identity: `queue:judging` or `activity:12`. */
export function androidLiveUpdateId(kind: LiveActivityKind, subject: string): string {
  return kind === "queue" ? liveActivityKey(kind, subject) : subject;
}

export function parseAndroidLiveUpdateId(
  id: string,
): { kind: LiveActivityKind; subject: string } | null {
  if (id.startsWith("queue:")) return { kind: "queue", subject: id.slice("queue:".length) };
  if (/^activity:\d+$/.test(id)) return { kind: "activity", subject: id };
  return null;
}

function etaMinutes(props: QueueLiveProps): number | null {
  return props.etaMinutes === null ? null : Math.max(1, Math.round(props.etaMinutes));
}

/** Keeps the status-bar chip within Android's ~7 characters. */
function chip(value: string): string {
  return value.length <= 7 ? value : `${value.slice(0, 6)}…`;
}

function clock(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Props → promoted ongoing notification. The queue alerts (heads-up and
 * sound) only on the transition into "called"; every other post is silent.
 */
export function toLiveUpdateSpec(
  props: QueueLiveProps | ActivityLiveProps,
  previousPhase: string | null,
): LiveUpdateSpec {
  if (props.kind === "queue") {
    const id = androidLiveUpdateId("queue", QUEUE_LIVE_ACTIVITY_SUBJECT);
    const room = props.roomName ?? "";
    const where = props.roomLocation ? ` · ${props.roomLocation}` : "";
    if (props.phase === "called" || props.phase === "in_room") {
      return {
        id,
        title: props.challengeTitle,
        text:
          props.phase === "called"
            ? room
              ? `${props.labels.goTo} ${room}${where}`
              : props.roomLocation
            : room
              ? `${props.labels.inRoom} · ${room}`
              : props.labels.inRoom,
        // No room yet: an empty chip would render as a blank status-bar pill.
        shortCriticalText: room ? chip(room) : null,
        subText: props.labels.moreQueues,
        url: props.url,
        accentColor: LIVE_ACCENT_HEX,
        icon: "queue",
        alert: props.phase === "called" && previousPhase !== "called",
      };
    }
    const eta = etaMinutes(props);
    const position = props.position === null ? null : `#${props.position}`;
    const parts = [
      position ? `${props.labels.position} ${position}` : null,
      eta !== null ? `${props.labels.wait} ~${eta} ${props.labels.minutes}` : null,
    ].filter(Boolean);
    return {
      id,
      title: props.challengeTitle,
      text: parts.join(" · ") || null,
      shortCriticalText: eta !== null ? `~${eta}m` : position,
      subText: props.labels.moreQueues,
      url: props.url,
      accentColor: LIVE_ACCENT_HEX,
      icon: "queue",
      alert: false,
    };
  }

  const id = androidLiveUpdateId("activity", activityLiveActivitySubject(props.activityId));
  const when = `${clock(props.startsAt)}–${clock(props.endsAt)}`;
  const live = props.phase === "live";
  return {
    id,
    title: props.name,
    text: props.location ? `${when} · ${props.location}` : when,
    shortCriticalText: live ? chip(String(props.scanned)) : null,
    subText: live ? `${props.labels.scanned}: ${props.scanned}` : props.labels.startsIn,
    countdownTo: live ? null : Date.parse(props.startsAt),
    url: props.url,
    action: live ? { label: props.labels.scan, url: props.scanUrl } : null,
    accentColor: LIVE_ACCENT_HEX,
    icon: props.category === "meal" ? "meal" : "activity",
    alert: false,
  };
}

/**
 * Extracts the Live Update message from an Expo push's data. Depending on the
 * delivery path the data arrives as an object, nested under `body`, or as the
 * `dataString` JSON that the background notification task receives.
 */
export function parseAndroidLiveUpdateMessage(
  raw: unknown,
): AndroidLiveUpdateMessage["hackosLiveUpdate"] | null {
  const candidates: unknown[] = [raw];
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    candidates.push(record.body, record.dataString, record.data);
  }
  for (const candidate of candidates) {
    let value = candidate;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        continue;
      }
    }
    if (!value || typeof value !== "object") continue;
    const message = (value as Partial<AndroidLiveUpdateMessage>).hackosLiveUpdate;
    if (
      message &&
      (message.event === "start" || message.event === "update" || message.event === "end") &&
      (message.kind === "queue" || message.kind === "activity") &&
      typeof message.subject === "string" &&
      (message.event === "end" || isProps(message.props))
    ) {
      return message;
    }
  }
  return null;
}

// ─── Deep links ──────────────────────────────────────────────────────────

/**
 * `hackos://scan?activity=<id>` (the staff Live Activity's tap target and its
 * Scan action) opens the activity scanner already bound to that activity, so
 * the camera starts on the right activity without a chooser (R008). Returns
 * null for every other path, which Expo Router then resolves normally —
 * `hackos://queue` lands on the participant queue tab.
 */
export function liveActivityRedirectPath(path: string): string | null {
  // Parsed by hand: React Native's URL polyfill does not implement searchParams.
  const match = /^(?:hackos:)?\/*scan\/?\?(.*)$/i.exec(path.trim());
  if (!match) return null;
  for (const pair of (match[1] ?? "").split("#")[0]!.split("&")) {
    const [name, value] = pair.split("=");
    if (name === "activity" && value && /^\d+$/.test(value) && Number(value) > 0) {
      return `/activities/${Number(value)}`;
    }
  }
  return null;
}
