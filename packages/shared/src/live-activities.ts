/**
 * Live Activity / Live Update contract (#966; H38 queue, H25/H26 staff
 * activities). The API builds these states — one builder feeds both the
 * read endpoint and the pushes — and the mobile app only renders them, on iOS
 * as ActivityKit Live Activities (`expo-widgets`) and on Android as promoted
 * ongoing notifications (`modules/live-updates`).
 *
 * The iOS widget extension runs without the app's i18n bundle, so every
 * user-visible string travels pre-localized inside the props (`labels`).
 * Keep payloads small: ActivityKit caps a push at 4 KB.
 */
import type { Language } from "./locale.js";

export const LIVE_ACTIVITY_KINDS = {
  QUEUE: "queue",
  ACTIVITY: "activity",
  ATTENDEE_ACTIVITY: "attendee_activity",
  DEADLINE: "deadline",
  ACCREDITATION: "accreditation",
} as const;

export type LiveActivityKind = (typeof LIVE_ACTIVITY_KINDS)[keyof typeof LIVE_ACTIVITY_KINDS];

/**
 * `createLiveActivity` names on iOS. APNs `content-state.name` must match
 * them exactly or the activity silently never updates.
 */
export const LIVE_ACTIVITY_WIDGET_NAMES: Record<LiveActivityKind, string> = {
  queue: "QueueActivity",
  activity: "StaffActivity",
  attendee_activity: "AttendeeActivity",
  deadline: "DeadlineActivity",
  accreditation: "AccreditationActivity",
};

/**
 * Kinds organizers configure (`GET/PUT /api/live-activities/settings`), in
 * their default priority order. Same ids as `LiveActivityKind`.
 */
export const LIVE_ACTIVITY_CONFIG_KINDS = [
  "activity",
  "attendee_activity",
  "queue",
  "accreditation",
  "deadline",
] as const;

export type LiveActivityConfigKind = (typeof LIVE_ACTIVITY_CONFIG_KINDS)[number];

export interface LiveActivityKindSetting {
  kind: LiveActivityConfigKind;
  enabled: boolean;
  /** 0 = highest priority. */
  priority: number;
  /** Roles allowed to receive it (H8 roles table ids). */
  roleIds: number[];
  /** Intrinsic capability still required on top of the role (null = none), shown read-only in the UI. */
  requiredCapability: string | null;
}

export interface LiveActivitySettings {
  /** Most Live Activities one device shows at once (1–5). */
  maxConcurrent: number;
  /**
   * Minutes before a schedule item starts that its staff or attendee Live
   * Activity appears (H25, H26, H59): the organizer override, else the
   * deployment default.
   */
  leadMinutes: number;
  /** The deployment default (`LIVE_ACTIVITY_LEAD_MINUTES`) used without an override. */
  defaultLeadMinutes: number;
  /** True when an organizer override is stored. */
  leadMinutesCustom: boolean;
  /**
   * The other organizer-set timings (deadline and accreditation windows),
   * each the override or, without one, the default.
   */
  timings: Record<LiveActivityTimingKey, LiveActivityTiming>;
  /** Sorted by priority. */
  kinds: LiveActivityKindSetting[];
  /**
   * Every assignable (non-deleted) role, highest position first, with the
   * same raw `name` `GET /api/roles` returns — so the settings UI can render
   * role checkboxes without the roles-manager capability.
   */
  roles: { id: number; name: string }[];
}

/**
 * `GET/PUT /api/me/live-activities/preferences`: the kinds the caller may
 * receive (enabled, role-allowed, capability held), in the caller's priority
 * order, with their own on/off choice.
 */
export interface MyLiveActivityPreferences {
  kinds: { kind: LiveActivityConfigKind; enabled: boolean }[];
  /** True when the caller reordered the kinds; false = the organizer order. */
  customOrder: boolean;
}

