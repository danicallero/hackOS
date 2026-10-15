import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import { asUser, buildTestApp, createUser, truncateAll } from "../helpers.js";
import { admitParticipant, setHackingWindow } from "./fixtures.js";

/** H16 photo-list fields and H19 invites addressed to diary contacts. */

let app: App;
let owner: number;
let keySeq = 0;
const PDF = Buffer.from("%PDF-1.7\n% test\n%%EOF\n");

beforeEach(async () => {
  await truncateAll();
  app ??= await buildTestApp();
  owner = await createUser();
  await admitParticipant(owner);
  await setHackingWindow(true);
  await pool.query(
    `INSERT INTO project_form_versions(template) VALUES('[{"key":"photos","kind":"images","required":true,"label":{"en":"Photos","es":"Fotos","gl":"Fotos"}}]')`,
  );
});
afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function create() {
  const r = await app.inject({
    method: "POST",
    url: "/api/me/projects",
    headers: asUser(owner),
    payload: { name: "Photo project" },
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().id as number;
}

function upload(id: number, bytes: Buffer, filename: string, contentType: string) {
  const boundary = `----hackos-${crypto.randomUUID()}`;
  return app.inject({
    method: "POST",
    url: `/api/me/projects/${id}/uploads?fieldKey=photos`,
    headers: {
      ...asUser(owner),
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "idempotency-key": `upload-${++keySeq}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}

const png = (color: string) =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: color } })
    .png()
    .toBuffer();

describe("Project photo fields (H16)", () => {
  it("stores several photos, lists them as files and submits", async () => {
    const id = await create();
    const first = await upload(id, await png("red"), "one.png", "image/png");
    const second = await upload(id, await png("blue"), "two.png", "image/png");
    expect(first.statusCode, first.body).toBe(200);
    expect(second.statusCode, second.body).toBe(200);
    const keys = [first.json().objectKey, second.json().objectKey];
    expect(first.json().thumbnailUrl).toContain("thumbnail=true");
    const save = await app.inject({
      method: "PUT",
      url: `/api/me/projects/${id}/draft`,
      headers: asUser(owner),
      payload: { responses: { photos: keys }, revision: 0 },
    });
    expect(save.statusCode, save.body).toBe(200);
    const project = await app.inject({ url: `/api/me/projects/${id}`, headers: asUser(owner) });
    expect(
      project
        .json()
        .files.map((file: { objectKey: string }) => file.objectKey)
        .sort(),
    ).toEqual([...keys].sort());
    const submit = await app.inject({
      method: "POST",
      url: `/api/me/projects/${id}/submit`,
      headers: asUser(owner),
    });
    expect(submit.statusCode, submit.body).toBe(200);
  });

  it("refuses documents, foreign keys and lists over the limit", async () => {
    const id = await create();
    const pdf = await upload(id, PDF, "doc.pdf", "application/pdf");
    expect(pdf.statusCode).toBe(400);
    const foreign = await app.inject({
      method: "PUT",
      url: `/api/me/projects/${id}/draft`,
      headers: asUser(owner),
      payload: { responses: { photos: ["projects/999/x/y.png"] }, revision: 0 },
    });
    expect(foreign.statusCode).toBe(200);
    const submitForeign = await app.inject({
      method: "POST",
      url: `/api/me/projects/${id}/submit`,
      headers: asUser(owner),
    });
    expect(submitForeign.statusCode).toBe(400);
    await app.inject({
      method: "PUT",
      url: `/api/me/projects/${id}/draft`,
      headers: asUser(owner),
      payload: {
        responses: { photos: Array.from({ length: 11 }, (_, index) => `k${index}`) },
        revision: 1,
      },
    });
    const tooMany = await app.inject({
      method: "POST",
      url: `/api/me/projects/${id}/submit`,
      headers: asUser(owner),
    });
    expect(tooMany.statusCode).toBe(400);
  });

  it("application forms cannot define photo fields", async () => {
    const { createUserWithCapabilities } = await import("../helpers.js");
    const { CAPABILITIES } = await import("@hackos/shared/capabilities");
    const admin = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_MANAGE]);
    const r = await app.inject({
      method: "POST",
      url: "/api/applications",
      headers: asUser(admin),
      payload: {
        name: "Form",
        template: [{ key: "p", kind: "images", label: { en: "P", es: "P", gl: "P" } }],
      },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe("Invites to diary contacts (H19)", () => {
  async function invite(id: number, body: object) {
    return app.inject({
      method: "POST",
      url: `/api/me/projects/${id}/invites`,
      headers: { ...asUser(owner), "idempotency-key": `invite-${++keySeq}` },
      payload: body,
    });
  }

  it("invites a scanned contact by user id", async () => {
    const id = await create();
    const contact = await createUser();
    await admitParticipant(contact);
    await pool.query(`INSERT INTO diary_entries(owner_id,target_user_id) VALUES($1,$2)`, [
      owner,
      contact,
    ]);
    const r = await invite(id, { userId: contact });
    expect(r.statusCode, r.body).toBe(200);
    const { rows } = await pool.query(
      `SELECT status FROM submissions WHERE repo_id=$1 AND user_id=$2`,
      [id, contact],
    );
    expect(rows[0].status).toBe("invited");
  });

  it("answers 404 for a user id that is not a contact, and 400 for an empty body", async () => {
    const id = await create();
    const stranger = await createUser();
    await admitParticipant(stranger);
    expect((await invite(id, { userId: stranger })).statusCode).toBe(404);
    expect((await invite(id, {})).statusCode).toBe(400);
    const { rowCount } = await pool.query(`SELECT 1 FROM submissions WHERE user_id=$1`, [stranger]);
    expect(rowCount).toBe(0);
  });
});
