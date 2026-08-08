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