/** Bounds of `LiveActivitySettings.maxConcurrent`. */
export const LIVE_ACTIVITY_MAX_CONCURRENT_MIN = 1;
export const LIVE_ACTIVITY_MAX_CONCURRENT_MAX = 5;

/**
 * Event-set Live Activity timings besides the schedule lead (H19, H20, H22).
 * `deadlineLead`: minutes before submissions close that the deadline activity
 * appears when `hacking_starts_at` is unset; `deadlineClosing`: minutes left
 * when an unsubmitted team's activity turns urgent; `accreditationLead` and
 * `accreditationTail`: minutes before the event starts / after hacking starts
 * that the desk activity is open.
 */
export const LIVE_ACTIVITY_TIMING_KEYS = [
  "deadlineLead",
  "deadlineClosing",
  "accreditationLead",
  "accreditationTail",
] as const;
export type LiveActivityTimingKey = (typeof LIVE_ACTIVITY_TIMING_KEYS)[number];

export const LIVE_ACTIVITY_TIMING_RANGES: Record<
  LiveActivityTimingKey,
  { min: number; max: number }
> = {
  deadlineLead: { min: 15, max: 1440 },
  deadlineClosing: { min: 1, max: 240 },
  accreditationLead: { min: 0, max: 1440 },
  accreditationTail: { min: 0, max: 1440 },
};

/** Default of `deadlineClosing` (there is no deployment variable for it). */
export const DEADLINE_CLOSING_MINUTES_DEFAULT = 15;

export interface LiveActivityTiming {
  /** The override when `custom`, else the default. */
  value: number;
  default: number;
  custom: boolean;
}

/** Bounds of `LiveActivitySettings.leadMinutes`. */
export const LIVE_ACTIVITY_LEAD_MINUTES_MIN = 0;
export const LIVE_ACTIVITY_LEAD_MINUTES_MAX = 240;

/** Subject key of the single queue Live Activity a participant can have. */
export const QUEUE_LIVE_ACTIVITY_SUBJECT = "judging";

export function activityLiveActivitySubject(activityId: number): string {
  return `activity:${activityId}`;
}

/** Bump when a props shape changes incompatibly; renderers ignore unknown versions. */
export const LIVE_ACTIVITY_PROPS_VERSION = 1;

export type QueueLivePhase = "waiting" | "called" | "in_room";

export interface QueueLiveLabels {
  /** "Position" */
  position: string;
  /** "Wait" */
  wait: string;
  /** "Go to" — prefixes the room once called. */
  goTo: string;
  /** "In room" */
  inRoom: string;
  /** "+{count} more queues" with `{count}` already substituted, or null. */
  moreQueues: string | null;
  /** Minutes unit, e.g. "min". */
  minutes: string;
  /** "Called" — labels the time elapsed since the call. Optional: added after v1 shipped. */
  called?: string;
  /** "Estimating…" — active placeholder while the ETA is unknown, never an empty value. */
  estimating?: string;
  /** Progress track stage names: "In line", "Called", "In room". Optional. */
  stageInLine?: string;
  stageCalled?: string;
  stageInRoom?: string;
}

export interface QueueLiveProps {
  v: typeof LIVE_ACTIVITY_PROPS_VERSION;
  kind: "queue";
  phase: QueueLivePhase;
  entryId: number;
  challengeTitle: string;
  /** Null once called. */
  position: number | null;
  /** Estimate, not a deadline — rendered as `~N min`, never a ticking timer. Null once called. */
  etaMinutes: number | null;
  /** Only set once called (H29): the concrete room the team must go to. */
  roomName: string | null;
  roomLocation: string | null;
  /**
   * ISO instant the team was called (H34 shows operators the same elapsed
   * time); null while waiting. Rendered as a count-up timer, not a deadline.
   * Optional: added after v1 shipped.
   */
  calledAt?: string | null;
  /**
   * Teams in this queue (shared group included), judged or still to go;
   * null unless waiting. The track fills the "In line" segment to
   * `(queueTotal - position + 1) / (queueTotal + 1)`. Optional (post-v1).
   */
  queueTotal?: number | null;
  /**
   * Teams called earlier to the same room and not yet in it; null unless
   * called. The track fills the "Called" segment to `2 / (calledAhead + 3)`.
   * Optional (post-v1).
   */
  calledAhead?: number | null;
  /** Other queues this participant is still waiting in. */
  otherQueues: number;
  /** Deep link opened on tap. */
  url: string;
  labels: QueueLiveLabels;
  /** Device rank among the Live Activities it shows (0 = most important). Optional (post-v1). */
  rank?: number;
  /** ISO timestamp the server computed this state. */
  updatedAt: string;
}

