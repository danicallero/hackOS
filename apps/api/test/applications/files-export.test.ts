import "./env.js";
import { sponsorShareKey } from "@hackos/shared/applications";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import yauzl from "yauzl";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import { createApplication, createResponse } from "./fixtures.js";

/** Reads a zip buffer (possibly written with streamed/unknown-size entries,
 *  i.e. data descriptors) into a name -> content map, via yauzl (real parser,
 *  unlike a hand-rolled STORE-only reader). */
function readZipEntries(buf: Buffer): Promise<Record<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const entries: Record<string, Buffer> = {};
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      zip.readEntry();
      zip.on("entry", (entry) => {
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return reject(streamErr);
          const chunks: Buffer[] = [];
          stream.on("data", (c) => chunks.push(c));
          stream.on("end", () => {
            entries[entry.fileName] = Buffer.concat(chunks);
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => resolve(entries));
      zip.on("error", reject);
    });
  });
}

/** H56: bulk zip export of a file field's uploads, all or shareable-only. */

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

const shareableCvField = () => [
  {
    key: "cv",
    label: { en: "CV", es: "CV", gl: "CV" },
    kind: "file" as const,
    required: false,
    shareable_with_sponsors: true,
  },
];

const plainFileField = () => [
  {
    key: "cv",
    label: { en: "CV", es: "CV", gl: "CV" },
    kind: "file" as const,
    required: false,
  },
];

async function putUpload(applicationId: number, userId: number, filename: string): Promise<string> {
  const { putObject } = await import("../../src/lib/storage.js");
  const key = `uploads/${applicationId}/${userId}/cv/${Date.now()}-${userId}/${filename}`;
  await putObject(key, Buffer.from(`content for ${filename}`), "application/octet-stream");
  return key;
}

