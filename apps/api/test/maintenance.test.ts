import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { buildTestApp } from "./helpers.js";

const { config } = await import("../src/config.js");
const { resetMaintenanceCache } = await import("../src/lib/maintenance.js");

let app: App;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "hackos-maintenance-"));
  app = await buildTestApp();
  await app.ready();
});

afterEach(async () => {
  config.MAINTENANCE_DIR = undefined;
  resetMaintenanceCache();
  await rm(join(dir, "state.json"), { force: true });
});

afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

const lock = async (raw: string) => {
  config.MAINTENANCE_DIR = dir;
  resetMaintenanceCache();
  await writeFile(join(dir, "state.json"), raw);
};

describe("restore maintenance lock (#539)", () => {
  it("serves normally when no lock file exists", async () => {
    config.MAINTENANCE_DIR = dir;
    expect((await app.inject({ method: "GET", url: "/api/public/event" })).statusCode).not.toBe(
      503,
    );
    const status = await app.inject({ method: "GET", url: "/api/public/maintenance" });
    expect(status.json()).toEqual({ active: false });
  });

  it("answers 503 maintenance_in_progress to every business route while locked", async () => {
    await lock(
      JSON.stringify({
        phase: "restoring",
        restoreId: "r1",
        startedAt: "2026-10-26T10:00:00Z",
        etaAt: "2026-10-26T10:20:00Z",
      }),
    );
    for (const request of [
      { method: "GET", url: "/api/public/event" },
      { method: "GET", url: "/api/me" },
      { method: "POST", url: "/api/queue/entries" },
    ] as const) {
      const res = await app.inject(request);
      expect(res.statusCode).toBe(503);
      expect(res.headers["retry-after"]).toBe("30");
      expect(res.json().error).toMatchObject({
        code: "maintenance_in_progress",
        details: { phase: "restoring", etaAt: "2026-10-26T10:20:00Z" },
      });
    }
  });

  it("keeps probes and the status endpoint reachable", async () => {
    await lock(JSON.stringify({ phase: "draining", restoreId: "r1" }));
    expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    const status = await app.inject({ method: "GET", url: "/api/public/maintenance" });
    expect(status.statusCode).toBe(200);
    expect(status.headers["cache-control"]).toBe("no-store");
    expect(status.json()).toMatchObject({ active: true, phase: "draining", restoreId: "r1" });
  });

  it("fails closed on a corrupt lock file and reports the failed phase", async () => {
    await lock("{not json");
    expect((await app.inject({ method: "GET", url: "/api/public/event" })).statusCode).toBe(503);
    resetMaintenanceCache();
    await writeFile(join(dir, "state.json"), JSON.stringify({ phase: "failed" }));
    const status = await app.inject({ method: "GET", url: "/api/public/maintenance" });
    expect(status.json()).toMatchObject({ active: true, phase: "failed" });
  });

  it("reopens as soon as the lock file is removed", async () => {
    await lock(JSON.stringify({ phase: "verifying" }));
    expect((await app.inject({ method: "GET", url: "/api/public/event" })).statusCode).toBe(503);
    await rm(join(dir, "state.json"));
    resetMaintenanceCache();
    expect((await app.inject({ method: "GET", url: "/api/public/event" })).statusCode).not.toBe(
      503,
    );
  });
});