export type ActivityLivePhase = "upcoming" | "live";

/** One hour, the boundary between the two countdown forms. */
export const LIVE_COUNTDOWN_HOUR_MS = 3_600_000;

/** Ten minutes, where the minutes field drops to one digit. */
export const LIVE_COUNTDOWN_TEN_MINUTES_MS = 600_000;

function countdownMsLeft(target: string | Date, now: Date | number): number {
  const at = typeof target === "string" ? Date.parse(target) : target.getTime();
  return at - (typeof now === "number" ? now : now.getTime());
}

/**
 * Whether the countdown to `target` is under an hour (#966). The iOS widget
 * shows `2h 34m` from an hour and `34m` below it, and picks the form only
 * when it renders, so the props carry this flag: it flips once, at the hour,
 * which changes the state hash and sends the one update that re-renders the
 * widget in the shorter form.
 */
export function countdownUnderHour(target: string | Date, now: Date | number): boolean {
  const at = typeof target === "string" ? Date.parse(target) : target.getTime();
  const from = typeof now === "number" ? now : now.getTime();
  return at - from < LIVE_COUNTDOWN_HOUR_MS;
}

/** #966: re-render once when seconds become relevant on iOS countdowns. */
export function countdownLastFiveMinutes(target: string | Date, now: Date | number): boolean {
  return countdownMsLeft(target, now) <= 300_000;
}

/** #966: re-render below a minute; active shows `48s`, Always-On shows `<1m`. */
export function countdownLastMinute(target: string | Date, now: Date | number): boolean {
  return countdownMsLeft(target, now) < 60_000;
}

/** #966: re-render under ten minutes, when the minutes field shrinks to one digit (`9m`). */
export function countdownUnderTenMinutes(target: string | Date, now: Date | number): boolean {
  return countdownMsLeft(target, now) < LIVE_COUNTDOWN_TEN_MINUTES_MS;
}

/** #966: re-render under ten seconds, when the seconds field shrinks to one digit (`9s`). */
export function countdownLastTenSeconds(target: string | Date, now: Date | number): boolean {
  return countdownMsLeft(target, now) < 10_000;
}

/**
 * #966: from an hour up, the minutes-of-hour are a single digit (`1h 5m`, not
 * `1h 05m`). It flips off at each full hour (`2h 0m` to `1h 59m`) and on ten
 * minutes later, so the widget re-renders with the field width that fits.
 */
export function countdownShortMinutes(target: string | Date, now: Date | number): boolean {
  const left = countdownMsLeft(target, now);
  return (
    left >= LIVE_COUNTDOWN_HOUR_MS && left % LIVE_COUNTDOWN_HOUR_MS < LIVE_COUNTDOWN_TEN_MINUTES_MS
  );
}

/** The precision flags carried by every countdown-bearing Live Activity props. */
export interface CountdownFlags {
  countdownUnderHour: boolean;
  countdownShortMinutes: boolean;
  countdownUnderTenMinutes: boolean;
  countdownLastFiveMinutes: boolean;
  countdownLastMinute: boolean;
  countdownLastTenSeconds: boolean;
}

