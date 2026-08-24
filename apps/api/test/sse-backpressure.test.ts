import { EventEmitter } from "node:events";
import type { FastifyReply, FastifyRequest } from "fastify";
import { afterAll, describe, expect, it } from "vitest";

/**
 * H540: a slow SSE client (write() never drains) gets disconnected instead
 * of buffering unboundedly, and connection budgets reject subscribe() before
 * the response is hijacked. Small limits are set via env *before* importing
 * config/sse (vitest isolates modules per test file), so this stays fast and
 * doesn't touch the generous defaults other suites rely on.
 */
process.env.SSE_WRITE_TIMEOUT_MS = "50";
process.env.SSE_MAX_CONNECTIONS_PER_CLIENT = "2";
process.env.SSE_MAX_CONNECTIONS_PER_TOPIC = "2";

const { subscribe } = await import("../src/lib/sse.js");
const { TooManyRequestsError } = await import("../src/lib/errors.js");
const { closeValkey } = await import("../src/lib/valkey.js");

afterAll(async () => {
  await closeValkey();
});

type FakeRaw = EventEmitter & {
  write: (chunk: string) => boolean;
  writeHead: (...args: unknown[]) => void;
  destroy: () => void;
};

function fakeReply(writeReturns: () => boolean): FastifyReply {
  const raw = new EventEmitter() as FakeRaw;
  raw.write = writeReturns;
  raw.writeHead = () => undefined;
  raw.destroy = () => raw.emit("close");
  return { raw, getHeaders: () => ({}) } as unknown as FastifyReply;
}

function fakeReq(ip: string, userId: number | null = null): FastifyRequest {
  return { userId, ip } as unknown as FastifyRequest;
}

describe("SSE backpressure (H540)", () => {
  it("disconnects a client whose writes never drain within SSE_WRITE_TIMEOUT_MS", async () => {
    const reply = fakeReply(() => false);
    let closed = false;
    (reply.raw as FakeRaw).on("close", () => {
      closed = true;
    });

    await subscribe("bp-slow-client", fakeReq("10.10.10.1"), reply);
    expect(closed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(closed).toBe(true);
  });

  it("keeps a client connected once its write reports success again", async () => {
    let ok = true;
    const reply = fakeReply(() => ok);
    let closed = false;
    (reply.raw as FakeRaw).on("close", () => {
      closed = true;
    });

    ok = false;
    await subscribe("bp-recovering-client", fakeReq("10.10.10.2"), reply);
    (reply.raw as FakeRaw).emit("drain");
    ok = true;

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(closed).toBe(false);
    (reply.raw as FakeRaw).destroy();
  });
});

describe("SSE connection budgets (H540)", () => {
  it("rejects subscribe() past the per-client budget", async () => {
    const req = fakeReq("10.10.20.1");
    const replies: FastifyReply[] = [];
    for (let i = 0; i < 2; i++) {
      const reply = fakeReply(() => true);
      await subscribe(`bp-client-budget-${i}`, req, reply);
      replies.push(reply);
    }

    await expect(
      subscribe(
        "bp-client-budget-extra",
        req,
        fakeReply(() => true),
      ),
    ).rejects.toBeInstanceOf(TooManyRequestsError);

    for (const reply of replies) (reply.raw as FakeRaw).destroy();
  });

  it("rejects subscribe() past the per-topic budget across distinct clients", async () => {
    const topic = "bp-topic-budget";
    const replies: FastifyReply[] = [];
    for (let i = 0; i < 2; i++) {
      const reply = fakeReply(() => true);
      await subscribe(topic, fakeReq(`10.10.30.${i}`), reply);
      replies.push(reply);
    }

    await expect(
      subscribe(
        topic,
        fakeReq("10.10.30.99"),
        fakeReply(() => true),
      ),
    ).rejects.toBeInstanceOf(TooManyRequestsError);

    for (const reply of replies) (reply.raw as FakeRaw).destroy();
  });
});
