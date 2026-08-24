import type { OutgoingHttpHeaders } from "node:http";
import { EVENTS, SSE_TOPICS, type SseEnvelope } from "@hackos/shared/events";
import type { FastifyReply, FastifyRequest } from "fastify";
import client from "prom-client";
import { config } from "../config.js";
import { TooManyRequestsError } from "./errors.js";
import { register } from "./metrics.js";
import { valkey, valkeySub } from "./valkey.js";

/**
 * SSE hub (plan/03 Fase 0 contract, H41-H42). Publishers call `broadcast`;
 * every API instance relays via Valkey pub/sub (`sse:<topic>`) to its local
 * connections, so TVs and panels can hit any instance behind a balancer.
 *
 * Envelope ids are per-topic monotonic counters (Valkey INCR) so clients can
 * detect gaps after reconnect; SSE auto-reconnect + full-state refetch on the
 * consumer side is the recovery contract — this is why a backpressured
 * client is disconnected (below) rather than buffered indefinitely.
 */

const CHANNEL_PREFIX = "sse:";
const HEARTBEAT_INTERVAL_MS = 25_000;
const localSubscribers = new Map<string, Set<FastifyReply>>();
let relayStarted = false;

// Connection budgets (H540): reject before hijacking the response, so a
// rejection is a normal Fastify JSON error rather than an aborted stream.
let globalConnCount = 0;
const clientConnCounts = new Map<string, number>();

// Backpressure (H540): tracks a reply currently waiting to drain, so repeat
// writes to the same slow client are skipped instead of piling up.
const draining = new Map<FastifyReply, NodeJS.Timeout>();

new client.Gauge({
  name: "hackos_sse_local_connections",
  help: "SSE connections currently held open by this process, by topic",
  labelNames: ["topic"],
  registers: [register],
  collect() {
    this.reset();
    for (const [topic, conns] of localSubscribers) {
      this.set({ topic }, conns.size);
    }
  },
});
const sseDisconnectsTotal = new client.Counter({
  name: "hackos_sse_disconnects_total",
  help: "SSE connections closed, by reason",
  labelNames: ["reason"],
  registers: [register],
});
const sseRejectionsTotal = new client.Counter({
  name: "hackos_sse_rejections_total",
  help: "SSE subscribe() calls rejected for exceeding a connection budget",
  labelNames: ["scope"],
  registers: [register],
});

export interface PublicInvalidation {
  topic: string;
  type: typeof EVENTS.DATA_CHANGED;
  data: Record<string, never>;
}

/**
 * The only domain-to-public mirrors. Keep this mapping narrow: public screens
 * must not observe unrelated logistics, identity, export, or private activity.
 */
export function publicInvalidationFor(topic: string): PublicInvalidation | null {
  if (topic === SSE_TOPICS.QUEUE || topic === SSE_TOPICS.TV) {
    return { topic: SSE_TOPICS.PUBLIC_TV, type: EVENTS.DATA_CHANGED, data: {} };
  }
  if (topic === SSE_TOPICS.CONTENT) {
    return { topic: SSE_TOPICS.PUBLIC_CONTENT, type: EVENTS.DATA_CHANGED, data: {} };
  }
  return null;
}

function isPublicInvalidationTopic(topic: string): boolean {
  return topic === SSE_TOPICS.PUBLIC_TV || topic === SSE_TOPICS.PUBLIC_CONTENT;
}

function assertPayloadFreePublicInvalidation(topic: string, type: string, data: unknown): void {
  if (!isPublicInvalidationTopic(topic)) return;
  if (
    type !== EVENTS.DATA_CHANGED ||
    typeof data !== "object" ||
    data === null ||
    Array.isArray(data) ||
    Object.keys(data).length !== 0
  ) {
    throw new Error(`Public SSE topic ${topic} accepts only an empty data.changed invalidation`);
  }
}

/**
 * Write a chunk to one SSE reply, disconnecting the client if it can't keep
 * up. If `reply.raw.write()` reports its kernel buffer is full, wait up to
 * `SSE_WRITE_TIMEOUT_MS` for `drain`; if it doesn't arrive in time, destroy
 * the connection (triggers the normal `close` cleanup below) instead of
 * buffering unboundedly. While a reply is draining, further writes to it are
 * skipped rather than queued.
 */
function writeChunk(reply: FastifyReply, chunk: string): void {
  if (draining.has(reply)) return;
  const ok = reply.raw.write(chunk);
  if (ok) return;

  // Left in `draining` until `close` fires, so the close handler can tell a
  // slow-client disconnect apart from a normal one; cleared here only on a
  // successful drain (connection continues).
  const timer = setTimeout(() => {
    reply.raw.destroy();
  }, config.SSE_WRITE_TIMEOUT_MS);
  reply.raw.once("drain", () => {
    clearTimeout(timer);
    draining.delete(reply);
  });
  draining.set(reply, timer);
}

