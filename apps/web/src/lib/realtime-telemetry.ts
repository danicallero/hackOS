import { API_URL } from "./env";

/**
 * Keep browser observations aligned with the API ingestion enums (H38, #544).
 * These values are deliberately not derived from a full URL or event payload:
 * IDs, query strings, user agents and arbitrary text must never leave the tab.
 */
export type RealtimeSurface =
  | "participant-queue"
  | "judging"
  | "logistics"
  | "public-tv"
  | "content";

export type RealtimeTopic =
  | "queue"
  | "queue-review"
  | "logistics"
  | "user"
  | "public-tv"
  | "public-content"
  | "content";

export type RealtimeRefetchTrigger = "sse" | "visibility" | "retry" | "manual";

export interface RealtimeTelemetryScope {
  surface: RealtimeSurface;
  topic: RealtimeTopic;
}

const REFRESH_STORM_WINDOW_SECONDS = 30;
const REFRESH_STORM_WINDOW_MS = REFRESH_STORM_WINDOW_SECONDS * 1_000;
const REFRESH_STORM_THRESHOLD = 10;
const TELEMETRY_PATH = "/api/telemetry/refetch-storm";

type RefetchObservation = {
  windowStart: number;
  refetches: number;
  trigger: RealtimeRefetchTrigger;
  reported: boolean;
};

type PhysicalConnectionObservation = {
  active: number;
  opened: number;
  closed: number;
};

const refetchObservations = new Map<string, RefetchObservation>();
const physicalConnections = new Map<RealtimeTopic, PhysicalConnectionObservation>();

function streamUrl(streamPath: string): URL | null {
  try {
    return new URL(streamPath, API_URL);
  } catch {
    return null;
  }
}

/**
 * Map only known stream paths to the server's bounded metric dimensions. The
 * path is used locally and the path itself is never included in a report.
 */
export function telemetryScopeForStream(streamPath: string): RealtimeTelemetryScope | null {
  const url = streamUrl(streamPath);
  if (!url) return null;

  if (url.pathname === "/api/queue/me/stream") {
    return { surface: "participant-queue", topic: "user" };
  }
  if (url.pathname.startsWith("/api/queue/entries/") && url.pathname.endsWith("/stream")) {
    return { surface: "judging", topic: "queue-review" };
  }
  if (url.pathname === "/api/queue/stream") {
    return { surface: "judging", topic: "queue" };
  }
  if (url.pathname === "/api/logistics/stream") {
    return { surface: "logistics", topic: "logistics" };
  }
  if (url.pathname === "/api/tv/stream") {
    return { surface: "public-tv", topic: "public-tv" };
  }
  if (url.pathname === "/api/content/stream") {
    return { surface: "content", topic: "public-content" };
  }

  // The generic domain stream has a bounded contract only for logistics. The
  // other domain names intentionally stay out until the API adds matching
  // telemetry enums rather than being mislabeled as another surface.
  if (url.pathname === "/api/events/stream" && url.searchParams.get("topic") === "logistics") {
    return { surface: "logistics", topic: "logistics" };
  }

  return null;
}

function scopeKey(scope: RealtimeTelemetryScope): string {
  return `${scope.surface}:${scope.topic}`;
}

function reportRefetchStorm(scope: RealtimeTelemetryScope, observation: RefetchObservation): void {
  // This endpoint is intentionally called directly. It is not a domain API
  // read, so routing it through apiFetch would make the diagnostic request
  // look like another refresh to any future request instrumentation (#544).
  let telemetryUrl: string;
  try {
    telemetryUrl = new URL(TELEMETRY_PATH, API_URL).toString();
  } catch {
    return;
  }
  void fetch(telemetryUrl, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      surface: scope.surface,
      topic: scope.topic,
      trigger: observation.trigger,
      refetches: observation.refetches,
      windowSeconds: REFRESH_STORM_WINDOW_SECONDS,
    }),
    keepalive: true,
  }).catch(() => {
    // Diagnostics are best effort. A telemetry outage must never affect the
    // read-model refresh it is observing or produce a feedback request.
  });
}

/**
 * Count actual read-model requests, not event frames. Once a scope reaches
 * the storm threshold, report one aggregate for the fixed window and suppress
 * further reports until the next window (H38, #544).
 */
export function observeRefetch(
  scope: RealtimeTelemetryScope | null,
  trigger: RealtimeRefetchTrigger,
  now = Date.now(),
): void {
  if (!scope) return;

  const windowStart = Math.floor(now / REFRESH_STORM_WINDOW_MS) * REFRESH_STORM_WINDOW_MS;
  const key = scopeKey(scope);
  const current = refetchObservations.get(key);
  const observation =
    current?.windowStart === windowStart
      ? current
      : {
          windowStart,
          refetches: 0,
          trigger,
          reported: false,
        };

  observation.refetches += 1;
  if (observation.refetches >= REFRESH_STORM_THRESHOLD && !observation.reported) {
    observation.trigger = trigger;
    observation.reported = true;
    reportRefetchStorm(scope, observation);
  }
  refetchObservations.set(key, observation);
}

/**
 * Physical source accounting is local-only: the API's SSE gauge is the server
 * source of truth, while this keeps browser tests and diagnostics honest about
 * the one-EventSource-per-topic/tab invariant (H41-H42, #544).
 */
export function observePhysicalSseConnection(streamPath: string, state: "opened" | "closed"): void {
  const scope = telemetryScopeForStream(streamPath);
  if (!scope) return;

  const current =
    physicalConnections.get(scope.topic) ??
    ({ active: 0, opened: 0, closed: 0 } satisfies PhysicalConnectionObservation);
  if (state === "opened") {
    current.active += 1;
    current.opened += 1;
  } else {
    current.active = Math.max(0, current.active - 1);
    current.closed += 1;
  }
  physicalConnections.set(scope.topic, current);
}

/** A narrow read-only snapshot used by focused broker tests and diagnostics. */
export function physicalSseConnectionStats(streamPath: string): PhysicalConnectionObservation {
  const scope = telemetryScopeForStream(streamPath);
  const current = scope ? physicalConnections.get(scope.topic) : undefined;
  return current ? { ...current } : { active: 0, opened: 0, closed: 0 };
}
