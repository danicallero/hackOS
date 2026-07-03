/**
 * Realtime event contract (plan/03 Fase 0). Everything pushed over SSE — TV
 * screens (H41-H42), operator panels (H31, H34), participant queue status
 * (H38) — is one of these envelopes, serialized as the SSE `data:` payload
 * with the envelope `type` as the SSE event name.
 *
 * Topics are coarse subscription channels; one SSE connection subscribes to
 * one topic. Fan-out across API instances rides Valkey pub/sub on
 * `sse:<topic>`.
 */

export const SSE_TOPICS = {
  /** everything queue/judging: entry transitions, room state (H29-H35, H41) */
  QUEUE: "queue",
  /** TV mode switches (H42) */
  TV: "tv",
  /** schedule + announcements changes (H47, H50) */
  CONTENT: "content",
  /** per-user channel, suffixed with the user id: `user:42` (H31, H38) */
  USER_PREFIX: "user:",
} as const;

export interface SseEnvelope<T = unknown> {
  /** event name, e.g. "queue.entry.status_changed" */
  type: string;
  /** monotonic per-topic sequence for client resume via Last-Event-ID */
  id: string;
  /** ISO timestamp when emitted */
  at: string;
  data: T;
}

// Canonical event names. Emitters must use these constants.
export const EVENTS = {
  QUEUE_ENTRY_CHANGED: "queue.entry.status_changed", // any queue_entries transition
  QUEUE_ROOM_CHANGED: "queue.room.state_changed", // pause/resume/settings
  QUEUE_NOTIFY_ENTER: "queue.entry.notify_enter", // H31
  TV_MODE_CHANGED: "tv.mode.changed", // H42
  CONTENT_SCHEDULE_CHANGED: "content.schedule.changed", // H47
  CONTENT_ANNOUNCEMENT: "content.announcement", // H50
  USER_QUEUE_CALLED: "user.queue.called", // H29/H38 "go wait at room X"
  USER_QUEUE_PRECALL: "user.queue.precall", // H38 pre-aviso
  USER_NOTIFICATION: "user.notification", // generic in-app inbox push
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
