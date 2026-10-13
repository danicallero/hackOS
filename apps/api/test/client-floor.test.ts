import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { buildTestApp } from "./helpers.js";

const { config } = await import("../src/config.js");
const { mobileClientRequestsTotal } = await import("../src/lib/metrics.js");

let app: App;
const route = "/api/public/client-floor-test";

beforeAll(async () => {
  app = await buildTestApp();
  app.get(
    route,
    { config: { routeAccessPolicy: { kind: "public", anonymousCategory: "public-content" } } },
    async () => ({ ok: true }),
  );
  await app.ready();
});

afterEach(() => {
  config.MOBILE_MIN_BUILD = 0;
});

afterAll(async () => {
  await app.close();
});

const get = (headers: Record<string, string> = {}, url = route) =>
  app.inject({ method: "GET", url, headers });

describe("minimum supported mobile build (#999)", () => {
  it("lets every build through while the floor is disabled", async () => {
    expect((await get({ "x-hackos-build": "1" })).statusCode).toBe(200);
    expect((await get({ "expo-origin": "hackos://" })).statusCode).toBe(200);
  });

  it("answers 426 upgrade_required to a build below the floor", async () => {
    config.MOBILE_MIN_BUILD = 10;
    const res = await get({ "x-hackos-build": "9" });
    expect(res.statusCode).toBe(426);
    expect(res.json()).toEqual({
      error: {
        code: "upgrade_required",
        message: expect.any(String),
        details: { minBuild: 10, build: 9 },
      },
    });
  });

  it("serves the floor build and newer ones normally", async () => {
    config.MOBILE_MIN_BUILD = 10;
    expect((await get({ "x-hackos-build": "10" })).statusCode).toBe(200);
    expect((await get({ "x-hackos-build": "11" })).statusCode).toBe(200);
  });

  it("treats installed builds that predate the header as below the floor", async () => {
    config.MOBILE_MIN_BUILD = 10;
    const res = await get({ "expo-origin": "hackos://" });
    expect(res.statusCode).toBe(426);
    expect(res.json().error.details).toEqual({ minBuild: 10, build: 0 });
    expect((await get({ "x-hackos-build": "not-a-number" })).statusCode).toBe(426);
  });

  it("never blocks web or tooling requests, nor the health probes", async () => {
    config.MOBILE_MIN_BUILD = 10;
    expect((await get()).statusCode).toBe(200);
    expect((await get({ "x-hackos-build": "1" }, "/healthz")).statusCode).toBe(200);
  });

  it("counts requests per reported build and outcome", async () => {
    config.MOBILE_MIN_BUILD = 10;
    mobileClientRequestsTotal.reset();
    await get({ "x-hackos-build": "7" });
    await get({ "x-hackos-build": "12" });
    await get({ "expo-origin": "hackos://" });
    const samples = (await mobileClientRequestsTotal.get()).values.map((v) => ({
      ...v.labels,
      value: v.value,
    }));
    expect(samples).toEqual(
      expect.arrayContaining([
        { build: "7", outcome: "rejected", value: 1 },
        { build: "12", outcome: "allowed", value: 1 },
        { build: "unreported", outcome: "rejected", value: 1 },
      ]),
    );
  });
});
