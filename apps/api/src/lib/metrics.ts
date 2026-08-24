import client from "prom-client";

/**
 * Shared Prometheus registry (H540). Pool and SSE modules register their own
 * gauges/histograms/counters onto this; scraped via GET /metrics (app.ts).
 */
export const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: "hackos_" });
