import { get } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../src/app.js";
import { buildTestApp } from "./helpers.js";

const {
  httpResponsesTotal,
  httpRequestDurationSeconds,
  httpRequestsInFlight,
  requestAdmissionQueueSize,
} = await import("../src/lib/metrics.js");

let app: App;
let address: string;
let blockHandler = async () => {};
const internalRoute = "/api/public/metrics-test/internal-error";
const blockedRoute = "/api/public/metrics-test/blocked";
const walletRoute =
  "/api/wallet/apple/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier";

beforeAll(async () => {
  app = await buildTestApp();
  const options = {
    config: { routeAccessPolicy: { kind: "public", anonymousCategory: "public-content" } },
  } as const;
  app.get(internalRoute, options, async () => {
    throw new Error("HTTP metrics regression");
  });
  app.get(blockedRoute, options, async () => {
    await blockHandler();
    return { ok: true };
  });
  address = await app.listen({ host: "127.0.0.1", port: 0 });
});

beforeEach(() => {
  httpResponsesTotal.reset();
  httpRequestDurationSeconds.reset();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../src/lib/queues.js");
  const { closeValkey } = await import("../src/lib/valkey.js");
  const { pool } = await import("../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function inFlight() {
  return (await httpRequestsInFlight.get()).values[0]!.value;
}

async function expectResponseMetrics(route: string, statusClass: string) {
  const counter = (await httpResponsesTotal.get()).values.filter(
    (value) => "route" in value.labels && value.labels.route === route,
  );
  expect(counter).toHaveLength(1);
  expect(counter[0]).toMatchObject({ value: 1, labels: { status_class: statusClass } });
  const histogram = (await httpRequestDurationSeconds.get()).values.filter(
    (value) => "route" in value.labels && value.labels.route === route,
  );
  expect(
    histogram.every(
      (value) => "status_class" in value.labels && value.labels.status_class === statusClass,
    ),
  ).toBe(true);
  expect(histogram.find((value) => value.metricName?.endsWith("_count"))?.value).toBe(1);
  expect(histogram.find((value) => value.metricName?.endsWith("_sum"))?.value).toBeGreaterThan(0);
}

describe("HTTP response metrics (#891)", () => {
  it("counts a Wallet authentication error once using its final 401 status", async () => {
    const baseline = await inFlight();
    const response = await app.inject({
      method: "GET",
      url: "/api/wallet/apple/v1/devices/metrics-device/registrations/metrics-pass-type",
    });
    expect(response.statusCode).toBe(401);
    await expectResponseMetrics(walletRoute, "4xx");
    expect(await inFlight()).toBe(baseline);
  });

  it("counts an unexpected exception once using its final 500 status", async () => {
    const baseline = await inFlight();
    const response = await app.inject({ method: "GET", url: internalRoute });
    expect(response.statusCode).toBe(500);
    await expectResponseMetrics(internalRoute, "5xx");
    expect(await inFlight()).toBe(baseline);
  });

  it("cancels admission for a disconnected queued request", async () => {
    const { config } = await import("../src/config.js");
    const slots =
      config.dbPoolMax - Math.min(config.dbPoolMax - 1, Math.ceil(config.dbPoolMax / 4));
    const baseline = await inFlight();
    const entered = deferred();
    const unblock = deferred();
    const completed = deferred();
    let started = 0;
    let finished = 0;
    blockHandler = async () => {
      if (++started === slots) entered.resolve();
      await unblock.promise;
      if (++finished === slots) completed.resolve();
    };
    const requests = Array.from({ length: slots }, () => {
      const request = get(`${address}${blockedRoute}`);
      request.on("error", () => {});
      return request;
    });
    let queued: ReturnType<typeof get> | undefined;
    const queueSize = async () =>
      (await requestAdmissionQueueSize.get()).values.find((value) => value.labels.lane === "P2")!
        .value;
    try {
      await entered.promise;
      queued = get(`${address}${blockedRoute}`);
      queued.on("error", () => {});
      await vi.waitFor(async () => expect(await queueSize()).toBe(1));
      expect(await inFlight()).toBe(baseline + slots + 1);
      queued.destroy();
      await vi.waitFor(async () => {
        expect(await queueSize()).toBe(0);
        expect(await inFlight()).toBe(baseline + slots);
      });
    } finally {
      queued?.destroy();
      for (const request of requests) request.destroy();
      await vi.waitFor(async () => expect(await inFlight()).toBe(baseline));
      unblock.resolve();
      await completed.promise;
    }
    expect(started).toBe(slots);
    expect((await httpResponsesTotal.get()).values).toHaveLength(0);
    expect((await httpRequestDurationSeconds.get()).values).toHaveLength(0);
    blockHandler = async () => {};
    expect((await app.inject({ method: "GET", url: blockedRoute })).statusCode).toBe(200);
    expect(await inFlight()).toBe(baseline);
  });

  it("releases an aborted response without recording a completed response", async () => {
    const baseline = await inFlight();
    const entered = deferred();
    const unblock = deferred();
    const completed = deferred();
    blockHandler = async () => {
      entered.resolve();
      await unblock.promise;
      completed.resolve();
    };
    const request = get(`${address}${blockedRoute}`);
    request.on("error", () => {});
    try {
      await entered.promise;
      expect(await inFlight()).toBe(baseline + 1);
      request.destroy();
      await vi.waitFor(async () => expect(await inFlight()).toBe(baseline));
    } finally {
      request.destroy();
      unblock.resolve();
      await completed.promise;
    }
    // A later successful request must not double-decrement the aborted one.
    const healthy = await app.inject({ method: "GET", url: "/healthz" });
    expect(healthy.statusCode).toBe(200);
    expect(await inFlight()).toBe(baseline);
    expect(
      (await httpResponsesTotal.get()).values.some(
        (v) => "route" in v.labels && v.labels.route === blockedRoute,
      ),
    ).toBe(false);
    expect(
      (await httpRequestDurationSeconds.get()).values.some(
        (v) => "route" in v.labels && v.labels.route === blockedRoute,
      ),
    ).toBe(false);
  });
});
