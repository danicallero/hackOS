import { SSE_TOPICS } from "@hackos/shared/events";

export const REQUEST_LANES = ["P0", "P1", "P2", "P3"] as const;
export type RequestLane = (typeof REQUEST_LANES)[number];

export interface RequestLaneInput {
  method?: string;
  url: string;
  userId?: number | null;
}

const LANE_RANK: Record<RequestLane, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

export function requestLaneRank(lane: RequestLane): number {
  return LANE_RANK[lane];
}

function pathAndQuery(url: string): { path: string; query: URLSearchParams } {
  const [path = url, rawQuery = ""] = url.split("?", 2);
  return { path, query: new URLSearchParams(rawQuery) };
}

/**
 * Map a realtime topic to the service lane that owns its freshness work.
 * User and entry ids are intentionally not returned as metric labels.
 */
export function laneForSseTopic(topic: string): RequestLane {
  if (topic === SSE_TOPICS.QUEUE || topic === SSE_TOPICS.LOGISTICS || topic === SSE_TOPICS.AUDIT) {
    return "P0";
  }
  if (
    topic.startsWith(SSE_TOPICS.QUEUE_REVIEW_PREFIX) ||
    topic === SSE_TOPICS.PROJECTS ||
    topic === SSE_TOPICS.SPONSORS ||
    topic === SSE_TOPICS.EXPORTS ||
    topic === SSE_TOPICS.APPLICATIONS ||
    topic === SSE_TOPICS.IDENTITY
  ) {
    return "P1";
  }
  if (
    topic === SSE_TOPICS.PUBLIC_TV ||
    topic === SSE_TOPICS.PUBLIC_CONTENT ||
    topic === SSE_TOPICS.TV ||
    topic === SSE_TOPICS.CONTENT
  ) {
    return "P2";
  }
  if (topic.startsWith(SSE_TOPICS.USER_PREFIX)) return "P3";
  return "P1";
}

/**
 * Collapse identifier-bearing topics before they become Prometheus labels.
 * The stream itself still uses the complete topic for authorization/routing.
 */
export function metricTopicForSse(topic: string): string {
  if (topic.startsWith(SSE_TOPICS.USER_PREFIX)) return "user";
  if (topic.startsWith(SSE_TOPICS.QUEUE_REVIEW_PREFIX)) return "queue-review";
  return topic;
}

export function isSseRequest(url: string): boolean {
  return pathAndQuery(url).path.endsWith("/stream");
}

/**
 * Classify request work before route handlers run. Capability checks remain
 * the authorization boundary; this only determines which traffic receives a
 * bounded admission slot when the process is busy.
 */
export function classifyRequestLane(input: RequestLaneInput): RequestLane {
  const method = (input.method ?? "GET").toUpperCase();
  const { path, query } = pathAndQuery(input.url);

  if (path === "/healthz" || path === "/metrics") return "P2";

  if (path.startsWith("/api/public/")) return "P2";
  if (path === "/api/announcements/public" || path === "/api/content/stream") return "P2";
  if (path === "/api/tv/stream" || (path.startsWith("/api/tv/") && method === "GET")) {
    return "P2";
  }
  if (path === "/api/events/stream") return laneForSseTopic(query.get("topic") ?? "");

  if (path === "/api/queue/me" || path.startsWith("/api/queue/me/")) return "P3";
  if (
    path.startsWith("/api/queue/entries/") &&
    (path.includes("/review") || path.includes("/session") || path.endsWith("/stream"))
  ) {
    return "P1";
  }
  if (path.startsWith("/api/queue/reviews")) return "P1";
  if (path.startsWith("/api/queue/")) return "P0";

  if (
    path.startsWith("/api/logistics") ||
    path.startsWith("/api/accreditation") ||
    path.startsWith("/api/activities") ||
    path.startsWith("/api/scanner")
  ) {
    return "P0";
  }

  if (path === "/api/me" || path.startsWith("/api/me/") || path.startsWith("/api/auth/")) {
    return "P3";
  }

  if (
    path.startsWith("/api/challenges") ||
    path.startsWith("/api/enterprises") ||
    path.startsWith("/api/projects") ||
    path.startsWith("/api/repos") ||
    path.startsWith("/api/announcements") ||
    path.startsWith("/api/schedule") ||
    path.startsWith("/api/exports") ||
    path.startsWith("/api/event")
  ) {
    return "P1";
  }

  if (path.startsWith("/api/applications")) return "P1";
  return input.userId == null && method === "GET" ? "P2" : "P3";
}
