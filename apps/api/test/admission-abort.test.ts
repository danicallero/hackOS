import { type ClientRequest, get } from "node:http";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { App } from "../src/app.js";
import { useTestApp } from "./helpers.js";

// #1367: a client abort must release its admission lease and in-flight gauge
// whichever onRequest hook is awaiting at the time. These tests need a real
// listening server: `app.inject` has no socket to destroy.

const { httpRequestsInFlight, httpResponsesTotal, requestAdmissionQueueSize } = await import(
  "../src/lib/metrics.js"
);
const { setUserIdResolver } = await import("../src/plugins/auth-context.js");

const getApp = useTestApp();
let app: App;
let address: string;
const route = "/api/public/admission-abort-test";
const slowAuthHeader = "x-test-slow-auth";
let handlerCalls = 0;
let blockHandler = async () => {};
let slowAuth = deferred();
let slowAuthEntered = deferred();

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeAll(async () => {
  app = await getApp();
  // Stand-in for the Better Auth session lookup in auth-context, the async
  // onRequest hook that runs before admission in production. Requests
  // without the header resolve immediately as anonymous.
  setUserIdResolver(async (req) => {
    if (req.headers[slowAuthHeader]) {
      slowAuthEntered.resolve();
      await slowAuth.promise;
    }
    return null;
  });
  app.get(
    route,
    { config: { routeAccessPolicy: { kind: "public", anonymousCategory: "public-content" } } },
    async () => {
      handlerCalls++;
      await blockHandler();
      return { ok: true };
    },
  );
  address = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterEach(() => {
  handlerCalls = 0;
  blockHandler = async () => {};
  slowAuth = deferred();
  slowAuthEntered = deferred();
});

async function inFlight() {
  return (await httpRequestsInFlight.get()).values[0]!.value;
}

async function queueSize(lane: string) {
  return (await requestAdmissionQueueSize.get()).values.find((v) => v.labels.lane === lane)!.value;
}

async function openConnections() {
  return new Promise<number>((resolve, reject) =>
    app.server.getConnections((err, count) => (err ? reject(err) : resolve(count))),
  );
}

function send(headers: Record<string, string> = {}): ClientRequest {
  const request = get(`${address}${route}`, { headers, agent: false });
  request.on("error", () => {});
  return request;
}

async function expectSettled(baseline: number) {
  await vi.waitFor(async () => {
    expect(app.requestAdmission.activeCount).toBe(0);
    expect(app.requestAdmission.queuedCount).toBe(0);
    expect(await inFlight()).toBe(baseline);
  });
}

function completedResponses() {
  return httpResponsesTotal
    .get()
    .then((m) => m.values.filter((v) => "route" in v.labels && v.labels.route === route).length);
}

describe("admission release on client abort (#1367)", () => {
  it("never admits a request aborted during a slow earlier onRequest hook", async () => {
    const baseline = await inFlight();
    const completedBefore = await completedResponses();
    const request = send({ [slowAuthHeader]: "1" });
    await slowAuthEntered.promise;
    request.destroy();
    // The server sees the disconnect while auth-context is still awaiting.
    await vi.waitFor(async () => expect(await openConnections()).toBe(0));
    slowAuth.resolve();
    // Give the remaining hooks and any (wrongly) admitted handler time to run.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(handlerCalls).toBe(0);
    await expectSettled(baseline);
    expect(await completedResponses()).toBe(completedBefore);
    // A following request is admitted and released normally.
    expect((await app.inject({ method: "GET", url: route })).statusCode).toBe(200);
    await expectSettled(baseline);
  });

  it("releases the lease of a request aborted during its handler", async () => {
    const baseline = await inFlight();
    const entered = deferred();
    const unblock = deferred();
    const finished = deferred();
    blockHandler = async () => {
      entered.resolve();
      await unblock.promise;
      finished.resolve();
    };
    const request = send();
    await entered.promise;
    expect(app.requestAdmission.activeCount).toBe(1);
    expect(await inFlight()).toBe(baseline + 1);
    request.destroy();
    await expectSettled(baseline);

    // The handler finishing later must not release or decrement twice.
    unblock.resolve();
    await finished.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expectSettled(baseline);
  });

  it("releases a request aborted while queued for admission", async () => {
    const { config } = await import("../src/config.js");
    const slots =
      config.dbPoolMax - Math.min(config.dbPoolMax - 1, Math.ceil(config.dbPoolMax / 4));
    const baseline = await inFlight();
    const allEntered = deferred();
    const unblock = deferred();
    let entered = 0;
    blockHandler = async () => {
      if (++entered === slots) allEntered.resolve();
      await unblock.promise;
    };
    const active = Array.from({ length: slots }, () => send());
    const queued: ClientRequest[] = [];
    try {
      await allEntered.promise;
      queued.push(send());
      await vi.waitFor(async () => expect(await queueSize("P2")).toBe(1));
      expect(app.requestAdmission.activeCount).toBe(slots);
      queued[0]!.destroy();
      await vi.waitFor(async () => {
        expect(await queueSize("P2")).toBe(0);
        expect(app.requestAdmission.queuedCount).toBe(0);
        expect(await inFlight()).toBe(baseline + slots);
      });
      expect(app.requestAdmission.activeCount).toBe(slots);
    } finally {
      for (const request of [...active, ...queued]) request.destroy();
      unblock.resolve();
    }
    await expectSettled(baseline);
    expect(entered).toBe(slots);
  });
});