export const COUNTDOWN_FLAG_KEYS = [
  "countdownUnderHour",
  "countdownShortMinutes",
  "countdownUnderTenMinutes",
  "countdownLastFiveMinutes",
  "countdownLastMinute",
  "countdownLastTenSeconds",
] as const satisfies readonly (keyof CountdownFlags)[];

export function countdownFlags(target: string | Date, now: Date | number): CountdownFlags {
  return {
    countdownUnderHour: countdownUnderHour(target, now),
    countdownShortMinutes: countdownShortMinutes(target, now),
    countdownUnderTenMinutes: countdownUnderTenMinutes(target, now),
    countdownLastFiveMinutes: countdownLastFiveMinutes(target, now),
    countdownLastMinute: countdownLastMinute(target, now),
    countdownLastTenSeconds: countdownLastTenSeconds(target, now),
  };
}

const SMALL_COUNTDOWN_THRESHOLDS_MS = [10_000, 60_000, 300_000, LIVE_COUNTDOWN_TEN_MINUTES_MS];

/**
 * The next instant (epoch ms) at which a countdown to `target` crosses a
 * format boundary after `now`: ten seconds, a minute, five minutes, ten
 * minutes, and from an hour up every full hour and ten minutes past it. A
 * `countdown*` flag has flipped shortly after it, so the surface re-renders
 * then (#966). Null when none is left (the target itself is the caller's).
 */
export function nextCountdownBoundary(target: string | Date, now: Date | number): number | null {
  const at = typeof target === "string" ? Date.parse(target) : target.getTime();
  const left = countdownMsLeft(target, now);
  if (!Number.isFinite(at) || !Number.isFinite(left)) return null;
  const candidates = [...SMALL_COUNTDOWN_THRESHOLDS_MS];
  if (left > LIVE_COUNTDOWN_HOUR_MS) {
    const hours = Math.floor(left / LIVE_COUNTDOWN_HOUR_MS);
    for (const k of [hours, hours - 1]) {
      candidates.push(
        k * LIVE_COUNTDOWN_HOUR_MS,
        k * LIVE_COUNTDOWN_HOUR_MS + LIVE_COUNTDOWN_TEN_MINUTES_MS,
      );
    }
  }
  let best = 0;
  for (const threshold of candidates) if (threshold < left && threshold > best) best = threshold;
  return best > 0 ? at - best : null;
}

export interface ActivityLiveLabels {
  /** "Starts in" */
  startsIn: string;
  /** "Scanned" */
  scanned: string;
  /** "Scan" — the single action. */
  scan: string;
  /** "Ends in" — labels the live countdown to the end. Optional: added after v1 shipped. */
  endsIn?: string;
  /**
   * "Live" — marks the activity as running, once it starts (`phase: live`, or
   * an upcoming state iOS marks stale at `startsAt`). Optional (post-v1).
   */
  live?: string;
}

export interface ActivityLiveProps {
  v: typeof LIVE_ACTIVITY_PROPS_VERSION;
  kind: "activity";
  phase: ActivityLivePhase;
  activityId: number;
  name: string;
  /** Activity category (`meal`, `talk`, …) — picks the SF Symbol / Android icon. */
  category: string;
  location: string | null;
  /** ISO timestamps from the linked schedule row. */
  startsAt: string;
  endsAt: string;
  /** Distinct people registered so far (first-time scans). */
  scanned: number;
  /**
   * Live only (H24/H25): accredited people (active accounts with a badge, the
   * desk's `accredited`), the denominator shown as `scanned/accredited`. Null
   * before the start or when unknown. Optional (post-v1).
   */
  accredited?: number | null;
  /** Deep link that opens the scanner bound to this activity. */
  scanUrl: string;
  /** Deep link opened on tap. */
  url: string;
  labels: ActivityLiveLabels;
  /** The countdown shown is under an hour (`countdownUnderHour`). Optional (post-v1). */
  countdownUnderHour?: boolean;
  /** From an hour up, minutes-of-hour are one digit (`1h 5m`); see `countdownShortMinutes`. */
  countdownShortMinutes?: boolean;
  /** Under ten minutes the minutes field is one digit (`9m`). */
  countdownUnderTenMinutes?: boolean;
  /** Re-render at five minutes remaining (`4:05`); minutes only in Always-On. */
  countdownLastFiveMinutes?: boolean;
  /** Re-render below a minute, with seconds alone or `<1m` in Always-On. */
  countdownLastMinute?: boolean;
  /** Under ten seconds the seconds field is one digit (`9s`). */
  countdownLastTenSeconds?: boolean;
  /** Device rank among the Live Activities it shows (0 = most important). Optional (post-v1). */
  rank?: number;
  updatedAt: string;
}