describe("bulk file export (H56)", () => {
  it("requires EXPORTS_RUN", async () => {
    const a = await getApp();
    const pleb = await createUser();
    const appId = await createApplication({ template: shareableCvField() });
    const res = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/fields/cv/files.zip`,
      headers: asUser(pleb),
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects scope=shared on a field not marked shareable_with_sponsors", async () => {
    const a = await getApp();
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const appId = await createApplication({ template: plainFileField() });
    const res = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/fields/cv/files.zip?scope=shared`,
      headers: asUser(staff),
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s for an unknown field key", async () => {
    const a = await getApp();
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const appId = await createApplication({ template: shareableCvField() });
    const res = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/fields/nope/files.zip`,
      headers: asUser(staff),
    });
    expect(res.statusCode).toBe(400);
  });

  it("scope=all zips every uploaded file named by email; scope=shared filters to consenting responses", async () => {
    const a = await getApp();
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const appId = await createApplication({ template: shareableCvField() });

    const consenting = await createUser({ email: "consenting@test.local" });
    const declining = await createUser({ email: "declining@test.local" });

    const consentingKey = await putUpload(appId, consenting, "resume.pdf");
    const decliningKey = await putUpload(appId, declining, "resume.txt");

    await createResponse(consenting, appId, {
      status: "submitted",
      responses: { cv: consentingKey, [sponsorShareKey("cv")]: true },
    });
    await createResponse(declining, appId, {
      status: "submitted",
      responses: { cv: decliningKey, [sponsorShareKey("cv")]: false },
    });

    const all = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/fields/cv/files.zip?scope=all`,
      headers: asUser(staff),
    });
    expect(all.statusCode).toBe(200);
    expect(all.headers["content-type"]).toBe("application/zip");
    const allEntries = await readZipEntries(all.rawPayload);
    expect(Object.keys(allEntries).sort()).toEqual([
      "consenting@test.local.pdf",
      "declining@test.local.txt",
    ]);
    expect(allEntries["consenting@test.local.pdf"]!.toString()).toBe("content for resume.pdf");
    expect(allEntries["declining@test.local.txt"]!.toString()).toBe("content for resume.txt");

    const shared = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/fields/cv/files.zip?scope=shared`,
      headers: asUser(staff),
    });
    expect(shared.statusCode).toBe(200);
    const sharedEntries = await readZipEntries(shared.rawPayload);
    expect(Object.keys(sharedEntries)).toEqual(["consenting@test.local.pdf"]);

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT action, entity_type, entity_id FROM audit_log
       WHERE entity_type = 'application_field_export' ORDER BY id DESC LIMIT 1`,
    );
    expect(rows[0]).toMatchObject({
      action: "export",
      entity_type: "application_field_export",
      entity_id: `${appId}:cv`,
    });
  });

  it("never includes synthetic fixture uploads in a global export", async () => {
    const a = await getApp();
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const appId = await createApplication({ template: shareableCvField() });
    const fixture = await createUser({ email: "synthetic-upload@test.local" });
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE users SET is_test_account = true WHERE id = $1`, [fixture]);
    const fixtureKey = await putUpload(appId, fixture, "resume.pdf");
    await createResponse(fixture, appId, {
      status: "submitted",
      responses: { cv: fixtureKey, [sponsorShareKey("cv")]: true },
    });

    const res = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/fields/cv/files.zip?scope=all`,
      headers: asUser(staff),
    });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(await readZipEntries(res.rawPayload))).toEqual([]);
  });

  it("skips a file that's missing from storage instead of crashing the whole export", async () => {
    // Regression: a 502 was reported in production for scope=all — one row's
    // file_key pointed at an object storage never actually has (deleted,
    // migrated, etc). getObject() throwing for that ONE row used to abort the
    // whole streamed response after headers were already sent, which a proxy
    // in front of the API sees as a broken connection (502), not a clean error.
    const a = await getApp();
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const appId = await createApplication({ template: shareableCvField() });

    const ok = await createUser({ email: "ok@test.local" });
    const missing = await createUser({ email: "missing@test.local" });
    const okKey = await putUpload(appId, ok, "resume.pdf");
    const missingKey = `uploads/${appId}/${missing}/cv/${Date.now()}-${missing}/never-uploaded.pdf`;

    await createResponse(ok, appId, {
      status: "submitted",
      responses: { cv: okKey, [sponsorShareKey("cv")]: true },
    });
    const missingResponseId = await createResponse(missing, appId, {
      status: "submitted",
      // No putObject for this key — simulates an object gone from storage.
      responses: { cv: missingKey, [sponsorShareKey("cv")]: true },
    });

    const res = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/fields/cv/files.zip?scope=all`,
      headers: asUser(staff),
    });
    expect(res.statusCode).toBe(200);
    const entries = await readZipEntries(res.rawPayload);
    expect(Object.keys(entries)).toEqual(["ok@test.local.pdf"]);

    // Reported so staff can find and manually fix the affected application,
    // instead of silently disappearing from the zip.
    const failuresHeader = JSON.parse(res.headers["x-export-file-failures"] as string);
    expect(failuresHeader).toEqual({
      total: 1,
      items: [{ responseId: missingResponseId, userId: missing, email: "missing@test.local" }],
    });

    const { pool } = await import("../../src/db/pool.js");
    const { rows: failureAudit } = await pool.query(
      `SELECT actor_id, entity_type, entity_id, action, reason FROM audit_log
       WHERE entity_type = 'application_response' AND entity_id = $1
         AND action = 'export_file_unreadable'`,
      [String(missingResponseId)],
    );
    expect(failureAudit).toHaveLength(1);
    expect(failureAudit[0]).toMatchObject({
      actor_id: staff,
      action: "export_file_unreadable",
    });

    const { rows: summaryAudit } = await pool.query(
      `SELECT after FROM audit_log
       WHERE entity_type = 'application_field_export' ORDER BY id DESC LIMIT 1`,
    );
    expect(summaryAudit[0].after).toMatchObject({ file_count: 1, failed_count: 1 });
  });

  it("omits the failures header entirely when nothing failed", async () => {
    const a = await getApp();
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const appId = await createApplication({ template: shareableCvField() });
    const ok = await createUser({ email: "clean@test.local" });
    const okKey = await putUpload(appId, ok, "resume.pdf");
    await createResponse(ok, appId, {
      status: "submitted",
      responses: { cv: okKey, [sponsorShareKey("cv")]: true },
    });

    const res = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/fields/cv/files.zip?scope=all`,
      headers: asUser(staff),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-export-file-failures"]).toBeUndefined();
  });

  it("ignores applicants who never touched the field — not a failure, not in the zip", async () => {
    // Not every applicant fills in every optional field. A response with no
    // "cv" key at all (never uploaded) must be silently excluded, same as
    // one with the key present but empty — neither is a storage failure.
    const a = await getApp();
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const appId = await createApplication({ template: shareableCvField() });

    const withFile = await createUser({ email: "withfile@test.local" });
    const noKeyAtAll = await createUser({ email: "nokey@test.local" });
    const emptyValue = await createUser({ email: "emptyvalue@test.local" });
    const withFileKey = await putUpload(appId, withFile, "resume.pdf");

    await createResponse(withFile, appId, {
      status: "submitted",
      responses: { cv: withFileKey, [sponsorShareKey("cv")]: true },
    });
    await createResponse(noKeyAtAll, appId, {
      status: "submitted",
      responses: { motivation: "no cv field touched" },
    });
    await createResponse(emptyValue, appId, {
      status: "submitted",
      responses: { cv: "" },
    });

    const res = await a.inject({
      method: "GET",
      url: `/api/applications/${appId}/fields/cv/files.zip?scope=all`,
      headers: asUser(staff),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-export-file-failures"]).toBeUndefined();
    const entries = await readZipEntries(res.rawPayload);
    expect(Object.keys(entries)).toEqual(["withfile@test.local.pdf"]);

    const { pool } = await import("../../src/db/pool.js");
    const { rows: summaryAudit } = await pool.query(
      `SELECT after FROM audit_log
       WHERE entity_type = 'application_field_export' ORDER BY id DESC LIMIT 1`,
    );
    expect(summaryAudit[0].after).toMatchObject({ file_count: 1, failed_count: 0 });
  });
});

describe("sponsor-share consent validation (H56)", () => {
  it("submit accepts a boolean consent flag and rejects a non-boolean one", async () => {
    const a = await getApp();
    const appId = await createApplication({
      type: "mentor",
      template: shareableCvField(),
      ask_shirt_size: false,
      ask_food_intolerances: false,
    });
    const userId = await createUser({ emailVerified: true });
    await a.inject({
      method: "PUT",
      url: `/api/applications/${appId}/response`,
      headers: asUser(userId),
      payload: { responses: {} },
    });

    const badConsent = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/submit`,
      headers: asUser(userId),
      payload: { responses: { cv: "uploads/x/y/cv/1/r.pdf", [sponsorShareKey("cv")]: "yes" } },
    });
    expect(badConsent.statusCode).toBe(400);

    const goodConsent = await a.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/submit`,
      headers: asUser(userId),
      payload: { responses: { cv: "uploads/x/y/cv/1/r.pdf", [sponsorShareKey("cv")]: true } },
    });
    expect(goodConsent.statusCode).toBe(200);
    expect(goodConsent.json().response.responses[sponsorShareKey("cv")]).toBe(true);
  });
});
