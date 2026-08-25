import { EventEmitter } from "node:events";
import type { FastifyReply, FastifyRequest } from "fastify";
import { afterAll, describe, expect, it } from "vitest";

const { register } = await import("../src/lib/metrics.js");
const { subscribe } = await import("../src/lib/sse.js");
const { closeValkey } = await import("../src/lib/valkey.js");

afterAll(async () => {
  await closeValkey();
});

type FakeRaw = EventEmitter & {
  write: (chunk: string) => boolean;
  writeHead: (...args: unknown[]) => void;
  destroy: () => void;
};

function fakeReply(): FastifyReply {
  const raw = new EventEmitter() as FakeRaw;
  raw.write = () => true;
  raw.writeHead = () => undefined;
  raw.destroy = () => raw.emit("close");
  return { raw, getHeaders: () => ({}) } as unknown as FastifyReply;
}

function fakeReq(ip: string): FastifyRequest {
  return { userId: null, ip } as unknown as FastifyRequest;
}

describe("SSE connection metrics (#544, H41-H42)", () => {
  it("aggregates distinct user and review topics under normalized labels", async () => {
    const subscriptions = [
      ["user:101", "10.10.40.1"],
      ["user:202", "10.10.40.2"],
      ["user:303", "10.10.40.3"],
      ["queue-review:11", "10.10.40.4"],
      ["queue-review:22", "10.10.40.5"],
    ] as const;
    const replies: FastifyReply[] = [];

    try {
      for (const [topic, ip] of subscriptions) {
        const reply = fakeReply();
        await subscribe(topic, fakeReq(ip), reply);
        replies.push(reply);
      }

      const metrics = await register.metrics();
      expect(metrics).toMatch(/hackos_sse_local_connections\{lane="P3",topic="user"\} 3\n/);
      expect(metrics).toMatch(/hackos_sse_local_connections\{lane="P1",topic="queue-review"\} 2\n/);
    } finally {
      for (const reply of replies) (reply.raw as FakeRaw).destroy();
    }
  });
});
