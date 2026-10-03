import type { OutgoingHttpHeaders } from "node:http";
import { EVENTS, REALTIME_LIMITS, SSE_TOPICS, type SseEnvelope } from "@hackos/shared/events";
import client from "@prometheus-io/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { TooManyRequestsError } from "./errors.js";
import { register } from "./metrics.js";
import { laneForSseTopic, metricTopicForSse, type RequestLane } from "./request-lanes.js";
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
const SEQUENCE_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const HEARTBEAT_INTERVAL_MS = 25_000;
const localSubscribers = new Map<string, Set<FastifyReply>>();
const subscriberLanes = new Map<FastifyReply, RequestLane>();
export interface SseSubscription {
  topic: string;
  scope: string;
}
type Multiplexed = {
  subscriptions: readonly SseSubscription[];
  authorize: () => Promise<void>;
  pending: string[];
  bytes: number;
  checking: boolean;
  closed: boolean;
  disconnectReason?: string;
};
const multiplexed = new Map<FastifyReply, Multiplexed>();
let relayStarted = false;
let relayStarting: Promise<void> | null = null;

// Connection budgets (H540): reject before hijacking the response, so a
// rejection is a normal Fastify JSON error rather than an aborted stream.
let globalConnCount = 0;
const clientConnCounts = new Map<string, number>();

// Backpressure (H540): tracks a reply currently waiting to drain, so repeat
// writes to the same slow client are skipped instead of piling up.
const draining = new Map<FastifyReply, NodeJS.Timeout>();

