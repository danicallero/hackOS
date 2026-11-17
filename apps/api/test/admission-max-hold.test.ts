import { beforeAll, describe, expect, it, vi } from "vitest";
import type { App } from "../src/app.js";
import { config } from "../src/config.js";
import { useTestApp } from "./helpers.js";

// #1367 defence in depth: a lease held past REQUEST_ADMISSION_MAX_HOLD_MS is
// force-released once, and the request is not double-counted if it later
// completes. The short hold is set before the app (and its gate) is built.
config.REQUEST_ADMISSION_MAX_HOLD_MS = 150;

const { httpRequestsInFlight, httpResponsesTotal } = await import("../src/lib/metrics.js");

const getApp = useTestApp();
let app: App;
const route = "/api/public/admission-max-hold-test";
let blockHandler = async () => {};

beforeAll(async () => {
  app = await getApp();
  app.get(
    route,
    { config: { routeAccessPolicy: { kind: "public", anonymousCategory: "public-content" } } },
    async () => {
      await blockHandler();
      return { ok: true };
    },
  );
  await app.ready();
});

async function inFlight() {
  return (await httpRequestsInFlight.get()).values[0]!.value;
}

describe("admission lease maximum hold (#1367)", () => {
  it("force-releases a long request once and still records its response", async () => {
    const baseline = await inFlight();
    let unblock!: () => void;
    const unblocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    blockHandler = async () => {
      entered();
      await unblocked;
    };

    const response = app.inject({ method: "GET", url: route });
    await started;
    expect(app.requestAdmission.activeCount).toBe(1);
    expect(await inFlight()).toBe(baseline + 1);

    await vi.waitFor(async () => {
      expect(app.requestAdmission.activeCount).toBe(0);
      expect(await inFlight()).toBe(baseline);
    });

    unblock();
    expect((await response).statusCode).toBe(200);
    expect(app.requestAdmission.activeCount).toBe(0);
    expect(await inFlight()).toBe(baseline);
    const completed = (await httpResponsesTotal.get()).values.filter(
      (v) => "route" in v.labels && v.labels.route === route,
    );
    expect(completed).toHaveLength(1);
    expect(completed[0]!.value).toBe(1);
  });

  it("exposes admission health on /readyz without changing its status", async () => {
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: "ok",
      admission: { active: 0, queued: 0, oldestBestEffortWaitSeconds: 0 },
    });
    const metrics = await app.inject({ method: "GET", url: "/metrics" });
    expect(metrics.body).toContain(
      'hackos_http_request_admission_oldest_wait_seconds{lane="P3"} 0',
    );
    expect(metrics.body).toContain(
      'hackos_http_request_admission_lease_expired_total{lane="P2"} 1',
    );
  });
});
