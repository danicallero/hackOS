/**
 * Realtime event contract (plan/03 Fase 0). Everything pushed over SSE — TV
 * screens (H41-H42), operator panels (H31, H34), participant queue status
 * (H38) — is one of these envelopes, serialized as the SSE `data:` payload
 * with the envelope `type` as the SSE event name.
 *
 * Topics are logical subscription channels; a physical SSE connection may
 * carry several independently authorized scopes. Fan-out across API instances rides Valkey pub/sub on
 * `sse:<namespace>:<topic>`.
 */

export const SSE_TOPICS = {
  /** everything queue/judging: entry transitions, room state (H29-H35, H41) */
  QUEUE: "queue",
  /** synthetic review-fixture queue events; never mirrored to public TV */
  QUEUE_FIXTURE: "queue:fixture",
  /** collaborative review changes for one queue entry (H36) */
  QUEUE_REVIEW_PREFIX: "queue-review:",
  /** TV mode switches (H42) */
  TV: "tv",
  /** schedule + announcements changes (H47, H50) */
  CONTENT: "content",
  /** payload-free public invalidations caused by queue or TV domain changes */
  PUBLIC_TV: "public-tv",
  /** payload-free public invalidations caused by public-content changes */
  PUBLIC_CONTENT: "public-content",
  /** application and response changes (H11-H15) */
  APPLICATIONS: "applications",
  /** projects, repositories and imports (H16-H21) */
  PROJECTS: "projects",
  /** identity, invitations and permission graph changes (H7-H10) */
  IDENTITY: "identity",
  /** authenticated sponsor, enterprise and challenge changes (H43-H46) */
  SPONSORS: "sponsors",
  /** accreditation, presence, meals and wallet updates (H22-H28) */
  LOGISTICS: "logistics",
  /** staff export/deletion request workflow admin dashboard (H54) */
  EXPORTS: "exports",
  /** audit log changes (H53) */
  AUDIT: "audit",
  /** per-user channel, suffixed with the user id: `user:42` (H31, H38) */
  USER_PREFIX: "user:",
} as const;

export interface SseEnvelope<T = unknown> {
  /** Logical scope on multiplexed streams; absent on legacy streams. */
  topic?: string;
  /** event name, e.g. "queue.entry.status_changed" */
  type: string;
  /** Monotonic per-topic sequence for gap detection; no replay or global cursor. */
  id: string;
  /** ISO timestamp when emitted */
  at: string;
  data: T;
}

// Canonical event names. Emitters must use these constants.
export const EVENTS = {
  QUEUE_ENTRY_CHANGED: "queue.entry.status_changed", // any queue_entries transition
  QUEUE_ROOM_CHANGED: "queue.room.state_changed", // pause/resume/settings
  QUEUE_REVIEW_CHANGED: "queue.review.changed", // H36 collaborative review save
  QUEUE_NOTIFY_ENTER: "queue.entry.notify_enter", // H31
  QUEUE_TEAM_CALLED: "queue.entry.team_called", // H29/H38, operator-facing echo of a "called" transition
  TV_MODE_CHANGED: "tv.mode.changed", // H42: operator-selected current TV display
  TV_CONFIG_CHANGED: "tv.config.changed", // H42: venue TV config (display language) was edited
  CONTENT_SCHEDULE_CHANGED: "content.schedule.changed", // H47 operational content event
  CONTENT_ANNOUNCEMENT: "content.announcement", // H50 operational content event
  /** Payload-free invalidation used only on public mirror topics. */
  DATA_CHANGED: "data.changed",
  /** Payload-free refresh signal on a domain-scoped authenticated topic. */
  DOMAIN_CHANGED: "domain.changed",
  /** Client-only signal: a lossy stream requires an authoritative refetch. */
  REALTIME_RESYNC: "realtime.resync",
  LOGISTICS_ACCREDITED: "logistics.accreditation.checked_in", // H22
  LOGISTICS_BADGE_ROTATED: "logistics.badge.rotated", // H23/H28
  LOGISTICS_PRESENCE_SCAN: "logistics.presence.scan", // H24
  LOGISTICS_ACTIVITY_SCAN: "logistics.activity.scan", // H25/H26
  LOGISTICS_MEAL_SCAN_BATCH: "logistics.meal_scan_batch.processed", // H25
  LOGISTICS_WALLET_PASS_UPDATED: "logistics.wallet_pass.updated", // H28
  LOGISTICS_MEAL_PLAN_UPDATED: "logistics.meal_plan.updated", // #933, { activityIds } only
  USER_QUEUE_CALLED: "user.queue.called", // H29/H38 "go wait at room X"
  USER_QUEUE_PRECALL: "user.queue.precall", // H38 pre-aviso
  USER_QUEUE_CHANGED: "user.queue.changed", // H38: one of the user's challenge queues changed
  USER_QUEUE_MESSAGE: "user.queue.message", // H46: free-text message from staff/sponsor about an evaluation
  USER_NOTIFICATION: "user.notification", // generic in-app inbox push
  /** Refresh the current account's session facts (roles, capabilities, affiliations). */
  USER_SESSION_CHANGED: "user.session.changed",
  EXPORT_REQUEST_CHANGED: "exports.request.status_changed", // H54
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/** Public scope identifiers accepted by /api/realtime/stream (#892). Never Valkey topics. */
export const REALTIME_SCOPES = {
  PERSONAL: "personal",
  QUEUE: "queue",
  LOGISTICS: "logistics",
  EXPORTS: "exports",
  PUBLIC_TV: "public-tv",
  PUBLIC_CONTENT: "public-content",
  REVIEW_PREFIX: "review:",
  DOMAIN_PREFIX: "domain:",
} as const;
export const REALTIME_LIMITS = {
  MAX_SCOPES: 16,
  MAX_QUERY_LENGTH: 2048,
  MAX_BUFFER_BYTES: 64 * 1024,
  SUBSCRIPTION_DEBOUNCE_MS: 100,
} as const;

/** Translate legacy reader paths into logical scopes during installed-client migration. */
export function realtimeScopeForPath(path: string): string | null {
  const url = new URL(path, "http://realtime.invalid");
  switch (url.pathname) {
    case "/api/queue/me/stream":
      return REALTIME_SCOPES.PERSONAL;
    case "/api/queue/stream":
      return REALTIME_SCOPES.QUEUE;
    case "/api/logistics/stream":
      return REALTIME_SCOPES.LOGISTICS;
    case "/api/exports/stream":
      return REALTIME_SCOPES.EXPORTS;
    case "/api/tv/stream":
      return REALTIME_SCOPES.PUBLIC_TV;
    case "/api/content/stream":
      return REALTIME_SCOPES.PUBLIC_CONTENT;
    case "/api/events/stream":
      return `${REALTIME_SCOPES.DOMAIN_PREFIX}${url.searchParams.get("topic") ?? ""}`;
    default: {
      const entry = /^\/api\/queue\/entries\/([1-9]\d*)\/stream$/.exec(url.pathname);
      return entry ? `${REALTIME_SCOPES.REVIEW_PREFIX}${entry[1]}` : null;
    }
  }
}
