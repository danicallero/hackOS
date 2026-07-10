import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { processDataSubjectRequest } from "../../src/modules/exports/worker.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

/** H54: the export bundle download is proxied and re-checks auth every request. */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  app ??= await buildTestApp();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  const { pool } = await import("../../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

describe("GET /api/exports/requests/:id/download (H54)", () => {
  it("409s while the request isn't a completed export yet", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const subject = await createUser();
    const created = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: asUser(staff),
      payload: { subjectUserId: subject, type: "export" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/exports/requests/${created.json().id}/download`,
      headers: asUser(staff),
    });
    expect(res.statusCode).toBe(409);
  });

  it("404s for an unknown request id", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const res = await app.inject({
      method: "GET",
      url: "/api/exports/requests/999999/download",
      headers: asUser(staff),
    });
    expect(res.statusCode).toBe(404);
  });

  it("403s without exports:run, including when the caller is the subject themself", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const subject = await createUser();
    const created = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: asUser(staff),
      payload: { subjectUserId: subject, type: "export" },
    });
    await processDataSubjectRequest(created.json().id);

    const noCaps = await createUser();
    const res = await app.inject({
      method: "GET",
      url: `/api/exports/requests/${created.json().id}/download`,
      headers: asUser(noCaps),
    });
    expect(res.statusCode).toBe(403);

    const selfService = await app.inject({
      method: "GET",
      url: `/api/exports/requests/${created.json().id}/download`,
      headers: asUser(subject),
    });
    expect(selfService.statusCode).toBe(403);
  });

  it("200s with a parseable JSON bundle once completed", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const subject = await createUser({ email: "download-me@example.test" });
    const created = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: asUser(staff),
      payload: { subjectUserId: subject, type: "export" },
    });
    await processDataSubjectRequest(created.json().id);

    const res = await app.inject({
      method: "GET",
      url: `/api/exports/requests/${created.json().id}/download`,
      headers: asUser(staff),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-disposition"]).toContain("attachment");
    const parsed = JSON.parse(res.body);
    expect(parsed.subject.email).toBe("download-me@example.test");
  });
});
