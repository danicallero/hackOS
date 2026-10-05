import client from "@prometheus-io/client";
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

export const httpResponsesTotal = new client.Counter({
  name: "hackos_http_responses_total",
  help: "HTTP responses completed, by admission lane, method, route and status class",
  labelNames: ["lane", "method", "route", "status_class"],
  registers: [register],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: "hackos_http_request_duration_seconds",
  help: "HTTP request duration, by admission lane, method, route and status class",
  labelNames: ["lane", "method", "route", "status_class"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

export const httpRequestsInFlight = new client.Gauge({
  name: "hackos_http_requests_in_flight",
  help: "HTTP requests currently executing, excluding long-lived SSE streams",
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

export const notificationOutboxRows = new client.Gauge({
  name: "hackos_notification_outbox_rows",
  help: "Notification outbox rows by channel and durable status",
  labelNames: ["channel", "status"],
  registers: [register],
});

export const notificationOutboxOldestQueuedSeconds = new client.Gauge({
  name: "hackos_notification_outbox_oldest_queued_seconds",
  help: "Age of the oldest queued notification outbox row, by channel",
  labelNames: ["channel"],
  registers: [register],
});

export const notificationOutboxOverdueSeconds = new client.Gauge({
  name: "hackos_notification_outbox_overdue_seconds",
  help: "Seconds since the oldest queued notification became due, excluding future retries",
  labelNames: ["channel"],
  registers: [register],
});

export const operationalCollectionSuccess = new client.Gauge({
  name: "hackos_operational_collection_success",
  help: "Whether this scrape successfully refreshed a dependency's operational metrics",
  labelNames: ["dependency"],
  registers: [register],
});

export const notificationDispatchTotal = new client.Counter({
  name: "hackos_notification_dispatch_total",
  help: "Notification outbox dispatch outcomes by channel",
  labelNames: ["channel", "outcome"],
  registers: [register],
});

export const postgresConnections = new client.Gauge({
  name: "hackos_postgres_connections",
  help: "PostgreSQL sessions visible to the application, by state",
  labelNames: ["state"],
  registers: [register],
});

export const postgresMaxConnections = new client.Gauge({
  name: "hackos_postgres_max_connections",
  help: "PostgreSQL max_connections setting",
  registers: [register],
});

export const postgresSharedBuffersBytes = new client.Gauge({
  name: "hackos_postgres_shared_buffers_bytes",
  help: "PostgreSQL shared_buffers setting in bytes",
  registers: [register],
});

export const postgresEffectiveCacheSizeBytes = new client.Gauge({
  name: "hackos_postgres_effective_cache_size_bytes",
  help: "PostgreSQL effective_cache_size planner hint in bytes",
  registers: [register],
});

export const postgresDatabaseSizeBytes = new client.Gauge({
  name: "hackos_postgres_database_size_bytes",
  help: "Current PostgreSQL database size in bytes",
  labelNames: ["database"],
  registers: [register],
});

export const valkeyConnected = new client.Gauge({
  name: "hackos_valkey_connected",
  help: "Whether the API Valkey command client is ready",
  registers: [register],
});

export const valkeyUsedMemoryBytes = new client.Gauge({
  name: "hackos_valkey_used_memory_bytes",
  help: "Valkey used memory in bytes",
  registers: [register],
});

export const valkeyMaxmemoryBytes = new client.Gauge({
  name: "hackos_valkey_maxmemory_bytes",
  help: "Valkey configured maxmemory in bytes",
  registers: [register],
});

export const valkeyEvictedKeysTotal = new client.Gauge({
  name: "hackos_valkey_evicted_keys_total",
  help: "Valkey evicted keys since process start",
  registers: [register],
});

export const valkeyKeyspaceHitsTotal = new client.Gauge({
  name: "hackos_valkey_keyspace_hits_total",
  help: "Valkey keyspace hits since process start",
  registers: [register],
});

export const valkeyKeyspaceMissesTotal = new client.Gauge({
  name: "hackos_valkey_keyspace_misses_total",
  help: "Valkey keyspace misses since process start",
  registers: [register],
});

export const valkeyConnectedClients = new client.Gauge({
  name: "hackos_valkey_connected_clients",
  help: "Valkey connected client count",
  registers: [register],
});

export const containerMemoryLimitBytes = new client.Gauge({
  name: "hackos_container_memory_limit_bytes",
  help: "Memory limit visible to the API container; zero means unlimited",
  labelNames: ["resource"],
  registers: [register],
});

export const containerMemoryCurrentBytes = new client.Gauge({
  name: "hackos_container_memory_current_bytes",
  help: "Current memory usage visible to the API container",
  labelNames: ["resource"],
  registers: [register],
});

export const containerMemoryUnlimited = new client.Gauge({
  name: "hackos_container_memory_unlimited",
  help: "Whether the API container has an unlimited memory limit",
  labelNames: ["resource"],
  registers: [register],
});

export function observeHttpRequest(lane: RequestLane, method: string): void {
  httpRequestsTotal.inc({ lane, method: method.toUpperCase() });
}

export function observeHttpResponse(
  lane: RequestLane,
  method: string,
  route: string,
  statusCode: number,
  durationSeconds: number,
): void {
  const labels = {
    lane,
    method: method.toUpperCase(),
    route,
    status_class: `${Math.floor(statusCode / 100)}xx`,
  };
  httpResponsesTotal.inc(labels);
  httpRequestDurationSeconds.observe(labels, durationSeconds);
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
