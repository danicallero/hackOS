import { EVENTS, SSE_TOPICS, type SseEnvelope } from "@hackos/shared/events";
import type { FastifyReply } from "fastify";
import type { OutgoingHttpHeaders } from "node:http";
import { invalidateReadCache } from "./read-cache.js";
import { valkey, valkeySub } from "./valkey.js";

/**
 * SSE hub (plan/03 Fase 0 contract, H41-H42). Publishers call `broadcast`;
 * every API instance relays via Valkey pub/sub (`sse:<topic>`) to its local
 * connections, so TVs and panels can hit any instance behind a balancer.
 *
 * Envelope ids are per-topic monotonic counters (Valkey INCR) so clients can
 * detect gaps after reconnect; SSE auto-reconnect + full-state refetch on the
 * consumer side is the recovery contract.
 */

const CHANNEL_PREFIX = "sse:";
const localSubscribers = new Map<string, Set<FastifyReply>>();
let relayStarted = false;

async function ensureRelay(): Promise<void> {
  if (relayStarted) return;
  relayStarted = true;
  await valkeySub.psubscribe(`${CHANNEL_PREFIX}*`);
  valkeySub.on("pmessage", (_pattern, channel, message) => {
    const topic = channel.slice(CHANNEL_PREFIX.length);
    const conns = localSubscribers.get(topic);
    if (!conns?.size) return;
    for (const reply of conns) {
      reply.raw.write(message);
    }
  });
}

function formatSse(envelope: SseEnvelope): string {
  return `event: ${envelope.type}\nid: ${envelope.id}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

/** Publish an event to every subscriber of `topic`, across instances. */
export async function broadcast<T>(topic: string, type: string, data: T): Promise<SseEnvelope<T>> {
  const seq = await valkey.incr(`sse:seq:${topic}`);
  const envelope: SseEnvelope<T> = {
    type,
    id: String(seq),
    at: new Date().toISOString(),
    data,
  };
  await valkey.publish(`${CHANNEL_PREFIX}${topic}`, formatSse(envelope));
  // Worker-originated changes do not have an HTTP response, so mirror every
  // domain event into the global refresh stream as well. The guard prevents
  // the mirror from recursively publishing itself.
  if (topic !== SSE_TOPICS.GLOBAL) {
    await invalidateReadCache();
    await broadcast(SSE_TOPICS.GLOBAL, EVENTS.DATA_CHANGED, { at: envelope.at });
  }
  return envelope;
}

/**
 * Attach a Fastify reply as an SSE subscriber of `topic`. Call from a GET
 * handler; the function keeps the connection open until the client drops.
 */
export async function subscribe(topic: string, reply: FastifyReply): Promise<void> {
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
  reply.raw.write(`: connected topic=${topic}\n\n`);

  let conns = localSubscribers.get(topic);
  if (!conns) {
    conns = new Set();
    localSubscribers.set(topic, conns);
  }
  conns.add(reply);

  const heartbeat = setInterval(() => {
    reply.raw.write(`: ping\n\n`);
  }, 25_000);

  reply.raw.on("close", () => {
    clearInterval(heartbeat);
    conns.delete(reply);
    if (conns.size === 0) localSubscribers.delete(topic);
  });
}
