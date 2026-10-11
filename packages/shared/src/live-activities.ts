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
  /** Sorted by priority. */
  kinds: LiveActivityKindSetting[];
  /**
   * Every assignable (non-deleted) role, highest position first, with the
   * same raw `name` `GET /api/roles` returns — so the settings UI can render
   * role checkboxes without the roles-manager capability.
   */
  roles: { id: number; name: string }[];
}

/** Bounds of `LiveActivitySettings.maxConcurrent`. */
export const LIVE_ACTIVITY_MAX_CONCURRENT_MIN = 1;
export const LIVE_ACTIVITY_MAX_CONCURRENT_MAX = 5;

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

export interface ActivityLiveLabels {
  /** "Starts in" */
  startsIn: string;
  /** "Scanned" */
  scanned: string;
  /** "Scan" — the single action. */
  scan: string;
  /** "Ends in" — labels the live countdown to the end. Optional: added after v1 shipped. */
  endsIn?: string;
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
  /** "Now" — marks the item as running. */
  now: string;
  /** "Ends in" — labels the countdown to the end while live. */
  endsIn: string;
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
   * when they have none in hackOS (e.g. a Devpost-only team, not imported
   * yet) — render no status then, never "not submitted".
   */
  submission: "submitted" | "draft" | null;
  /** Name of the project the status refers to (the unsubmitted one first), or null. */
  projectName: string | null;
  /** Deep link: `hackos://project`. */
  url: string;
  labels: DeadlineLiveLabels;
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
  },
  es: {
    startsIn: "Empieza en",
    scanned: "Escaneados",
    scan: "Escanear",
    endsIn: "Acaba en",
  },
  gl: {
    startsIn: "Comeza en",
    scanned: "Escaneados",
    scan: "Escanear",
    endsIn: "Remata en",
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

const ATTENDEE_ACTIVITY_LABELS: Record<Language, AttendeeActivityLiveLabels> = {
  en: { startsIn: "Starts in", now: "Now", endsIn: "Ends in" },
  es: { startsIn: "Empieza en", now: "Ahora", endsIn: "Acaba en" },
  gl: { startsIn: "Comeza en", now: "Agora", endsIn: "Remata en" },
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
