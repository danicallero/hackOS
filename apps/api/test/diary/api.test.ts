import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createRole,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import { admitParticipant } from "../projects/fixtures.js";

/** #935: the private event diary of saved people and sponsor stands. */

let app: App;
let owner: number;
let keySeq = 0;

beforeAll(async () => {
  app = await buildTestApp();
});
beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  owner = await createUserWithCapabilities([CAPABILITIES.DIRECTORY_READ]);
});
afterAll(async () => {
  await app.close();
});

const PERSONAL_KEYS = ["email", "badgeId", "dni", "foodIntolerances", "surname", "notes"];

/** An admitted attendee with a badge, a ticket and (optionally) a visible profile. */
async function person(name: string, options: { visible?: boolean } = {}) {
  const badge = `04${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, name, surname, email_verified, dni, badge_id)
     VALUES ($1, $2, 'Secret-Surname', true, $3, $4) RETURNING id`,
    [`${crypto.randomUUID()}@diary.test`, name, `DNI-${crypto.randomUUID()}`, badge],
  );
  const id = rows[0].id as number;
  await admitParticipant(id);
  const ticket = `T-${crypto.randomUUID()}`;
  await pool.query(`INSERT INTO tickets (user_id, token) VALUES ($1, $2)`, [id, ticket]);
  if (options.visible ?? true) {
    await pool.query(
      `INSERT INTO user_public_profiles (user_id, directory_visible, headline, consented_at)
       VALUES ($1, true, 'Builds robots', now())`,
      [id],
    );
  }
  return { id, badge, ticket };
}

async function enterprise(name: string, visibility: "visible" | "hidden" = "visible") {
  const { rows } = await pool.query(
    `INSERT INTO enterprises (name, visibility, description, website)
     VALUES ($1, $2, 'We make things', 'https://example.test') RETURNING id`,
    [name, visibility],
  );
  return rows[0].id as number;
}

async function challenge(enterpriseId: number, title: string, visibility: "visible" | "hidden") {
  const { rows: users } = await pool.query(
    `INSERT INTO users (email, email_verified) VALUES ($1, true) RETURNING id`,
    [`${crypto.randomUUID()}@sponsor.test`],
  );
  const { rows: sponsors } = await pool.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
    [enterpriseId, users[0].id],
  );
  await pool.query(`INSERT INTO challenges (author, title, visibility) VALUES ($1, $2, $3)`, [
    sponsors[0].id,
    title,
    visibility,
  ]);
}

async function standTag(enterpriseId: number, code: string, kind: "nfc" | "qr" = "nfc") {
  await pool.query(
    `INSERT INTO sponsor_stand_tags (enterprise_id, kind, code) VALUES ($1, $2, $3)`,
    [enterpriseId, kind, code],
  );
}

function scan(code: string, as = owner, key = `scan-${++keySeq}`) {
  return app.inject({
    method: "POST",
    url: "/api/me/diary/scan",
    headers: { ...asUser(as), "idempotency-key": key },
    payload: { code },
  });
}

function saveFromDirectory(userId: number, as = owner) {
  return app.inject({
    method: "POST",
    url: "/api/me/diary/people",
    headers: { ...asUser(as), "idempotency-key": `save-${++keySeq}` },
    payload: { userId },
  });
}

function list(as = owner) {
  return app.inject({ method: "GET", url: "/api/me/diary", headers: asUser(as) });
}

