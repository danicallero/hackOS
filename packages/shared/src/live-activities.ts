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
} as const;

export type LiveActivityKind = (typeof LIVE_ACTIVITY_KINDS)[keyof typeof LIVE_ACTIVITY_KINDS];

/**
 * `createLiveActivity` names on iOS. APNs `content-state.name` must match
 * them exactly or the activity silently never updates.
 */
export const LIVE_ACTIVITY_WIDGET_NAMES: Record<LiveActivityKind, string> = {
  queue: "QueueActivity",
  activity: "StaffActivity",
};

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
  /** Other queues this participant is still waiting in. */
  otherQueues: number;
  /** Deep link opened on tap. */
  url: string;
  labels: QueueLiveLabels;
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
  /** Deep link that opens the scanner bound to this activity. */
  scanUrl: string;
  /** Deep link opened on tap. */
  url: string;
  labels: ActivityLiveLabels;
  updatedAt: string;
}

export type LiveActivityProps = QueueLiveProps | ActivityLiveProps;

/** Response of `GET /api/me/live-activities`. */
export interface MyLiveActivities {
  /** False outside the judging window — the queue activity must not exist. */
  judgingWindowOpen: boolean;
  queue: QueueLiveProps | null;
  activities: ActivityLiveProps[];
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
  };
}

const QUEUE_LABELS: Record<Language, Omit<QueueLiveLabels, "moreQueues"> & { moreQueues: string }> =
  {
    en: {
      position: "Position",
      wait: "Wait",
      goTo: "Go to",
      inRoom: "In room",
      moreQueues: "+{count} more queues",
      minutes: "min",
    },
    es: {
      position: "Posición",
      wait: "Espera",
      goTo: "Ve a",
      inRoom: "En sala",
      moreQueues: "+{count} colas más",
      minutes: "min",
    },
    gl: {
      position: "Posición",
      wait: "Espera",
      goTo: "Vai a",
      inRoom: "Na sala",
      moreQueues: "+{count} colas máis",
      minutes: "min",
    },
  };

const ACTIVITY_LABELS: Record<Language, ActivityLiveLabels> = {
  en: { startsIn: "Starts in", scanned: "Scanned", scan: "Scan" },
  es: { startsIn: "Empieza en", scanned: "Escaneados", scan: "Escanear" },
  gl: { startsIn: "Comeza en", scanned: "Escaneados", scan: "Escanear" },
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
