import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import { admitParticipant } from "../projects/fixtures.js";

/**
 * #934/#935: account photo and CV in private object storage, plus the bio and
 * social links of the public profile. Runs against the real object store.
 */

const VISIBLE = {
  directoryVisible: true,
  showSurname: false,
  showPhoto: false,
  showProject: true,
  headline: null,
  locationNote: null,
};

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("png-body"),
]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBPVP8 body"),
]);
const PDF = Buffer.from("%PDF-1.7\n% test cv\n%%EOF\n");

let app: App;
let reader: number;
let keySeq = 0;

beforeAll(async () => {
  app = await buildTestApp();
});
beforeEach(async () => {
  await truncateAll();
  reader = await createUserWithCapabilities([CAPABILITIES.DIRECTORY_READ]);
});
afterAll(async () => {
  await app.close();
});

async function person(name = "Ana", surname = "Pérez") {
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, surname, email_verified)
     VALUES ($1, $2, $3, true) RETURNING id`,
    [`${crypto.randomUUID()}@files.test`, name, surname],
  );
  const id = rows[0].id as number;
  await admitParticipant(id);
  return id;
}

function multipart(bytes: Buffer, filename: string, contentType: string) {
  const boundary = `----hackos-${crypto.randomUUID()}`;
  return {
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

function upload(
  url: string,
  userId: number,
  bytes: Buffer,
  filename: string,
  contentType: string,
  key = `u-${++keySeq}`,
) {
  const body = multipart(bytes, filename, contentType);
  return app.inject({
    method: "POST",
    url,
    headers: { ...asUser(userId), ...body.headers, "idempotency-key": key },
    payload: body.payload,
  });
}

function remove(url: string, userId: number, key = `d-${++keySeq}`) {
  return app.inject({
    method: "DELETE",
    url,
    headers: { ...asUser(userId), "idempotency-key": key },
  });
}

function putProfile(userId: number, payload: Record<string, unknown>, key = `p-${++keySeq}`) {
  return app.inject({
    method: "PUT",
    url: "/api/me/public-profile",
    headers: { ...asUser(userId), "idempotency-key": key },
    payload,
  });
}

function get(url: string, userId?: number) {
  return app.inject({ method: "GET", url, headers: userId ? asUser(userId) : {} });
}

async function stored(key: string | null | undefined): Promise<boolean> {
  const { objectExists } = await import("../../src/lib/storage.js");
  return Boolean(key) && objectExists(key as string);
}

async function photoKey(userId: number): Promise<string | null> {
  const { rows } = await pool.query(`SELECT photo_key FROM users WHERE id = $1`, [userId]);
  return rows[0]?.photo_key ?? null;
}

async function cvKey(userId: number): Promise<string | null> {
  const { rows } = await pool.query(`SELECT cv_key FROM user_public_profiles WHERE user_id = $1`, [
    userId,
  ]);
  return rows[0]?.cv_key ?? null;
}

describe("bio and social links (#935)", () => {
  it("normalizes links, shows them to readers and audits only field names", async () => {
    const me = await person();
    const res = await putProfile(me, {
      ...VISIBLE,
      bio: "  Line one\r\nLine two  ",
      socials: [
        { kind: "github", url: "github.com/ana" },
        { kind: "linkedin", url: "https://WWW.LinkedIn.com/in/ana" },
      ],
    });
    expect(res.statusCode).toBe(200);
    const socials = [
      { kind: "github", url: "https://github.com/ana" },
      { kind: "linkedin", url: "https://www.linkedin.com/in/ana" },
    ];
    expect(res.json()).toMatchObject({
      bio: "Line one\nLine two",
      socials,
      shareCv: false,
      cv: null,
      preview: { bio: "Line one\nLine two", socials, cvUrl: null },
    });
    const entry = await get(`/api/directory/${me}`, reader);
    expect(entry.json()).toMatchObject({ bio: "Line one\nLine two", socials, cvUrl: null });

    const { rows } = await pool.query(
      `SELECT after FROM audit_log WHERE action = 'public_profile.updated'`,
    );
    expect(rows[0].after.changedFields).toEqual(["directoryVisible", "bio", "socials"]);
    expect(JSON.stringify(rows)).not.toMatch(/github|linkedin|Line one/);
  });

  it("keeps omitted fields and clears explicit nulls", async () => {
    const me = await person();
    await putProfile(me, {
      ...VISIBLE,
      bio: "Kept",
      socials: [{ kind: "website", url: "https://ana.dev" }],
    });
    const kept = await putProfile(me, { ...VISIBLE, headline: "New" });
    expect(kept.json()).toMatchObject({
      headline: "New",
      bio: "Kept",
      socials: [{ kind: "website", url: "https://ana.dev/" }],
    });
    const cleared = await putProfile(me, { ...VISIBLE, bio: null, socials: [] });
    expect(cleared.json()).toMatchObject({ bio: null, socials: [] });
  });

  it("rejects invalid links, too many or repeated links and invalid bios", async () => {
    const me = await person();
    const invalid = [
      { socials: [{ kind: "github", url: "http://github.com/ana" }] },
      { socials: [{ kind: "other", url: "javascript:alert(1)" }] },
      { socials: [{ kind: "other", url: "https://user:pass@example.com" }] },
      { socials: [{ kind: "other", url: "localhost" }] },
      { socials: [{ kind: "mastodon", url: "https://example.com" }] },
      {
        socials: Array.from({ length: 7 }, (_, i) => ({
          kind: "other",
          url: `https://example.com/${i}`,
        })),
      },
      {
        socials: [
          { kind: "github", url: "github.com/ana" },
          { kind: "other", url: "https://github.com/ana" },
        ],
      },
      { bio: "x".repeat(501) },
      { bio: "a\u0007b" },
    ];
    for (const fields of invalid) {
      const res = await putProfile(me, { ...VISIBLE, ...fields });
      expect(res.statusCode, JSON.stringify(fields)).toBe(400);
    }
    const max = await putProfile(me, {
      ...VISIBLE,
      socials: Array.from({ length: 6 }, (_, i) => ({
        kind: "other",
        url: `https://example.com/${i}`,
      })),
    });
    expect(max.statusCode).toBe(200);
  });

  it("refuses to share a CV before one is uploaded", async () => {
    const me = await person();
    const res = await putProfile(me, { ...VISIBLE, shareCv: true });
    expect(res.statusCode).toBe(400);
  });

  it("moderation clears the bio and links and stops sharing the CV", async () => {
    const me = await person();
    expect(
      (await upload("/api/me/public-profile/cv", me, PDF, "cv.pdf", "application/pdf")).statusCode,
    ).toBe(200);
    await putProfile(me, {
      ...VISIBLE,
      bio: "Rude",
      socials: [{ kind: "x", url: "https://x.com/ana" }],
      shareCv: true,
    });
    const staff = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
    const res = await app.inject({
      method: "DELETE",
      url: `/api/users/${me}/public-profile`,
      headers: { ...asUser(staff), "idempotency-key": "moderate" },
      payload: { reason: "Offensive bio" },
    });
    expect(res.statusCode).toBe(204);
    const { rows } = await pool.query(
      `SELECT bio, socials, share_cv FROM user_public_profiles WHERE user_id = $1`,
      [me],
    );
    expect(rows[0]).toEqual({ bio: null, socials: [], share_cv: false });
  });
});