// ── Attendee activity (H59, #966) ─────────────────────────────────────────

/** Subject of the attendee Live Activity for a schedule item. */
export function attendeeActivityLiveActivitySubject(scheduleId: number): string {
  return `schedule:${scheduleId}`;
}

export type AttendeeActivityLivePhase = "upcoming" | "live";

export interface AttendeeActivityLiveLabels {
  /** "Starts in" — labels the countdown while upcoming. */
  startsIn: string;
  /** "Now" — marks the item as running on app builds without `live`. */
  now: string;
  /** "Ends in" — labels the countdown to the end while live. */
  endsIn: string;
  /**
   * "Live" — the running badge (compact, minimal, Lock Screen), once it
   * starts (`phase: live`, or an upcoming state iOS marks stale at
   * `startsAt`). Optional (post-v1); renderers fall back to `now`.
   */
  live?: string;
}

/**
 * A schedule item organizers opted into Live Activities
 * (`schedule.live_activity_audience`), for the people it is shown to. No
 * buttons: the whole surface opens the item.
 */
export interface AttendeeActivityLiveProps {
  v: typeof LIVE_ACTIVITY_PROPS_VERSION;
  kind: "attendee_activity";
  /** `upcoming` before `startsAt` (countdown), `live` until `endsAt` ("Now · ends in"). */
  phase: AttendeeActivityLivePhase;
  scheduleId: number;
  /** Localized title (requested language, English, then the authored title). */
  name: string;
  /** Schedule category (`meal`, `talk`, …) — picks the SF Symbol / Android icon. */
  category: string;
  location: string | null;
  /** ISO instants; devices tick both countdowns locally. */
  startsAt: string;
  endsAt: string;
  /** Deep link: `hackos://schedule/<scheduleId>`. */
  url: string;
  labels: AttendeeActivityLiveLabels;
  /** The countdown shown is under an hour (`countdownUnderHour`). Optional (post-v1). */
  countdownUnderHour?: boolean;
  /** From an hour up, minutes-of-hour are one digit (`1h 5m`); see `countdownShortMinutes`. */
  countdownShortMinutes?: boolean;
  /** Under ten minutes the minutes field is one digit (`9m`). */
  countdownUnderTenMinutes?: boolean;
  /** Re-render at five minutes remaining (`4:05`); minutes only in Always-On. */
  countdownLastFiveMinutes?: boolean;
  /** Re-render below a minute, with seconds alone or `<1m` in Always-On. */
  countdownLastMinute?: boolean;
  /** Under ten seconds the seconds field is one digit (`9s`). */
  countdownLastTenSeconds?: boolean;
  /** Device rank among the Live Activities it shows (0 = most important). */
  rank?: number;
  updatedAt: string;
}

// ── Submission deadline (H19, H20, #966) ──────────────────────────────────

export const DEADLINE_LIVE_ACTIVITY_SUBJECT = "deadline";

/**
 * `open`: counting down. `closing`: the final minutes while the team's
 * hackOS project is known to be unsubmitted (the one alerting update).
 * `submitted`: every project the participant belongs to is submitted.
 */