async function rowCount(): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM diary_entries`);
  return rows[0].n;
}

describe("scanning people", () => {
  it("saves a visible person's public card by badge, and a re-scan is a no-op", async () => {
    const ana = await person("Ana");
    const first = await scan(ana.badge);
    expect(first.statusCode).toBe(201);
    const entry = first.json();
    expect(entry).toMatchObject({
      kind: "person",
      starred: false,
      note: null,
      sponsor: null,
      person: { userId: ana.id, displayName: "Ana S.", headline: "Builds robots" },
    });
    for (const key of PERSONAL_KEYS) expect(entry.person).not.toHaveProperty(key);
    expect(JSON.stringify(entry)).not.toContain(ana.badge);
    expect(JSON.stringify(entry)).not.toContain("Secret-Surname");

    const again = await scan(ana.badge);
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(entry.id);
    expect(await rowCount()).toBe(1);
  });

  it("resolves a ticket QR to its holder", async () => {
    const ana = await person("Ana");
    const res = await scan(ana.ticket);
    expect(res.statusCode).toBe(201);
    expect(res.json().person.userId).toBe(ana.id);
  });

  it("reveals nothing and stores nothing for a hidden profile", async () => {
    const hidden = await person("Hidden", { visible: false });
    const res = await scan(hidden.badge);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("profile_not_shared");
    expect(res.body).not.toContain("Hidden");
    expect(res.body).not.toContain(String(hidden.id));
    expect(await rowCount()).toBe(0);
  });

  it("answers unknown and revoked badges without storing anything", async () => {
    const unknown = await scan("04AABBCCDDEEFF");
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("diary_code_unknown");

    const ana = await person("Ana");
    await pool.query(
      `UPDATE users SET badge_id_history = ARRAY[badge_id], badge_id = '04000000000001' WHERE id = $1`,
      [ana.id],
    );
    const revoked = await scan(ana.badge);
    expect(revoked.statusCode).toBe(409);
    expect(revoked.json().error.code).toBe("badge_revoked");
    expect(await rowCount()).toBe(0);
  });

  it("refuses the caller's own badge", async () => {
    await pool.query(`UPDATE users SET badge_id = '04111111111111' WHERE id = $1`, [owner]);
    const res = await scan("04111111111111");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("diary_self");
  });

  it("requires directory:read to save people but not stands", async () => {
    const sponsorRole = await createRole([]);
    const rep = await createUser();
    await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [
      rep,
      sponsorRole,
    ]);
    const ana = await person("Ana");
    const res = await scan(ana.badge, rep);
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("Ana");

    const acme = await enterprise("Acme");
    await standTag(acme, "04ACAC00000001");
    expect((await scan("04ACAC00000001", rep)).statusCode).toBe(201);
  });

  it("requires event access", async () => {
    const outsider = await createUser();
    expect((await list(outsider)).statusCode).toBe(403);
    const acme = await enterprise("Acme");
    await standTag(acme, "04ACAC00000001");
    expect((await scan("04ACAC00000001", outsider)).statusCode).toBe(403);
  });

  it("converges concurrent saves of the same person on one row", async () => {
    const ana = await person("Ana");
    const results = await Promise.all([scan(ana.badge), scan(ana.badge), scan(ana.badge)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 201]);
    expect(new Set(results.map((r) => r.json().id)).size).toBe(1);
    expect(await rowCount()).toBe(1);
  });

  it("replays a retried request with the same Idempotency-Key", async () => {
    const ana = await person("Ana");
    const first = await scan(ana.badge, owner, "same-key");
    const replay = await scan(ana.badge, owner, "same-key");
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(await rowCount()).toBe(1);
  });

  it("rate-limits scan lookups per account", async () => {
    const { DIARY_SCAN_RATE_LIMIT } = await import("../../src/modules/diary/routes.js");
    for (let i = 0; i < DIARY_SCAN_RATE_LIMIT.max; i++) {
      expect((await scan(`04FFFFFFFFFF${String(i).padStart(2, "0")}`)).statusCode).toBe(404);
    }
    const limited = await scan("04FFFFFFFFFFAA");
    expect(limited.statusCode).toBe(429);
    const other = await createUserWithCapabilities([CAPABILITIES.DIRECTORY_READ]);
    expect((await scan("04FFFFFFFFFFAA", other)).statusCode).toBe(404);
  });
});

describe("scanning sponsor stands", () => {
  it("saves a revealed sponsor's public card with its published challenges", async () => {
    const acme = await enterprise("Acme");
    await challenge(acme, "Robots", "visible");
    await challenge(acme, "Secret", "hidden");
    await standTag(acme, "04ACAC00000001");
    await standTag(acme, "STAND-ABCDEFGHJKMNPQRS", "qr");

    const res = await scan("04acac00000001");
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      kind: "sponsor",
      person: null,
      sponsor: {
        enterpriseId: acme,
        name: "Acme",
        description: "We make things",
        website: "https://example.test",
        challenges: [{ name: "Robots" }],
      },
    });
    const viaQr = await scan("STAND-ABCDEFGHJKMNPQRS");
    expect(viaQr.statusCode).toBe(200);
    expect(viaQr.json().id).toBe(res.json().id);
  });

  it("does not save a sponsor that has not been revealed", async () => {
    const hidden = await enterprise("Stealth", "hidden");
    await standTag(hidden, "04ACAC00000002");
    const res = await scan("04ACAC00000002");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("stand_unavailable");
    expect(res.body).not.toContain("Stealth");
    expect(await rowCount()).toBe(0);
  });
});

describe("saving from the directory", () => {
  it("saves a visible person and answers 404 for hidden, missing or self", async () => {
    const ana = await person("Ana");
    const hidden = await person("Hidden", { visible: false });
    const saved = await saveFromDirectory(ana.id);
    expect(saved.statusCode).toBe(201);
    expect(saved.json().person.userId).toBe(ana.id);
    expect((await saveFromDirectory(ana.id)).statusCode).toBe(200);
    expect((await saveFromDirectory(hidden.id)).statusCode).toBe(404);
    expect((await saveFromDirectory(999_999)).statusCode).toBe(404);
    expect((await saveFromDirectory(owner)).statusCode).toBe(404);
    expect(await rowCount()).toBe(1);
  });

  it("requires directory:read", async () => {
    const ana = await person("Ana");
    const role = await createRole([]);
    const reader = await createUser();
    await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [reader, role]);
    expect((await saveFromDirectory(ana.id, reader)).statusCode).toBe(403);
  });
});

describe("reading and editing the diary", () => {
  it("lists favourites first and reflects current visibility", async () => {
    const ana = await person("Ana");
    const bea = await person("Bea");
    const acme = await enterprise("Acme");
    await standTag(acme, "04ACAC00000001");
    const a = (await scan(ana.badge)).json();
    await scan(bea.badge);
    await scan("04ACAC00000001");

    const starred = await app.inject({
      method: "PATCH",
      url: `/api/me/diary/${a.id}`,
      headers: { ...asUser(owner), "idempotency-key": "star" },
      payload: { starred: true, note: "  Talk about ROS  " },
    });
    expect(starred.statusCode).toBe(200);
    expect(starred.json()).toMatchObject({ starred: true, note: "Talk about ROS" });

    await pool.query(
      `UPDATE user_public_profiles SET directory_visible = false WHERE user_id = $1`,
      [bea.id],
    );
    await pool.query(`UPDATE enterprises SET visibility = 'hidden' WHERE id = $1`, [acme]);
    const { items } = (await list()).json();
    expect(items.map((item: { kind: string }) => item.kind)).toEqual([
      "person",
      "sponsor",
      "person",
    ]);
    expect(items[0]).toMatchObject({ id: a.id, starred: true, person: { userId: ana.id } });
    expect(items[1]).toMatchObject({ kind: "sponsor", sponsor: null });
    expect(items[2]).toMatchObject({ kind: "person", person: null });
    expect(JSON.stringify(items)).not.toContain("Bea");
  });

  it("keeps entries private to their owner", async () => {
    const ana = await person("Ana");
    const entry = (await scan(ana.badge)).json();
    const other = await createUserWithCapabilities([CAPABILITIES.DIRECTORY_READ]);
    expect((await list(other)).json().items).toEqual([]);
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/me/diary/${entry.id}`,
      headers: { ...asUser(other), "idempotency-key": "x" },
      payload: { starred: true },
    });
    expect(patch.statusCode).toBe(404);
    const del = await app.inject({
      method: "DELETE",
      url: `/api/me/diary/${entry.id}`,
      headers: { ...asUser(other), "idempotency-key": "y" },
    });
    expect(del.statusCode).toBe(404);
    expect(await rowCount()).toBe(1);
  });

  it("clears a note, rejects long notes and removes entries", async () => {
    const ana = await person("Ana");
    const entry = (await scan(ana.badge)).json();
    const patch = (payload: Record<string, unknown>, key: string) =>
      app.inject({
        method: "PATCH",
        url: `/api/me/diary/${entry.id}`,
        headers: { ...asUser(owner), "idempotency-key": key },
        payload,
      });
    expect((await patch({ note: "x".repeat(501) }, "long")).statusCode).toBe(400);
    expect((await patch({}, "empty")).statusCode).toBe(400);
    await patch({ note: "hi" }, "n1");
    const cleared = await patch({ note: "" }, "n2");
    expect(cleared.json().note).toBeNull();

    const del = await app.inject({
      method: "DELETE",
      url: `/api/me/diary/${entry.id}`,
      headers: { ...asUser(owner), "idempotency-key": "del" },
    });
    expect(del.statusCode).toBe(204);
    expect(await rowCount()).toBe(0);
  });
});

