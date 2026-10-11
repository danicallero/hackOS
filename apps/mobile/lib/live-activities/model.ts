import {
  type ActivityLiveProps,
  type AndroidLiveUpdateMessage,
  activityLiveActivitySubject,
  LIVE_ACTIVITY_KINDS,
  LIVE_ACTIVITY_PROPS_VERSION,
  type LiveActivityKind,
  type LiveActivityProps,
  type MyLiveActivities,
  QUEUE_LIVE_ACTIVITY_SUBJECT,
  type QueueLiveProps,
} from "@hackos/shared/live-activities";
import type { LiveUpdateProgress, LiveUpdateSpec, LiveUpdateTracker } from "@/modules/live-updates";

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
    props.v === LIVE_ACTIVITY_PROPS_VERSION && (props.kind === "queue" || props.kind === "activity")
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
  return desired;
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
 * Next instant the staff surfaces change phase on their own (a start or an
 * end), so the foreground app can refresh exactly then instead of polling.
 */
export function nextPhaseBoundary(desired: DesiredActivity[], now: number): number | null {
  let next: number | null = null;
  for (const item of desired) {
    if (item.props.kind !== "activity") continue;
    for (const iso of [item.props.startsAt, item.props.endsAt]) {
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

/** Android shows the whole chip text only up to 7 characters (96dp chip). */
const CHIP_MAX = 7;

function chip(value: string): string {
  return value.length <= CHIP_MAX ? value : `${value.slice(0, CHIP_MAX - 1)}…`;
}

function clock(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** "142" + "Served" → "142 served": a count followed by its (en/es/gl) label. */
function counted(count: number, label: string | undefined): string | null {
  if (!label) return null;
  return `${count} ${label.charAt(0).toLocaleLowerCase()}${label.slice(1)}`;
}

/** `#RRGGBB` per queue phase: waiting = accent, called = go, in room = neutral. */
export const LIVE_CALLED_HEX = "#34C759";
export const LIVE_NEUTRAL_HEX = "#8E8E93";
const QUEUE_TRACKER: Record<QueueLiveProps["phase"], LiveUpdateTracker> = {
  waiting: "tracker-waiting",
  called: "tracker-called",
  in_room: "tracker-in-room",
};
/**
 * Queue track (H38): In line ──── Called ── In room. The wait in line is
 * the long part of the journey, so its segment is weighted longer than the
 * walk from the call to the room (product decision, matches iOS).
 */
const IN_LINE_LENGTH = 200;
const CALLED_LENGTH = 100;

/**
 * Share of the line already behind the team, from the server's high-water
 * mark: #1 of 4 → 0.75, first sighting → 0. Zero when either side is unknown.
 */
export function queueWaitingFraction(props: QueueLiveProps): number {
  const start = props.startPosition ?? null;
  if (start === null || props.position === null || start <= 0) return 0;
  return clamp01((start - props.position) / start);
}

/** Position on the track: the waiting fraction of the first segment, then each stage's node. */
function queueTrackValue(props: QueueLiveProps): number {
  if (props.phase === "waiting") return Math.round(queueWaitingFraction(props) * IN_LINE_LENGTH);
  return props.phase === "called" ? IN_LINE_LENGTH : IN_LINE_LENGTH + CALLED_LENGTH;
}

function queueProgress(props: QueueLiveProps): LiveUpdateProgress {
  return {
    value: queueTrackValue(props),
    segments: [
      { length: IN_LINE_LENGTH, color: LIVE_ACCENT_HEX },
      { length: CALLED_LENGTH, color: LIVE_CALLED_HEX },
    ],
    // The "Called" node; the track's end dot is "In room".
    points: [{ position: IN_LINE_LENGTH, color: LIVE_CALLED_HEX }],
    tracker: QUEUE_TRACKER[props.phase],
  };
}

/** A single accent bar filled to `fraction`. */
function barProgress(fraction: number): LiveUpdateProgress {
  return {
    value: Math.round(clamp01(fraction) * 100),
    segments: [{ length: 100, color: LIVE_ACCENT_HEX }],
  };
}

function queueSpec(props: QueueLiveProps, previousPhase: string | null): LiveUpdateSpec {
  const base = {
    id: androidLiveUpdateId("queue", QUEUE_LIVE_ACTIVITY_SUBJECT),
    url: props.url,
    icon: "queue" as const,
    phase: props.phase,
    progress: queueProgress(props),
  };
  const room = props.roomName ?? "";

  if (props.phase === "called") {
    const calledAt = props.calledAt ? Date.parse(props.calledAt) : Number.NaN;
    return {
      ...base,
      // Hero: where to go. No room yet: never a dangling "Go to".
      title: room ? `${props.labels.goTo} ${room}` : (props.roomLocation ?? props.challengeTitle),
      text: [room ? props.roomLocation : null, props.challengeTitle].filter(Boolean).join(" · "),
      // Header reads "hackOS · Called · 2:13": the count-up runs in the content.
      subText: Number.isFinite(calledAt) ? (props.labels.called ?? null) : null,
      countUpFrom: Number.isFinite(calledAt) ? calledAt : null,
      // The room stays in the chip; an empty chip would be a blank pill.
      shortCriticalText: room ? chip(room) : null,
      accentColor: LIVE_CALLED_HEX,
      alert: previousPhase !== "called",
    };
  }

  if (props.phase === "in_room") {
    return {
      ...base,
      title: room ? `${props.labels.inRoom} · ${room}` : props.labels.inRoom,
      text: props.challengeTitle,
      subText: props.labels.moreQueues,
      shortCriticalText: room ? chip(room) : null,
      accentColor: LIVE_NEUTRAL_HEX,
      alert: false,
    };
  }

  // Waiting: "when am I up?" — the ETA leads, never an empty placeholder.
  const eta = etaMinutes(props);
  const position = props.position === null ? null : `#${props.position}`;
  const wait = eta !== null ? `~${eta} ${props.labels.minutes}` : (props.labels.estimating ?? null);
  const title = [wait, position].filter(Boolean).join(" · ");
  const both = position && eta !== null ? `${position}·${eta}m` : null;
  return {
    ...base,
    title: title || props.challengeTitle,
    text: title ? props.challengeTitle : null,
    subText: props.labels.moreQueues,
    shortCriticalText:
      both && both.length <= CHIP_MAX ? both : (position ?? (eta !== null ? `${eta}m` : null)),
    accentColor: LIVE_ACCENT_HEX,
    alert: false,
  };
}

function activitySpec(props: ActivityLiveProps, now: number): LiveUpdateSpec {
  const base = {
    id: androidLiveUpdateId("activity", activityLiveActivitySubject(props.activityId)),
    url: props.url,
    icon: props.category === "meal" ? ("meal" as const) : ("activity" as const),
    phase: props.phase,
    accentColor: LIVE_ACCENT_HEX,
    alert: false,
  };
  const when = `${clock(props.startsAt)}–${clock(props.endsAt)}`;

  if (props.phase === "upcoming") {
    // The chip and header count down to the start on their own.
    return {
      ...base,
      title: props.name,
      text: props.location ? `${when} · ${props.location}` : when,
      subText: props.labels.startsIn,
      countdownTo: Date.parse(props.startsAt),
    };
  }

  // Live: a count in the chip, no `when` (see LiveUpdatePoster.applyWhen).
  const action = { label: props.labels.scan, url: props.scanUrl };
  const inside = props.inside ?? null;
  const remaining = props.remaining ?? null;
  if (inside !== null) {
    // Meal (H24/H27): "how many still to eat?"
    const served = remaining !== null ? inside - remaining : null;
    const hero =
      remaining !== null
        ? counted(remaining, props.labels.remaining)
        : counted(props.scanned, props.labels.scanned);
    const details = [
      remaining !== null ? counted(props.scanned, props.labels.served) : null,
      counted(inside, props.labels.inside),
      props.location,
    ].filter(Boolean);
    return {
      ...base,
      title: hero ?? props.name,
      text: details.join(" · ") || null,
      subText: hero ? `${props.name} · ${when}` : when,
      shortCriticalText: chip(String(remaining ?? props.scanned)),
      // Served share of the people inside; nothing to fill when nobody is in.
      progress: served !== null && inside > 0 ? barProgress(served / inside) : null,
      action,
    };
  }

  const start = Date.parse(props.startsAt);
  const end = Date.parse(props.endsAt);
  const hero = counted(props.scanned, props.labels.scanned);
  return {
    ...base,
    title: hero ?? props.name,
    text: [hero ? props.name : null, props.location].filter(Boolean).join(" · ") || null,
    subText: when,
    shortCriticalText: chip(String(props.scanned)),
    // Time elapsed between start and end, as of this post.
    progress: end > start ? barProgress((now - start) / (end - start)) : null,
    action,
  };
}

/**
 * Props → promoted ongoing notification (#966; H38 queue, H25/H26 staff).
 * The queue alerts (heads-up and sound) only on the transition into
 * "called"; every other post is silent.
 */
export function toLiveUpdateSpec(
  props: LiveActivityProps,
  previousPhase: string | null,
  now = Date.now(),
): LiveUpdateSpec {
  return props.kind === "queue" ? queueSpec(props, previousPhase) : activitySpec(props, now);
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