export type DeadlineLivePhase = "open" | "closing" | "submitted";

export interface DeadlineLiveLabels {
  /** "Submissions close" — the title. */
  title: string;
  /** "Closes in" — labels the countdown. */
  closesIn: string;
  /** "Submitted" — the done state. */
  submitted: string;
  /** "Not submitted" — shown in `closing`. */
  notSubmitted: string;
}

export interface DeadlineLiveProps {
  v: typeof LIVE_ACTIVITY_PROPS_VERSION;
  kind: "deadline";
  phase: DeadlineLivePhase;
  /** ISO start of the hacking window (progress bar start), or null when unset. */
  startsAt: string | null;
  /** ISO submission deadline (`event_config.hacking_ends_at`); devices tick the countdown. */
  endsAt: string;
  /**
   * The participant's hackOS project status: `submitted` when every project
   * or work group they belong to is submitted, `draft` when one is not, null
   * when they have no project — render no status then, never "not submitted".
   */
  submission: "submitted" | "draft" | null;
  /** Name of the project the status refers to (the unsubmitted one first), or null. */
  projectName: string | null;
  /** Deep link: `hackos://project`. */
  url: string;
  labels: DeadlineLiveLabels;
  /** The countdown shown is under an hour (`countdownUnderHour`). Optional (post-v1). */
  countdownUnderHour?: boolean;
  /** From an hour up, minutes-of-hour are one digit (`1h 5m`); see `countdownShortMinutes`. */
  countdownShortMinutes?: boolean;
  /** Under ten minutes the minutes field is one digit (`9m`). */
  countdownUnderTenMinutes?: boolean;
  /** Re-render at five minutes remaining (`4:05`); minutes only in Always-On. */
  countdownLastFiveMinutes?: boolean;
  /** Re-render below a minute, with seconds alone or `<1m` in Always-On. */
  countdownLastMinute?: boolean;
  /** Under ten seconds the seconds field is one digit (`9s`). */
  countdownLastTenSeconds?: boolean;
  rank?: number;
  updatedAt: string;
}

// ── Accreditation desk (H22, H24, H27, #966) ──────────────────────────────

export const ACCREDITATION_LIVE_ACTIVITY_SUBJECT = "accreditation";

export interface AccreditationLiveLabels {
  /** "Accreditation" — the title. */
  title: string;
  /** "Accredited" — labels `accredited` / `eligible`. */
  accredited: string;
  /** "Inside" — labels the presence estimate. */
  inside: string;
  /** "Last 10 min" — labels `recentArrivals`. */
  lastTenMinutes: string;
  /** "Scan" — the single action. */
  scan: string;
}

export interface AccreditationLiveProps {
  v: typeof LIVE_ACTIVITY_PROPS_VERSION;
  kind: "accreditation";
  /** Single phase: the desk window is open. */
  phase: "live";
  /** People with a badge assigned (H22). */
  accredited: number;
  /** People with event access — the denominator of the progress ring. */
  eligible: number;
  /** H24 presence estimate; null for a review-fixture operator. */
  inside: number | null;
  /** Badges assigned in the last 10 minutes (desk pace). */
  recentArrivals: number;
  /** ISO end of the accreditation window (the activity ends then). */
  endsAt: string;
  /** Deep link that opens the accreditation scanner: `hackos://scan`. */
  scanUrl: string;
  url: string;
  labels: AccreditationLiveLabels;
  rank?: number;
  updatedAt: string;
}

export type LiveActivityProps =
  | QueueLiveProps
  | ActivityLiveProps
  | AttendeeActivityLiveProps
  | DeadlineLiveProps
  | AccreditationLiveProps;

/**
 * Notification push categories that announce a change a Live Activity shows:
 * the participant's queue (H29 call and pre-call) and schedule reminders
 * (`schedule:<id>`, H59). The API marks their iOS pushes `content-available`
 * and the app refreshes its Live Activities when one arrives, in case the
 * activity's own APNs update is late.
 */