new client.Gauge({
  name: "hackos_sse_local_connections",
  help: "SSE connections currently held open by this process, by priority lane and topic family",
  labelNames: ["lane", "topic"],
  registers: [register],
  collect() {
    this.reset();
    const countsByLabel = new Map<RequestLane, Map<string, number>>();
    const seen = new Set<FastifyReply>();
    for (const [topic, conns] of localSubscribers) {
      const metricTopic = metricTopicForSse(topic);
      for (const reply of conns) {
        if (seen.has(reply)) continue;
        seen.add(reply);
        const lane = subscriberLanes.get(reply) ?? laneForSseTopic(topic);
        let topicCounts = countsByLabel.get(lane);
        if (!topicCounts) {
          topicCounts = new Map();
          countsByLabel.set(lane, topicCounts);
        }
        const label = multiplexed.has(reply) ? "multiplexed" : metricTopic;
        topicCounts.set(label, (topicCounts.get(label) ?? 0) + 1);
      }
    }
    for (const [lane, topicCounts] of countsByLabel) {
      for (const [topic, count] of topicCounts) {
        this.set({ lane, topic }, count);
      }
    }
  },
});
new client.Gauge({
  name: "hackos_sse_local_subscriptions",
  help: "Logical SSE topic attachments, separate from physical connections",
  labelNames: ["topic"],
  registers: [register],
  collect() {
    this.reset();
    const counts = new Map<string, number>();
    for (const [topic, replies] of localSubscribers) {
      const label = metricTopicForSse(topic);
      let attachments = 0;
      for (const reply of replies)
        attachments +=
          multiplexed
            .get(reply)
            ?.subscriptions.filter((subscription) => subscription.topic === topic).length ?? 1;
      counts.set(label, (counts.get(label) ?? 0) + attachments);
    }
    for (const [topic, count] of counts) this.set({ topic }, count);
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

const sseWritesTotal = new client.Counter({
  name: "hackos_sse_writes_total",
  help: "Physical SSE writes by frame kind",
  labelNames: ["kind"],
  registers: [register],
});
const sseWriteBytesTotal = new client.Counter({
  name: "hackos_sse_write_bytes_total",
  help: "Physical SSE frame bytes written",
  registers: [register],
});
const sseReauthorizationsTotal = new client.Counter({
  name: "hackos_sse_reauthorizations_total",
  help: "Multiplexed delivery/heartbeat access checks by outcome",
  labelNames: ["outcome"],
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

/**
 * A TV wall needs queue/TV state *and* public content, but it should not
 * hold two sockets. Keep `/api/content/stream` for content-only consumers
 * while mirroring its payload-free invalidation onto the TV channel too.
 */
export function publicInvalidationsFor(topic: string): PublicInvalidation[] {
  const primary = publicInvalidationFor(topic);
  if (!primary) return [];
  if (topic !== SSE_TOPICS.CONTENT) return [primary];
  return [primary, { topic: SSE_TOPICS.PUBLIC_TV, type: EVENTS.DATA_CHANGED, data: {} }];
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
  sseWritesTotal.inc({
    kind: chunk.startsWith(": ping")
      ? "heartbeat"
      : chunk.startsWith(": connected")
        ? "connection"
        : "event",
  });
  sseWriteBytesTotal.inc(Buffer.byteLength(chunk));
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
  if (!relayStarting) {
    relayStarting = valkeySub
      .psubscribe(`${CHANNEL_PREFIX}*`)
      .then(() => {
        relayStarted = true;
      })
      .finally(() => {
        relayStarting = null;
      });
  }
  await relayStarting;
}

// Install the relay once. ioredis automatically restores subscriptions after
// reconnect; if the initial PSUBSCRIBE fails, ensureRelay() remains retryable.
valkeySub.on("pmessage", (_pattern, channel, message) => {
  const topic = channel.slice(CHANNEL_PREFIX.length);
  const conns = localSubscribers.get(topic);
  if (!conns?.size) return;
  for (const reply of conns) {
    const state = multiplexed.get(reply);
    if (!state) {
      writeChunk(reply, message);
      continue;
    }
    const dataLine = message.split("\n").find((line) => line.startsWith("data: "));
    if (!dataLine) continue;
    let envelope: SseEnvelope;
    try {
      envelope = JSON.parse(dataLine.slice(6)) as SseEnvelope;
    } catch {
      continue;
    }
    for (const subscription of state.subscriptions) {
      if (subscription.topic !== topic) continue;
      const frame = `data: ${JSON.stringify({ ...envelope, topic: subscription.scope })}\n\n`;
      state.bytes += Buffer.byteLength(frame);
      if (state.bytes > REALTIME_LIMITS.MAX_BUFFER_BYTES) {
        state.disconnectReason = "buffer_limit";
        reply.raw.destroy();
        break;
      }
      state.pending.push(frame);
    }
    void flushAuthorized(reply, state);
  }
});

/** Bound pending authorization writes and fail closed before delivering payloads (#892). */
async function flushAuthorized(reply: FastifyReply, state: Multiplexed): Promise<void> {
  if (state.checking || state.closed) return;
  state.checking = true;
  const batch = state.pending.splice(0);
  try {
    await state.authorize();
    sseReauthorizationsTotal.inc({ outcome: "allowed" });
    if (state.closed) return;
    for (const frame of batch) writeChunk(reply, frame);
  } catch {
    state.disconnectReason = "authorization_failed";
    sseReauthorizationsTotal.inc({ outcome: "denied" });
    reply.raw.destroy();
  } finally {
    state.bytes -= batch.reduce((size, frame) => size + Buffer.byteLength(frame), 0);
    state.checking = false;
    if (!state.closed && state.pending.length) void flushAuthorized(reply, state);
  }
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
    const sequenceKey = `sse:seq:${topic}`;
    const seq = await valkey.incr(sequenceKey);
    // Sequence IDs only need to bridge reconnects/gap detection. Retaining
    // them forever would make an ephemeral broker's keyspace grow with every
    // topic ever created; refreshing this TTL on activity keeps the active
    // event window safe while allowing old topics to disappear.
    await valkey.expire(sequenceKey, SEQUENCE_RETENTION_SECONDS);
    const envelope: SseEnvelope<T> = {
      type,
      id: String(seq),
      at: new Date().toISOString(),
      data,
    };
    await valkey.publish(`${CHANNEL_PREFIX}${topic}`, formatSse(envelope));
    // Public walls see only their relevant, payload-free invalidation. This is
    // intentionally separate from authenticated domain refresh notifications.
    for (const publicInvalidation of publicInvalidationsFor(topic)) {
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
  return attachSubscriptions([{ topic, scope: topic }], req, reply);
}

export async function subscribeMany(
  subscriptions: readonly SseSubscription[],
  req: FastifyRequest,
  reply: FastifyReply,
  authorize: () => Promise<void>,
): Promise<void> {
  return attachSubscriptions(subscriptions, req, reply, authorize);
}

async function attachSubscriptions(
  subscriptions: readonly SseSubscription[],
  req: FastifyRequest,
  reply: FastifyReply,
  authorize?: () => Promise<void>,
): Promise<void> {
  await ensureRelay();
  const topics = [...new Set(subscriptions.map((subscription) => subscription.topic))];
  if (globalConnCount >= config.SSE_MAX_CONNECTIONS_GLOBAL) {
    sseRejectionsTotal.inc({ scope: "global" });
    throw new TooManyRequestsError("SSE connection budget exhausted");
  }
  for (const topic of topics)
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
  writeChunk(reply, authorize ? `: connected\n\n` : `: connected topic=${topics[0]}\n\n`);

  for (const topic of topics) {
    let conns = localSubscribers.get(topic);
    if (!conns) {
      conns = new Set();
      localSubscribers.set(topic, conns);
    }
    conns.add(reply);
  }
  const lane = topics.map(laneForSseTopic).sort()[0] ?? "P1";
  subscriberLanes.set(reply, lane);
  const state: Multiplexed | undefined = authorize
    ? {
        subscriptions,
        authorize,
        pending: [],
        bytes: 0,
        checking: false,
        closed: false,
      }
    : undefined;
  if (state) multiplexed.set(reply, state);
  globalConnCount++;
  clientConnCounts.set(clientKey, clientCount + 1);

  const heartbeat = setInterval(() => {
    if (state) void flushAuthorized(reply, state);
    writeChunk(reply, `: ping\n\n`);
  }, HEARTBEAT_INTERVAL_MS);

  reply.raw.once("close", () => {
    clearInterval(heartbeat);
    const timer = draining.get(reply);
    if (timer) {
      clearTimeout(timer);
      draining.delete(reply);
      sseDisconnectsTotal.inc({ reason: "slow_client" });
    } else {
      sseDisconnectsTotal.inc({ reason: state?.disconnectReason ?? "normal" });
    }
    if (state) {
      state.closed = true;
      state.pending.length = 0;
    }
    multiplexed.delete(reply);
    for (const topic of topics) {
      const conns = localSubscribers.get(topic);
      conns?.delete(reply);
      if (conns?.size === 0) localSubscribers.delete(topic);
    }
    subscriberLanes.delete(reply);

    globalConnCount--;
    const remaining = (clientConnCounts.get(clientKey) ?? 1) - 1;
    if (remaining <= 0) clientConnCounts.delete(clientKey);
    else clientConnCounts.set(clientKey, remaining);
  });
}
