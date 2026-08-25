import client from "prom-client";
import type { RequestLane } from "./request-lanes.js";

/**
 * Shared Prometheus registry (H540). Pool and SSE modules register their own
 * gauges/histograms/counters onto this; scraped via GET /metrics (app.ts).
 */
export const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: "hackos_" });

/** Event-day metrics use only fixed lane/method/outcome labels (#544). */
export const httpRequestsTotal = new client.Counter({
  name: "hackos_http_requests_total",
  help: "HTTP requests started, by admission lane and method",
  labelNames: ["lane", "method"],
  registers: [register],
});

export const requestAdmissionWaitSeconds = new client.Histogram({
  name: "hackos_http_request_admission_wait_seconds",
  help: "Time spent waiting for a request admission slot, by lane",
  labelNames: ["lane"],
  buckets: [0, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
  registers: [register],
});

export const requestAdmissionQueueSize = new client.Gauge({
  name: "hackos_http_request_admission_queue_size",
  help: "Requests waiting for an admission slot, by lane",
  labelNames: ["lane"],
  registers: [register],
});

export const participantInvalidationsTotal = new client.Counter({
  name: "hackos_queue_participant_invalidations_total",
  help: "Participant queue invalidation jobs by outcome",
  labelNames: ["outcome"],
  registers: [register],
});

export const browserRefetchStormsTotal = new client.Counter({
  name: "hackos_browser_refetch_storms_total",
  help: "Low-cardinality browser reports of refetch storms",
  labelNames: ["surface", "topic", "trigger"],
  registers: [register],
});

export const browserRefetchesTotal = new client.Counter({
  name: "hackos_browser_refetches_total",
  help: "Refetch operations represented by browser refetch-storm reports",
  labelNames: ["surface", "topic", "trigger"],
  registers: [register],
});

export const browserRefetchStormWindowSeconds = new client.Histogram({
  name: "hackos_browser_refetch_storm_window_seconds",
  help: "Observation window represented by a browser refetch-storm report",
  labelNames: ["surface", "topic", "trigger"],
  buckets: [1, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

export function observeHttpRequest(lane: RequestLane, method: string): void {
  httpRequestsTotal.inc({ lane, method: method.toUpperCase() });
}

export function observeAdmissionWait(lane: RequestLane, seconds: number): void {
  requestAdmissionWaitSeconds.observe({ lane }, seconds);
}

export function setAdmissionQueueSize(lane: RequestLane, size: number): void {
  requestAdmissionQueueSize.set({ lane }, size);
}

export function observeParticipantInvalidation(
  outcome: "queued" | "coalesced" | "dropped" | "degraded",
): void {
  participantInvalidationsTotal.inc({ outcome });
}