export function isLiveActivityPushCategory(category: unknown): boolean {
  return typeof category === "string" && (category === "queue" || category.startsWith("schedule:"));
}

/**
 * ActivityKit relevance for a device rank (0 = most important): the
 * highest score leads the Dynamic Island and the Lock Screen order. The API
 * sends it as APNs `relevance-score` and the app passes it on every local
 * start and update, which would otherwise reset it to 0.
 */
export function relevanceForRank(rank: number | undefined): number {
  return Math.max(1, 100 - 10 * (rank ?? 0));
}

/** The queue has no end instant; the server refreshes it well within this. */
export const LIVE_ACTIVITY_OPEN_ENDED_STALE_MS = 30 * 60 * 1000;

/**
 * ActivityKit marks an activity stale on a non-waking timer one minute after
 * its `staleDate` (observed: `liveactivitiesd` "Marking activities stale" is
 * scheduled at staleDate + 60 s), so a state meant to turn stale at an
 * instant asks for it this much earlier.
 */
export const LIVE_ACTIVITY_STALE_LEEWAY_MS = 60_000;

/**
 * ActivityKit `staleDate` of a state, sent as APNs `stale-date` and passed on
 * every local start and update (#966). An upcoming staff or attendee activity
 * goes stale at its start (H25, H26, H59; requested a leeway earlier, see
 * above): iOS re-renders it then with `isStale`, and the widget shows the
 * live layout on time, without waiting for the push that flips `phase`.
 * Everything else goes stale at its own end, or, for the queue, 30 minutes
 * ahead.
 */
export function liveActivityStaleDate(props: LiveActivityProps, now: Date | number): Date {
  if (props.kind === "queue") {
    return new Date(
      (typeof now === "number" ? now : now.getTime()) + LIVE_ACTIVITY_OPEN_ENDED_STALE_MS,
    );
  }
  if (
    (props.kind === "activity" || props.kind === "attendee_activity") &&
    props.phase === "upcoming"
  ) {
    return new Date(Date.parse(props.startsAt) - LIVE_ACTIVITY_STALE_LEEWAY_MS);
  }
  return new Date(props.endsAt);
}

/**
 * Response of `GET /api/me/live-activities`: what this device should show
 * now, after kind configuration, role gating and the per-device
 * `maxConcurrent` cut. Every field added after v1 is optional for older
 * readers; `rank` orders the whole set.
 */
export interface MyLiveActivities {
  /** False outside the judging window — the queue activity must not exist. */
  judgingWindowOpen: boolean;
  queue: QueueLiveProps | null;
  activities: ActivityLiveProps[];
  attendeeActivities?: AttendeeActivityLiveProps[];
  deadline?: DeadlineLiveProps | null;
  accreditation?: AccreditationLiveProps | null;
  /** The configured per-device limit the response already applies. */
  maxConcurrent?: number;
}

/**
 * Data-only push sent to Android devices (Expo push `data`). The app's
 * background notification task renders it through `modules/live-updates`.
 */
export interface AndroidLiveUpdateMessage {
  hackosLiveUpdate: {
    event: "start" | "update" | "end";
    kind: LiveActivityKind;
    subject: string;
    /** Absent on `end`. */
    props?: LiveActivityProps;
    /** Device rank (0 = most important), for the notification sort key; absent on `end`. */
    rank?: number;
  };
}

const QUEUE_LABELS: Record<
  Language,
  Required<Omit<QueueLiveLabels, "moreQueues">> & { moreQueues: string }