describe("profile CV (#935)", () => {
  it("is downloadable by readers only while shared and visible", async () => {
    const me = await person();
    const up = await upload(
      "/api/me/public-profile/cv",
      me,
      PDF,
      "Ana Pérez CV.pdf",
      "application/pdf",
    );
    expect(up.statusCode).toBe(200);
    expect(up.json().cv).toMatchObject({ filename: "Ana Pérez CV.pdf" });
    const key = await cvKey(me);
    expect(key).toMatch(new RegExp(`^profiles/${me}/cv/[0-9a-f]{32}\\.pdf$`));
    expect(await stored(key)).toBe(true);

    // Not shared yet: hidden from readers, still downloadable by the owner.
    await putProfile(me, VISIBLE);
    expect((await get(`/api/directory/${me}`, reader)).json().cvUrl).toBeNull();
    expect((await get(`/api/directory/${me}/cv`, reader)).statusCode).toBe(404);
    const own = await get("/api/me/public-profile/cv", me);
    expect(own.statusCode).toBe(200);
    expect(own.headers["content-type"]).toBe("application/pdf");
    expect(own.rawPayload.equals(PDF)).toBe(true);

    const shared = await putProfile(me, { ...VISIBLE, shareCv: true });
    expect(shared.json().preview.cvUrl).toBe("/api/me/public-profile/cv");
    expect((await get(`/api/directory/${me}`, reader)).json().cvUrl).toBe(
      `/api/directory/${me}/cv`,
    );
    const download = await get(`/api/directory/${me}/cv`, reader);
    expect(download.statusCode).toBe(200);
    expect(download.headers["cache-control"]).toBe("private, no-store");
    expect(download.headers["content-disposition"]).toContain(
      "filename*=UTF-8''Ana%20P%C3%A9rez%20CV.pdf",
    );
    expect(download.rawPayload.equals(PDF)).toBe(true);

    // Readers without the capability, without event access or of a hidden profile.
    const participant = await person("Other", "Participant");
    expect((await get(`/api/directory/${me}/cv`, participant)).statusCode).toBe(403);
    expect((await get(`/api/directory/${me}/cv`)).statusCode).toBe(401);
    await putProfile(me, { ...VISIBLE, directoryVisible: false, shareCv: true });
    expect((await get(`/api/directory/${me}/cv`, reader)).statusCode).toBe(404);
  });

  it("rejects non-PDF, oversize and empty uploads and non-attendees", async () => {
    const me = await person();
    const url = "/api/me/public-profile/cv";
    expect((await upload(url, me, PNG, "cv.pdf", "application/pdf")).statusCode).toBe(400);
    const oversize = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]);
    expect((await upload(url, me, oversize, "cv.pdf", "application/pdf")).statusCode).toBe(400);
    expect((await upload(url, me, Buffer.alloc(0), "cv.pdf", "application/pdf")).statusCode).toBe(
      400,
    );
    const outsider = await createUser();
    expect((await upload(url, outsider, PDF, "cv.pdf", "application/pdf")).statusCode).toBe(403);
    expect(await cvKey(me)).toBeNull();
  });

  it("replaces the previous object, replays a retried upload and removes the CV", async () => {
    const me = await person();
    const url = "/api/me/public-profile/cv";
    await upload(url, me, PDF, "first.pdf", "application/pdf");
    const first = await cvKey(me);
    const second = await upload(url, me, PDF, "second.pdf", "application/pdf", "same-cv");
    const replay = await upload(url, me, PDF, "second.pdf", "application/pdf", "same-cv");
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(second.json());
    const current = await cvKey(me);
    expect(current).not.toBe(first);
    expect(await stored(first)).toBe(false);
    expect(await stored(current)).toBe(true);
    const { rows } = await pool.query(
      `SELECT after FROM audit_log WHERE action = 'public_profile.updated' ORDER BY id`,
    );
    expect(rows.map((row) => row.after.changedFields)).toEqual([["cv"], ["cv"]]);

    await putProfile(me, { ...VISIBLE, shareCv: true });
    const removed = await remove(url, me);
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ cv: null, shareCv: false });
    expect(await stored(current)).toBe(false);
    expect((await get("/api/me/public-profile/cv", me)).statusCode).toBe(404);
    expect((await remove(url, me)).statusCode).toBe(200);
  });
});