async function ensureRelay(): Promise<void> {
  if (relayStarted) return;
  relayStarted = true;
  await valkeySub.psubscribe(`${CHANNEL_PREFIX}*`);
  valkeySub.on("pmessage", (_pattern, channel, message) => {
    const topic = channel.slice(CHANNEL_PREFIX.length);
    const conns = localSubscribers.get(topic);
    if (!conns?.size) return;
    for (const reply of conns) {
      writeChunk(reply, message);
    }
  });
}

function formatSse(envelope: SseEnvelope): string {
  return `event: ${envelope.type}\nid: ${envelope.id}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

/**
 * Publish an event to every subscriber of `topic`, across instances.
 *
 * Every domain call site awaits this *after* its own `withTransaction` has
 * already committed (scan recorded, badge assigned, presence logged, …) —
 * broadcasting is a best-effort notification on top of an already-durable
 * write, never a precondition for it. So a Valkey hiccup here must not turn
 * an already-successful mutation into a failed HTTP response: I/O failures
 * are caught and logged, returning `null` instead of throwing. A caller
 * passing a malformed payload to a public topic is a programming error, not
 * infra flakiness, so `assertPayloadFreePublicInvalidation` still throws
 * synchronously, before any I/O.
 */
export async function broadcast<T>(
  topic: string,
  type: string,
  data: T,
): Promise<SseEnvelope<T> | null> {
  assertPayloadFreePublicInvalidation(topic, type, data);
  try {
    const seq = await valkey.incr(`sse:seq:${topic}`);
    const envelope: SseEnvelope<T> = {
      type,
      id: String(seq),
      at: new Date().toISOString(),
      data,
    };
    await valkey.publish(`${CHANNEL_PREFIX}${topic}`, formatSse(envelope));
    // Public walls see only their relevant, payload-free invalidation. This is
    // intentionally separate from authenticated domain refresh notifications.
    const publicInvalidation = publicInvalidationFor(topic);
    if (publicInvalidation) {
      await broadcast(publicInvalidation.topic, publicInvalidation.type, publicInvalidation.data);
    }
    return envelope;
  } catch (err) {
    console.error(`[sse] broadcast(${topic}, ${type}) failed`, err);
    return null;
  }
}

function clientKeyFor(req: FastifyRequest): string {
  return req.userId != null ? `user:${req.userId}` : `ip:${req.ip}`;
}

/**
 * Attach a Fastify reply as an SSE subscriber of `topic`. Call from a GET
 * handler; the function keeps the connection open until the client drops.
 *
 * Enforces global/per-topic/per-client connection budgets (H540) before
 * touching the response, so a rejection is a normal `TooManyRequestsError`
 * JSON response rather than an aborted stream.
 */
export async function subscribe(
  topic: string,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (globalConnCount >= config.SSE_MAX_CONNECTIONS_GLOBAL) {
    sseRejectionsTotal.inc({ scope: "global" });
    throw new TooManyRequestsError("SSE connection budget exhausted");
  }
  if ((localSubscribers.get(topic)?.size ?? 0) >= config.SSE_MAX_CONNECTIONS_PER_TOPIC) {
    sseRejectionsTotal.inc({ scope: "topic" });
    throw new TooManyRequestsError(`SSE connection budget exhausted for topic ${topic}`);
  }
  const clientKey = clientKeyFor(req);
  const clientCount = clientConnCounts.get(clientKey) ?? 0;
  if (clientCount >= config.SSE_MAX_CONNECTIONS_PER_CLIENT) {
    sseRejectionsTotal.inc({ scope: "client" });
    throw new TooManyRequestsError("SSE connection budget exhausted for this client");
  }

  await ensureRelay();
  // `@fastify/cors` stores its headers on Fastify's reply object.  Writing
  // straight to `reply.raw` bypasses Fastify's normal response serialization,
  // so preserve those already-computed headers before taking over the socket.
  // Without this, credentialed cross-origin EventSource requests are rejected
  // by the browser even though the SSE connection itself is healthy.
  reply.raw.writeHead(200, {
    ...(reply.getHeaders() as OutgoingHttpHeaders),
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  writeChunk(reply, `: connected topic=${topic}\n\n`);

  let conns = localSubscribers.get(topic);
  if (!conns) {
    conns = new Set();
    localSubscribers.set(topic, conns);
  }
  conns.add(reply);
  globalConnCount++;
  clientConnCounts.set(clientKey, clientCount + 1);

  const heartbeat = setInterval(() => {
    writeChunk(reply, `: ping\n\n`);
  }, HEARTBEAT_INTERVAL_MS);

  reply.raw.on("close", () => {
    clearInterval(heartbeat);
    const timer = draining.get(reply);
    if (timer) {
      clearTimeout(timer);
      draining.delete(reply);
      sseDisconnectsTotal.inc({ reason: "slow_client" });
    } else {
      sseDisconnectsTotal.inc({ reason: "normal" });
    }
    conns.delete(reply);
    if (conns.size === 0) localSubscribers.delete(topic);
    globalConnCount--;
    const remaining = (clientConnCounts.get(clientKey) ?? 1) - 1;
    if (remaining <= 0) clientConnCounts.delete(clientKey);
    else clientConnCounts.set(clientKey, remaining);
  });
}
