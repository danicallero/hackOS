import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  browserRefetchesTotal,
  browserRefetchStormsTotal,
  browserRefetchStormWindowSeconds,
} from "../../lib/metrics.js";
import { routeAccessOption as routeAccess } from "../../lib/route-policy.js";

/**
 * Browser refetch-storm observations (H38, H41-H42, #544). The enums are the
 * ingestion contract: they keep labels bounded and deliberately exclude
 * account ids, full URLs, user agents, project/team ids and arbitrary text.
 */
export const browserRefetchStormBody = z.object({
  surface: z.enum(["participant-queue", "judging", "logistics", "public-tv", "content"]),
  topic: z.enum([
    "queue",
    "queue-review",
    "logistics",
    "user",
    "public-tv",
    "public-content",
    "content",
  ]),
  trigger: z.enum(["sse", "visibility", "retry", "manual"]),
  refetches: z.number().int().min(1).max(1000),
  windowSeconds: z.number().int().min(1).max(300),
});

export type BrowserRefetchStorm = z.infer<typeof browserRefetchStormBody>;

export function recordBrowserRefetchStorm(observation: BrowserRefetchStorm): void {
  const labels = {
    surface: observation.surface,
    topic: observation.topic,
    trigger: observation.trigger,
  };
  browserRefetchStormsTotal.inc(labels);
  browserRefetchesTotal.inc(labels, observation.refetches);
  browserRefetchStormWindowSeconds.observe(labels, observation.windowSeconds);
}

export function registerTelemetryModule(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.post(
    "/api/telemetry/refetch-storm",
    {
      ...routeAccess({ kind: "public", anonymousCategory: "telemetry" }),
      schema: {
        summary: "Record a bounded browser refetch-storm observation",
        description:
          "Optional browser signal for diagnosing duplicate or bursty refetches. " +
          "Send only the documented enum values and aggregate counts; never send a " +
          "user id, URL, user agent, team/project id or arbitrary text. Clients " +
          "should report at most once per surface/topic/window.",
        body: browserRefetchStormBody,
      },
    },
    async (req) => {
      recordBrowserRefetchStorm(req.body);
      return { accepted: true };
    },
  );
}
