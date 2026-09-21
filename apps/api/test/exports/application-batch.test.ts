import "./env.js";
import { sponsorShareKey } from "@hackos/shared/applications";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import yauzl from "yauzl";
import type { App } from "../../src/app.js";
import { createApplication, createResponse } from "../applications/fixtures.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

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
          stream.on("data", (chunk) => chunks.push(chunk));
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

const fileTemplate = [
  {
    key: "cv",
    label: { en: "CV", es: "CV", gl: "CV" },
    kind: "file" as const,
    required: false,
    shareable_with_sponsors: true,
  },
  {
    key: "private_doc",
    label: { en: "Private document", es: "Documento privado", gl: "Documento privado" },
    kind: "file" as const,
    required: false,
  },
];

async function putUpload(
  applicationId: number,
  userId: number,
  fieldKey: string,
  filename: string,
): Promise<string> {
  const { putObject } = await import("../../src/lib/storage.js");
  const key = `uploads/${applicationId}/${userId}/${fieldKey}/${Date.now()}-${userId}/${filename}`;
  await putObject(key, Buffer.from(`content for ${filename}`), "application/octet-stream");
  return key;
}

describe("batch application export (H56)", () => {
  it("requires exports:run for both the catalog and the ZIP", async () => {
    const user = await createUser();
    const catalog = await app.inject({
      method: "GET",
      url: "/api/exports/applications/catalog",
      headers: asUser(user),
    });
    expect(catalog.statusCode).toBe(403);

    const exportResponse = await app.inject({
      method: "POST",
      url: "/api/exports/applications.zip",
      headers: { ...asUser(user), "content-type": "application/json" },
      payload: {
        statuses: ["accepted"],
        fields: [{ source: "profile", key: "email" }],
        documents: "none",
      },
    });
    expect(exportResponse.statusCode).toBe(403);
  });

  it("filters by multiple statuses and emits only the selected profile, metadata, and answer fields", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const applicationId = await createApplication({ name: "Main form" });
    const accepted = await createUser({ name: "Accepted Person", email: "accepted@test.local" });
    const confirmed = await createUser({ name: "Confirmed Person", email: "confirmed@test.local" });
    const rejected = await createUser({ name: "Rejected Person", email: "rejected@test.local" });

    await createResponse(accepted, applicationId, {
      status: "accepted",
      responses: { motivation: "accepted answer", credits: "yes" },
    });
    await createResponse(confirmed, applicationId, {
      status: "confirmed",
      responses: { motivation: "confirmed answer", credits: "no" },
    });
    await createResponse(rejected, applicationId, {
      status: "rejected",
      responses: { motivation: "rejected answer", credits: "no" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/exports/applications.zip",
      headers: { ...asUser(staff), "content-type": "application/json" },
      payload: {
        statuses: ["accepted", "confirmed"],
        fields: [
          { source: "profile", key: "full_name" },
          { source: "profile", key: "email" },
          { source: "metadata", key: "status" },
          { source: "answer", application_id: applicationId, key: "motivation" },
        ],
        documents: "none",
        language: "es",
      },
    });
    expect(response.statusCode).toBe(200);
    const entries = await readZipEntries(response.rawPayload);
    const csv = entries["applications.csv"]?.toString();
    expect(csv).toBeDefined();
    expect(csv).toContain("Nombre completo,Correo electrónico,Estado,Main form — Por qué");
    expect(csv).toContain("Accepted Person,accepted@test.local,accepted,accepted answer");
    expect(csv).toContain("Confirmed Person,confirmed@test.local,confirmed,confirmed answer");
    expect(csv).not.toContain("rejected@test.local");
    expect(Object.keys(entries)).toEqual(["applications.csv"]);
  });

  it("exports every saved file or only shareable files with explicit applicant consent", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const applicationId = await createApplication({
      name: "Documents form",
      template: fileTemplate,
    });
    const consenting = await createUser({ email: "consenting@test.local" });
    const declining = await createUser({ email: "declining@test.local" });
    const consentingKey = await putUpload(applicationId, consenting, "cv", "resume.pdf");
    const decliningKey = await putUpload(applicationId, declining, "cv", "resume.txt");
    const privateKey = await putUpload(applicationId, declining, "private_doc", "id.pdf");

    const consentingResponseId = await createResponse(consenting, applicationId, {
      status: "accepted",
      responses: { cv: consentingKey, [sponsorShareKey("cv")]: true },
    });
    const decliningResponseId = await createResponse(declining, applicationId, {
      status: "accepted",
      responses: {
        cv: decliningKey,
        private_doc: privateKey,
        [sponsorShareKey("cv")]: false,
      },
    });

    const request = (documents: "all" | "shared") =>
      app.inject({
        method: "POST",
        url: "/api/exports/applications.zip",
        headers: { ...asUser(staff), "content-type": "application/json" },
        payload: {
          statuses: ["accepted"],
          fields: [{ source: "profile", key: "email" }],
          documents,
        },
      });

    const all = await request("all");
    expect(all.statusCode).toBe(200);
    const allEntries = await readZipEntries(all.rawPayload);
    expect(Object.keys(allEntries).sort()).toEqual(
      [
        "applications.csv",
        `documents/application-${applicationId}/${consentingResponseId}-consenting@test.local/cv-resume.pdf`,
        `documents/application-${applicationId}/${decliningResponseId}-declining@test.local/cv-resume.txt`,
        `documents/application-${applicationId}/${decliningResponseId}-declining@test.local/private_doc-id.pdf`,
      ].sort(),
    );

    const shared = await request("shared");
    expect(shared.statusCode).toBe(200);
    const sharedEntries = await readZipEntries(shared.rawPayload);
    expect(Object.keys(sharedEntries).sort()).toEqual([
      "applications.csv",
      `documents/application-${applicationId}/${consentingResponseId}-consenting@test.local/cv-resume.pdf`,
    ]);
  });

  it("rejects an answer field that does not belong to the selected application", async () => {
    const staff = await createUserWithCapabilities([CAPABILITIES.EXPORTS_RUN]);
    const response = await app.inject({
      method: "POST",
      url: "/api/exports/applications.zip",
      headers: { ...asUser(staff), "content-type": "application/json" },
      payload: {
        statuses: ["accepted"],
        fields: [{ source: "answer", application_id: 999999, key: "not_a_field" }],
        documents: "none",
      },
    });
    expect(response.statusCode).toBe(400);
  });
});
