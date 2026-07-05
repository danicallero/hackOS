import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import { createApplication, sampleTemplate } from "./fixtures.js";

/** H11 (APPLICATIONS_MANAGE): CRUD of application forms + public read of open ones. */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
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

async function getApp(): Promise<App> {
  if (!app) app = await buildTestApp();
  return app;
}

describe("applications CRUD (H11)", () => {
  it("requires APPLICATIONS_MANAGE to create", async () => {
    const a = await getApp();
    const pleb = await createUser();
    const res = await a.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(pleb),
      payload: { name: "X", type: "participant", template: sampleTemplate() },
    });
    expect(res.statusCode).toBe(403);
  });

  it("creates, reads, updates and lists a form", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_MANAGE]);

    const create = await a.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(manager),
      payload: {
        name: "Participant form",
        type: "participant",
        template: sampleTemplate(),
        capacity: 100,
      },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;
    expect(create.json().capacity).toBe(100);
    expect(create.json().confirmation_window_hours).toBe(168);

    const patch = await a.inject({
      method: "PATCH",
      url: `/api/applications/${id}`,
      headers: asUser(manager),
      payload: { capacity: 50, active: false },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().capacity).toBe(50);
    expect(patch.json().active).toBe(false);

    const list = await a.inject({
      method: "GET",
      url: "/api/applications",
      headers: asUser(manager),
    });
    expect(list.json().applications).toHaveLength(1);
  });

  it("APPLICATIONS_REVIEW can read forms but not write", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_MANAGE]);
    const reviewer = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_REVIEW]);

    const created = await a.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(manager),
      payload: { name: "Test", type: "participant", template: sampleTemplate() },
    });
    const id = created.json().id;

    // reviewer can read
    const list = await a.inject({
      method: "GET",
      url: "/api/applications",
      headers: asUser(reviewer),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().applications).toHaveLength(1);

    const single = await a.inject({
      method: "GET",
      url: `/api/applications/${id}`,
      headers: asUser(reviewer),
    });
    expect(single.statusCode).toBe(200);
    expect(single.json().name).toBe("Test");

    // reviewer cannot write
    const patch = await a.inject({
      method: "PATCH",
      url: `/api/applications/${id}`,
      headers: asUser(reviewer),
      payload: { name: "Hacked" },
    });
    expect(patch.statusCode).toBe(403);
  });

  it("rejects an invalid template (select without options)", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_MANAGE]);
    const res = await a.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(manager),
      payload: {
        name: "Bad",
        type: "participant",
        template: [
          { key: "x", label: { en: "x", es: "x", gl: "x" }, kind: "select", required: true },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("public endpoint lists only active forms inside their window, with template", async () => {
    const a = await getApp();
    const past = new Date(Date.now() - 3600_000).toISOString();
    const future = new Date(Date.now() + 3600_000).toISOString();

    const openId = await createApplication({ name: "Open", open_at: past, close_at: future });
    await createApplication({ name: "Closed", open_at: past, close_at: past });
    await createApplication({ name: "Inactive", active: false });
    await createApplication({ name: "NotYet", open_at: future });

    const res = await a.inject({ method: "GET", url: "/api/public/applications" });
    expect(res.statusCode).toBe(200);
    const forms = res.json().applications;
    expect(forms).toHaveLength(1);
    expect(forms[0].id).toBe(openId);
    expect(Array.isArray(forms[0].template)).toBe(true);

    const single = await a.inject({ method: "GET", url: `/api/public/applications/${openId}` });
    expect(single.statusCode).toBe(200);
    expect(single.json().name).toBe("Open");
  });

  it("blocks deleting a form that already has responses", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_MANAGE]);
    const appId = await createApplication();
    const applicant = await createUser();
    const { createResponse } = await import("./fixtures.js");
    await createResponse(applicant, appId, { status: "submitted" });

    const res = await a.inject({
      method: "DELETE",
      url: `/api/applications/${appId}`,
      headers: asUser(manager),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.code).toBe("has_responses");
  });
});
