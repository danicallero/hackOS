import { beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { config } from "../src/config.js";
import { POOL_CONNECT_TIMEOUT_MESSAGE } from "../src/db/pool.js";
import { useTestApp } from "./helpers.js";

// #1367: a request that waits too long for admission is answered 503 with a
// retry hint instead of being held until the client gives up. Two slots,
// one reserved for P0/P1, leave a single best-effort slot. Set before the
// app (and its gate) is built.
config.REQUEST_ADMISSION_MAX_WAIT_MS = 150;
config.requestAdmissionMaxConcurrent = 2;

const getApp = useTestApp();
let app: App;
const slowRoute = "/api/public/admission-max-wait-test";
const busyPoolRoute = "/api/public/admission-pool-timeout-test";
let blockHandler = async () => {};

beforeAll(async () => {
  app = await getApp();
  const policy = {
    routeAccessPolicy: { kind: "public", anonymousCategory: "public-content" },
  } as const;
  app.get(slowRoute, { config: policy }, async () => {
    await blockHandler();
    return { ok: true };
  });
  app.get(busyPoolRoute, { config: policy }, async () => {
    throw new Error(POOL_CONNECT_TIMEOUT_MESSAGE);
  });
  await app.ready();
});

describe("admission maximum wait (#1367)", () => {
  it("answers 503 with Retry-After once a queued request waited too long", async () => {
    let unblock!: () => void;
    blockHandler = () => new Promise<void>((resolve) => (unblock = resolve));
    const first = app.inject({ method: "GET", url: slowRoute });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const started = Date.now();
    const second = await app.inject({ method: "GET", url: slowRoute });
    expect(second.statusCode).toBe(503);
    expect(second.headers["retry-after"]).toBe("2");
    expect(second.json().error.code).toBe("service_unavailable");
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);

    unblock();
    expect((await first).statusCode).toBe(200);
    expect(app.requestAdmission.activeCount).toBe(0);
    expect(app.requestAdmission.queuedCount).toBe(0);
  });

  it("answers a timed-out connection checkout 503, not 500", async () => {
    const res = await app.inject({ method: "GET", url: busyPoolRoute });
    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("2");
  });
});
