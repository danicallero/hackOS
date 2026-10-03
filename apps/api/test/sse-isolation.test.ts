import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { EVENTS } from "@hackos/shared/events";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Redis } from "ioredis";
import { afterAll, expect, it } from "vitest";
import { config } from "../src/config.js";
import { broadcast, subscribe, subscribeMany } from "../src/lib/sse.js";
import { closeValkey } from "../src/lib/valkey.js";

afterAll(closeValkey);

it("isolates relay namespaces across logical databases while preserving same-namespace fan-out (#897)", async () => {
  const topic = `isolation-${randomUUID()}`;
  const url = new URL(config.VALKEY_URL);
  url.pathname = url.pathname === "/13" ? "/12" : "/13";
  const publisher = new Redis(url.toString());
  const received: string[][] = [[], []];
  const replies = received.map((chunks) => {
    const raw = Object.assign(new EventEmitter(), {
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
      writeHead: () => undefined,
      destroy: () => raw.emit("close"),
    });
    return { raw, getHeaders: () => ({}) } as unknown as FastifyReply;
  });
  const req = { ip: "127.0.0.1", userId: null } as FastifyRequest;
  try {
    await subscribe(topic, req, replies[0]!);
    await subscribeMany([{ topic, scope: "personal" }], req, replies[1]!, async () => {});
    const frame = (id: string) =>
      `event: ${EVENTS.DATA_CHANGED}\nid: ${id}\ndata: ${JSON.stringify({ type: EVENTS.DATA_CHANGED, id, at: new Date().toISOString(), data: {} })}\n\n`;
    for (const channel of [
      `sse:${topic}`,
      `sse:${config.SSE_NAMESPACE}-other:${topic}`,
      `sse:${config.SSE_NAMESPACE}extra:${topic}`,
    ]) {
      await publisher.publish(channel, frame("foreign"));
    }
    // Same namespace still fans out across databases: SELECT cannot isolate Pub/Sub (#897).
    await publisher.publish(`sse:${config.SSE_NAMESPACE}:${topic}`, frame("same-namespace"));
    for (const chunks of received) {
      await expect.poll(() => chunks.join("")).toContain('"id":"same-namespace"');
      expect(chunks.join("")).not.toContain("foreign");
    }
    const envelope = await broadcast(topic, EVENTS.DATA_CHANGED, { local: true });
    expect(envelope).not.toBeNull();
    for (const chunks of received)
      await expect.poll(() => chunks.join("")).toContain('"local":true');
    expect(received[1]!.join("")).toContain('"topic":"personal"');
  } finally {
    for (const reply of replies) reply.raw.emit("close");
    await publisher.quit();
    const { valkey } = await import("../src/lib/valkey.js");
    await valkey.del(`sse:seq:${topic}`);
  }
});