describe("account removal and export (H54)", () => {
  it("exports the owner's diary without other people's cards", async () => {
    const ana = await person("Ana");
    const entry = (await scan(ana.badge)).json();
    await app.inject({
      method: "PATCH",
      url: `/api/me/diary/${entry.id}`,
      headers: { ...asUser(owner), "idempotency-key": "n" },
      payload: { note: "met at lunch" },
    });
    const { buildExportBundle } = await import("../../src/modules/exports/bundle.js");
    const bundle = await buildExportBundle(owner);
    expect(bundle.diary).toEqual([
      expect.objectContaining({ target_user_id: ana.id, note: "met at lunch" }),
    ]);
    expect(JSON.stringify(bundle.diary)).not.toContain("Ana");
  });

  it("removes the subject's diary and their entries in other diaries", async () => {
    const admin = await createUserWithCapabilities(["*"]);
    const ana = await person("Ana");
    const bea = await person("Bea");
    await pool.query(
      `INSERT INTO diary_entries (owner_id, target_user_id)
       VALUES ($1, $2), ($2, $3), ($3, $2), ($1, $3)`,
      [owner, ana.id, bea.id],
    );
    // Operational history forces anonymization instead of a hard delete.
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id) VALUES ($1, $2, $3)`,
      [ana.id, ana.badge, admin],
    );
    const created = await app.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: asUser(admin),
      payload: { subjectUserId: ana.id, type: "deletion" },
    });
    expect(created.statusCode).toBe(201);
    const { processDataSubjectRequest } = await import("../../src/modules/exports/worker.js");
    await processDataSubjectRequest(created.json().id);

    const { rows } = await pool.query(
      `SELECT owner_id, target_user_id FROM diary_entries ORDER BY owner_id`,
    );
    expect(rows).toEqual([{ owner_id: owner, target_user_id: bea.id }]);
  });
});