> = {
  en: {
    position: "Position",
    wait: "Wait",
    goTo: "Go to",
    inRoom: "In room",
    moreQueues: "+{count} more queues",
    minutes: "min",
    called: "Called",
    estimating: "Estimating…",
    stageInLine: "In line",
    stageCalled: "Called",
    stageInRoom: "In room",
  },
  es: {
    position: "Posición",
    wait: "Espera",
    goTo: "Ve a",
    inRoom: "En sala",
    moreQueues: "+{count} colas más",
    minutes: "min",
    called: "Llamados",
    estimating: "Calculando…",
    stageInLine: "En cola",
    stageCalled: "Llamados",
    stageInRoom: "En sala",
  },
  gl: {
    position: "Posición",
    wait: "Espera",
    goTo: "Vai a",
    inRoom: "Na sala",
    moreQueues: "+{count} colas máis",
    minutes: "min",
    called: "Chamados",
    estimating: "Calculando…",
    stageInLine: "Na cola",
    stageCalled: "Chamados",
    stageInRoom: "Na sala",
  },
};

const ACTIVITY_LABELS: Record<Language, Required<ActivityLiveLabels>> = {
  en: {
    startsIn: "Starts in",
    scanned: "Scanned",
    scan: "Scan",
    endsIn: "Ends in",
    live: "Live",
  },
  es: {
    startsIn: "Empieza en",
    scanned: "Escaneados",
    scan: "Escanear",
    endsIn: "Acaba en",
    live: "En curso",
  },
  gl: {
    startsIn: "Comeza en",
    scanned: "Escaneados",
    scan: "Escanear",
    endsIn: "Remata en",
    live: "En curso",
  },
};

export function queueLiveLabels(lang: Language, otherQueues: number): QueueLiveLabels {
  const base = QUEUE_LABELS[lang];
  return {
    ...base,
    moreQueues: otherQueues > 0 ? base.moreQueues.replace("{count}", String(otherQueues)) : null,
  };
}

export function activityLiveLabels(lang: Language): ActivityLiveLabels {
  return ACTIVITY_LABELS[lang];
}

const ATTENDEE_ACTIVITY_LABELS: Record<Language, Required<AttendeeActivityLiveLabels>> = {
  en: { startsIn: "Starts in", now: "Now", endsIn: "Ends in", live: "Live" },
  es: { startsIn: "Empieza en", now: "Ahora", endsIn: "Acaba en", live: "En curso" },
  gl: { startsIn: "Comeza en", now: "Agora", endsIn: "Remata en", live: "En curso" },
};

const DEADLINE_LABELS: Record<Language, DeadlineLiveLabels> = {
  en: {
    title: "Submissions close",
    closesIn: "Closes in",
    submitted: "Submitted",
    notSubmitted: "Not submitted",
  },
  es: {
    title: "Cierre de entregas",
    closesIn: "Cierra en",
    submitted: "Entregado",
    notSubmitted: "Sin entregar",
  },
  gl: {
    title: "Peche de entregas",
    closesIn: "Pecha en",
    submitted: "Entregado",
    notSubmitted: "Sen entregar",
  },
};

const ACCREDITATION_LABELS: Record<Language, AccreditationLiveLabels> = {
  en: {
    title: "Accreditation",
    accredited: "Accredited",
    inside: "Inside",
    lastTenMinutes: "Last 10 min",
    scan: "Scan",
  },
  es: {
    title: "Acreditación",
    accredited: "Acreditados",
    inside: "Dentro",
    lastTenMinutes: "Últimos 10 min",
    scan: "Escanear",
  },
  gl: {
    title: "Acreditación",
    accredited: "Acreditados",
    inside: "Dentro",
    lastTenMinutes: "Últimos 10 min",
    scan: "Escanear",
  },
};

export function attendeeActivityLiveLabels(lang: Language): AttendeeActivityLiveLabels {
  return ATTENDEE_ACTIVITY_LABELS[lang];
}

export function deadlineLiveLabels(lang: Language): DeadlineLiveLabels {
  return DEADLINE_LABELS[lang];
}

export function accreditationLiveLabels(lang: Language): AccreditationLiveLabels {
  return ACCREDITATION_LABELS[lang];
}