describe("account photo (#934)", () => {
  it("is stored privately and served only to permitted readers", async () => {
    const me = await person();
    const up = await upload("/api/me/photo", me, PNG, "me.gif", "image/gif");
    expect(up.statusCode).toBe(200);
    const key = await photoKey(me);
    expect(key).toMatch(new RegExp(`^profiles/${me}/photo/[0-9a-f]{32}\\.png$`));
    const image = `/api/users/${me}/photo?v=${key?.split("/").pop()?.slice(0, 12)}`;
    expect(up.json()).toEqual({ image });
    expect((await get("/api/me", me)).json().image).toBe(image);

    const own = await get(image, me);
    expect(own.statusCode).toBe(200);
    expect(own.headers["content-type"]).toBe("image/png");
    expect(own.headers["x-content-type-options"]).toBe("nosniff");
    expect(own.headers["cache-control"]).toBe("private, max-age=300");
    expect(own.rawPayload.equals(PNG)).toBe(true);

    // The directory sees it only while the profile is visible with the photo on.
    expect((await get(image)).statusCode).toBe(401);
    expect((await get(image, reader)).statusCode).toBe(404);
    await putProfile(me, VISIBLE);
    expect((await get(image, reader)).statusCode).toBe(404);
    expect((await get(`/api/directory/${me}`, reader)).json().photoUrl).toBeNull();
    await putProfile(me, { ...VISIBLE, showPhoto: true });
    expect((await get(`/api/directory/${me}`, reader)).json().photoUrl).toBe(image);
    expect((await get(image, reader)).statusCode).toBe(200);
    const participant = await person("Other", "Participant");
    expect((await get(image, participant)).statusCode).toBe(404);

    // Staff who read users see it regardless of the directory.
    await putProfile(me, VISIBLE);
    const staff = await createUserWithCapabilities([CAPABILITIES.USERS_READ]);
    expect((await get(image, staff)).statusCode).toBe(200);
    expect((await get(`/api/users/${me}`, staff)).json().image).toBe(image);
  });

  it("rejects unsupported, oversize and empty images and the old URL field", async () => {
    const me = await person();
    const url = "/api/me/photo";
    expect(
      (await upload(url, me, Buffer.from("GIF89a...."), "a.gif", "image/gif")).statusCode,
    ).toBe(400);
    expect((await upload(url, me, PDF, "a.png", "image/png")).statusCode).toBe(400);
    const oversize = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    expect((await upload(url, me, oversize, "a.png", "image/png")).statusCode).toBe(400);
    expect((await upload(url, me, Buffer.alloc(0), "a.png", "image/png")).statusCode).toBe(400);
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: asUser(me),
      payload: { image: "https://tracker.example/pixel.png" },
    });
    expect(patch.statusCode).toBe(400);
    expect(await photoKey(me)).toBeNull();
  });

  it("deletes the replaced object, replays a retried upload and removes the photo", async () => {
    const me = await person();
    await upload("/api/me/photo", me, PNG, "a.png", "image/png");
    const first = await photoKey(me);
    const second = await upload("/api/me/photo", me, WEBP, "b.webp", "image/webp", "same-photo");
    const replay = await upload("/api/me/photo", me, WEBP, "b.webp", "image/webp", "same-photo");
    expect(replay.json()).toEqual(second.json());
    const current = await photoKey(me);
    expect(current).toMatch(/\.webp$/);
    expect(await stored(first)).toBe(false);
    expect(await stored(current)).toBe(true);
    expect((await get(second.json().image, me)).headers["content-type"]).toBe("image/webp");

    const removed = await remove("/api/me/photo", me);
    expect(removed.json()).toEqual({ image: null });
    expect(await stored(current)).toBe(false);
    expect((await get(second.json().image, me)).statusCode).toBe(404);
    const { rows } = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'user' AND entity_id = $1 ORDER BY id`,
      [String(me)],
    );
    expect(rows.map((row) => row.action)).toEqual([
      "user.photo_updated",
      "user.photo_updated",
      "user.photo_removed",
    ]);
  });
});

describe("account removal and export (H54)", () => {
  it("exports photo and profile metadata, then removal deletes every profile object", async () => {
    const admin = await createUserWithCapabilities(["*"]);
    const me = await person();
    await upload("/api/me/photo", me, PNG, "a.png", "image/png");
    await upload("/api/me/public-profile/cv", me, PDF, "cv.pdf", "application/pdf");
    await putProfile(me, {
      ...VISIBLE,
      bio: "Exported",
      socials: [{ kind: "github", url: "github.com/ana" }],
      shareCv: true,
    });
    const photo = await photoKey(me);
    const cv = await cvKey(me);

    const { buildExportBundle } = await import("../../src/modules/exports/bundle.js");
    const bundle = await buildExportBundle(me);
    expect((bundle.subject as Record<string, unknown>).photo).toMatchObject({
      contentType: "image/png",
      uploadedAt: expect.any(Date),
    });
    expect(bundle.publicProfile).toMatchObject({
      bio: "Exported",
      socials: [{ kind: "github", url: "https://github.com/ana" }],
      share_cv: true,
      cv_filename: "cv.pdf",
    });

    // Operational history forces anonymization, which keeps no users row identity.
    await pool.query(`UPDATE users SET badge_id = 'B-FILES-ANON' WHERE id = $1`, [me]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id) VALUES ($1, 'B-FILES-ANON', $2)`,
      [me, admin],
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: asUser(admin),
      payload: { subjectUserId: me, type: "deletion" },
    });
    expect(created.statusCode).toBe(201);
    const { processDataSubjectRequest } = await import("../../src/modules/exports/worker.js");
    await processDataSubjectRequest(created.json().id);
    expect(await stored(photo)).toBe(false);
    expect(await stored(cv)).toBe(false);
    const { rows } = await pool.query(`SELECT photo_key FROM users WHERE id = $1`, [me]);
    expect(rows[0]?.photo_key ?? null).toBeNull();
  });
});
