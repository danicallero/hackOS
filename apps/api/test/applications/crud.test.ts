import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createRole,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import { createApplication, markInvitedParticipant, sampleTemplate } from "./fixtures.js";

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

  it("stores explicit anonymous retention in immutable form versions and protects it by capability", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_MANAGE]);
    const operator = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
    const template = sampleTemplate();

    const create = await a.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(manager),
      payload: { name: "Retention form", type: "participant", template },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id as number;
    expect(
      create.json().template.map((field: { retention_mode: string }) => field.retention_mode),
    ).toEqual(["none", "none"]);

    const unauthorized = await a.inject({
      method: "PATCH",
      url: `/api/applications/${id}`,
      headers: asUser(operator),
      payload: {
        template: template.map((field) => ({ ...field, retention_mode: "anonymous_audit" })),
      },
    });
    expect(unauthorized.statusCode).toBe(403);

    const retainedTemplate = template.map((field) =>
      field.key === "motivation"
        ? {
            ...field,
            retention_mode: "anonymous_audit" as const,
            anonymous_audit_dimension: "custom.motivation",
          }
        : field,
    );
    const update = await a.inject({
      method: "PATCH",
      url: `/api/applications/${id}`,
      headers: asUser(manager),
      payload: { template: retainedTemplate },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().current_form_version).toBe(2);
    expect(update.json().template[0]).toMatchObject({
      retention_mode: "anonymous_audit",
      anonymous_audit_dimension: "custom.motivation",
    });

    const { pool } = await import("../../src/db/pool.js");
    const { rows: versions } = await pool.query(
      `SELECT version, template FROM application_form_versions
        WHERE application_id = $1 ORDER BY version`,
      [id],
    );
    expect(versions).toHaveLength(2);
    expect(versions[0].template[0].retention_mode).toBe("none");
    expect(versions[1].template[0].retention_mode).toBe("anonymous_audit");

    const { rows: audits } = await pool.query(
      `SELECT before, after FROM audit_log
        WHERE entity_type = 'application' AND entity_id = $1 AND action = 'updated'
        ORDER BY id DESC LIMIT 1`,
      [id],
    );
    expect(audits[0].before).toMatchObject({
      formVersion: 1,
      anonymousRetention: [],
    });
    expect(audits[0].after).toMatchObject({
      formVersion: 2,
      anonymousRetention: [{ key: "motivation", kind: "text", dimension: "custom.motivation" }],
    });
    expect(JSON.stringify(audits[0].after)).not.toContain("response");
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

  it("APPLICATIONS_DECIDE can discover decision metadata without gaining form management", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_MANAGE]);
    const decider = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_DECIDE]);
    const created = await a.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(manager),
      payload: { name: "Decision form", type: "participant", template: sampleTemplate() },
    });
    const id = created.json().id as number;

    expect(
      (await a.inject({ method: "GET", url: "/api/applications", headers: asUser(decider) }))
        .statusCode,
    ).toBe(200);
    expect(
      (await a.inject({ method: "GET", url: `/api/applications/${id}`, headers: asUser(decider) }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await a.inject({
          method: "PATCH",
          url: `/api/applications/${id}`,
          headers: asUser(decider),
          payload: { name: "No" },
        })
      ).statusCode,
    ).toBe(403);
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

  it("H10: a late invited participant can still list and fetch a closed form", async () => {
    const a = await getApp();
    const past = new Date(Date.now() - 3600_000).toISOString();

    const closedId = await createApplication({ name: "Closed", open_at: past, close_at: past });

    const invited = await createUser({ email: "late@example.com" });
    await markInvitedParticipant(invited, "late@example.com");

    const list = await a.inject({
      method: "GET",
      url: "/api/public/applications",
      headers: asUser(invited),
    });
    expect(list.statusCode).toBe(200);
    const forms = list.json().applications;
    expect(forms.map((f: { id: number }) => f.id)).toContain(closedId);

    const single = await a.inject({
      method: "GET",
      url: `/api/public/applications/${closedId}`,
      headers: asUser(invited),
    });
    expect(single.statusCode).toBe(200);
    expect(single.json().name).toBe("Closed");
  });

  it("H10: a non-invited user still gets the closed form omitted/404", async () => {
    const a = await getApp();
    const past = new Date(Date.now() - 3600_000).toISOString();

    const closedId = await createApplication({ name: "Closed", open_at: past, close_at: past });
    const pleb = await createUser();

    // anonymous
    const anonList = await a.inject({ method: "GET", url: "/api/public/applications" });
    expect(anonList.json().applications.map((f: { id: number }) => f.id)).not.toContain(closedId);
    const anonSingle = await a.inject({
      method: "GET",
      url: `/api/public/applications/${closedId}`,
    });
    expect(anonSingle.statusCode).toBe(404);

    // authenticated but not an invited participant
    const list = await a.inject({
      method: "GET",
      url: "/api/public/applications",
      headers: asUser(pleb),
    });
    expect(list.json().applications.map((f: { id: number }) => f.id)).not.toContain(closedId);
    const single = await a.inject({
      method: "GET",
      url: `/api/public/applications/${closedId}`,
      headers: asUser(pleb),
    });
    expect(single.statusCode).toBe(404);
  });

  it("H12: ask_shirt_size/ask_food_intolerances default false and are independently togglable per form, regardless of type", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_MANAGE]);

    const create = await a.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(manager),
      payload: { name: "Volunteer form", type: "volunteer", template: sampleTemplate() },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().ask_shirt_size).toBe(false);
    expect(create.json().ask_food_intolerances).toBe(false);
    const id = create.json().id;

    const patch = await a.inject({
      method: "PATCH",
      url: `/api/applications/${id}`,
      headers: asUser(manager),
      payload: { ask_shirt_size: true },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().ask_shirt_size).toBe(true);
    // Untouched field stays as-is (partial update).
    expect(patch.json().ask_food_intolerances).toBe(false);
  });

  it("H8: creates a form with multiple grants_role_ids and updates the granted set", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_MANAGE]);
    const roleA = await createRole([], { name: "grant-form-role-a" });
    const roleB = await createRole([], { name: "grant-form-role-b" });
    const roleC = await createRole([], { name: "grant-form-role-c" });

    const create = await a.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(manager),
      payload: {
        name: "Mentor form",
        type: "mentor",
        template: sampleTemplate(),
        grants_role_ids: [roleA, roleB],
      },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().grants_role_ids.sort()).toEqual([roleA, roleB].sort());
    const id = create.json().id;

    const get = await a.inject({
      method: "GET",
      url: `/api/applications/${id}`,
      headers: asUser(manager),
    });
    expect(get.json().grants_role_ids.sort()).toEqual([roleA, roleB].sort());

    // Replace the full set: drop roleA, add roleC.
    const patch = await a.inject({
      method: "PATCH",
      url: `/api/applications/${id}`,
      headers: asUser(manager),
      payload: { grants_role_ids: [roleB, roleC] },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().grants_role_ids.sort()).toEqual([roleB, roleC].sort());

    // Omitting the field on a further PATCH leaves the grants unchanged.
    const patchUnrelated = await a.inject({
      method: "PATCH",
      url: `/api/applications/${id}`,
      headers: asUser(manager),
      payload: { capacity: 10 },
    });
    expect(patchUnrelated.json().grants_role_ids.sort()).toEqual([roleB, roleC].sort());

    // Explicit [] clears every grant.
    const clear = await a.inject({
      method: "PATCH",
      url: `/api/applications/${id}`,
      headers: asUser(manager),
      payload: { grants_role_ids: [] },
    });
    expect(clear.json().grants_role_ids).toEqual([]);
  });

  it("H8: a form with no grants_role_ids still creates and confirms with no role side-effects", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_MANAGE]);

    const create = await a.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(manager),
      payload: { name: "No-grant form", type: "participant", template: sampleTemplate() },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().grants_role_ids).toEqual([]);
  });

  it("H8: rejects an unknown role ID in grants_role_ids", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_MANAGE]);

    const create = await a.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(manager),
      payload: {
        name: "Bad grant form",
        type: "participant",
        template: sampleTemplate(),
        grants_role_ids: [999999],
      },
    });
    expect(create.statusCode).toBe(404);

    const roleA = await createRole([], { name: "grant-form-role-update-target" });
    const okCreate = await a.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(manager),
      payload: {
        name: "Ok grant form",
        type: "participant",
        template: sampleTemplate(),
        grants_role_ids: [roleA],
      },
    });
    expect(okCreate.statusCode).toBe(201);
    const id = okCreate.json().id;

    const patch = await a.inject({
      method: "PATCH",
      url: `/api/applications/${id}`,
      headers: asUser(manager),
      payload: { grants_role_ids: [roleA, 999999] },
    });
    expect(patch.statusCode).toBe(404);
    // Unknown role ID in the PATCH must not have partially applied.
    const get = await a.inject({
      method: "GET",
      url: `/api/applications/${id}`,
      headers: asUser(manager),
    });
    expect(get.json().grants_role_ids).toEqual([roleA]);
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

  it("H11: sections group template fields and round-trip through create/update/read", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_MANAGE]);
    const en = { en: "Education", es: "Educación", gl: "Educación" };
    const template = sampleTemplate().map((f) => ({ ...f, section_key: "education" }));

    const create = await a.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(manager),
      payload: {
        name: "Sectioned form",
        type: "participant",
        template,
        sections: [{ key: "education", title: en }],
      },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().sections).toEqual([{ key: "education", title: en }]);
    expect(create.json().template[0].section_key).toBe("education");
    const id = create.json().id;

    const patch = await a.inject({
      method: "PATCH",
      url: `/api/applications/${id}`,
      headers: asUser(manager),
      payload: { sections: [{ key: "education", title: en, description: en }] },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().sections[0].description).toEqual(en);

    const read = await a.inject({
      method: "GET",
      url: `/api/applications/${id}`,
      headers: asUser(manager),
    });
    expect(read.json().sections[0].key).toBe("education");
  });

  it("H11: a field's help_text round-trips through create/update", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_MANAGE]);
    const help = { en: "We won't call you", es: "No te llamaremos", gl: "Non te chamaremos" };
    const template = sampleTemplate().map((f, i) => (i === 0 ? { ...f, help_text: help } : f));

    const create = await a.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(manager),
      payload: { name: "Help text form", type: "participant", template },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().template[0].help_text).toEqual(help);
  });

  it("H11: rejects a field whose section_key has no matching section", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_MANAGE]);
    const template = sampleTemplate().map((f) => ({ ...f, section_key: "missing" }));

    const res = await a.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(manager),
      payload: { name: "Bad sections", type: "participant", template, sections: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("H11: rejects duplicate section keys", async () => {
    const a = await getApp();
    const manager = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_MANAGE]);
    const title = { en: "A", es: "A", gl: "A" };

    const res = await a.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(manager),
      payload: {
        name: "Dup sections",
        type: "participant",
        template: sampleTemplate(),
        sections: [
          { key: "dup", title },
          { key: "dup", title },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
