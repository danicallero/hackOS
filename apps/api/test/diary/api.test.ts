import "./env.js";
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
  owner = await createUserWithCapabilities([]);
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

async function enterprise(
  name: string,
  visibility: "visible" | "hidden" = "visible",
  scannable = true,
) {
  const { rows } = await pool.query(
    `INSERT INTO enterprises (name, visibility, description, website, stand_scannable)
     VALUES ($1, $2, 'We make things', 'https://example.test', $3) RETURNING id`,
    [name, visibility, scannable],
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

  it("adds both people to each other's diary when both share a profile", async () => {
    const ana = await person("Ana");
    const ben = await person("Ben");
    expect((await scan(ben.badge, ana.id)).statusCode).toBe(201);
    const bens = (await list(ben.id)).json().items;
    expect(bens).toHaveLength(1);
    expect(bens[0].person.userId).toBe(ana.id);
    expect((await list(ana.id)).json().items[0].person.userId).toBe(ben.id);
    // Re-scanning from either side is idempotent.
    expect((await scan(ben.badge, ana.id)).statusCode).toBe(200);
    expect((await scan(ana.badge, ben.id)).statusCode).toBe(200);
    expect(await rowCount()).toBe(2);
  });

  it("stays one-way while the scanner shares no profile", async () => {
    const ana = await person("Ana");
    const ben = await person("Ben", { visible: false });
    expect((await scan(ana.badge, ben.id)).statusCode).toBe(201);
    expect((await list(ben.id)).json().items).toHaveLength(1);
    expect((await list(ana.id)).json().items).toHaveLength(0);
    expect(await rowCount()).toBe(1);
  });

  it("re-adds a removed reciprocal entry on a new scan without touching the other side", async () => {
    const ana = await person("Ana");
    const ben = await person("Ben");
    await scan(ben.badge, ana.id);
    const anasEntry = (await list(ana.id)).json().items[0];
    const del = await app.inject({
      method: "DELETE",
      url: `/api/me/diary/${anasEntry.id}`,
      headers: { ...asUser(ana.id), "idempotency-key": `del-${++keySeq}` },
    });
    expect(del.statusCode).toBe(204);
    expect((await list(ben.id)).json().items).toHaveLength(1);
    expect((await list(ana.id)).json().items).toHaveLength(0);
    await scan(ben.badge, ana.id);
    expect((await list(ana.id)).json().items).toHaveLength(1);
  });

  it("converges simultaneous mutual scans without deadlock", async () => {
    const ana = await person("Ana");
    const ben = await person("Ben");
    const results = await Promise.all([
      scan(ben.badge, ana.id),
      scan(ana.badge, ben.id),
      scan(ben.badge, ana.id),
      scan(ana.badge, ben.id),
    ]);
    for (const r of results) expect([200, 201]).toContain(r.statusCode);
    expect(await rowCount()).toBe(2);
    expect((await list(ana.id)).json().items).toHaveLength(1);
    expect((await list(ben.id)).json().items).toHaveLength(1);
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

  it("lets any attendee save people, including a sponsor", async () => {
    // A seeded-style Sponsor role: event access and no capabilities.
    const sponsorRole = await createRole([], { name: "Sponsor" });
    const rep = await createUser();
    await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [
      rep,
      sponsorRole,
    ]);
    const ana = await person("Ana");
    const res = await scan(ana.badge, rep);
    expect(res.statusCode).toBe(201);
    expect(res.json().person).toMatchObject({ userId: ana.id, displayName: "Ana S." });
    expect((await list(rep)).json().items[0].person.userId).toBe(ana.id);

    const hidden = await person("Hidden", { visible: false });
    const refused = await scan(hidden.badge, rep);
    expect(refused.json().error.code).toBe("profile_not_shared");
    expect(refused.body).not.toContain("Hidden");

    const acme = await enterprise("Acme");
    await standTag(acme, "04ACAC00000001");
    expect((await scan("04ACAC00000001", rep)).statusCode).toBe(201);
  });

  it("lets an attendee open only the people they saved", async () => {
    const sponsorRole = await createRole([], { name: "Sponsor" });
    const rep = await createUser();
    await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [
      rep,
      sponsorRole,
    ]);
    const ana = await person("Ana");
    const bea = await person("Bea");
    const read = (id: number) =>
      app.inject({ method: "GET", url: `/api/directory/${id}`, headers: asUser(rep) });
    const photo = (id: number) =>
      app.inject({ method: "GET", url: `/api/users/${id}/photo`, headers: asUser(rep) });
    const cv = (id: number) =>
      app.inject({ method: "GET", url: `/api/directory/${id}/cv`, headers: asUser(rep) });
    // Not saved yet: indistinguishable from a hidden or missing person.
    expect((await read(ana.id)).statusCode).toBe(404);
    expect((await scan(ana.badge, rep)).statusCode).toBe(201);
    const opened = await read(ana.id);
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toMatchObject({ userId: ana.id, displayName: "Ana S." });
    expect((await read(bea.id)).statusCode).toBe(404);
    // No photo or CV stored: the same 404 as for someone not saved.
    expect((await photo(ana.id)).statusCode).toBe(404);
    expect((await cv(bea.id)).statusCode).toBe(404);
    // Hiding the profile closes it again, even for those who saved it.
    await pool.query(
      `UPDATE user_public_profiles SET directory_visible = false WHERE user_id = $1`,
      [ana.id],
    );
    expect((await read(ana.id)).statusCode).toBe(404);
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
    const other = await createUserWithCapabilities([]);
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

  it("stays one-way for a stand even when the scanner shares a profile", async () => {
    const ana = await person("Ana");
    const acme = await enterprise("Acme");
    await standTag(acme, "04ACAC00000001");
    expect((await scan("04ACAC00000001", ana.id)).statusCode).toBe(201);
    expect(await rowCount()).toBe(1);
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

  it("collects a company from its tag link, with the same rules as the bare code", async () => {
    const { config } = await import("../../src/config.js");
    const web = config.WEB_URL.replace(/\/+$/, "");
    const acme = await enterprise("Acme");
    const quiet = await enterprise("Quiet", "visible", false);
    await standTag(acme, "04ACAC00000001");
    await standTag(acme, "STAND-ABCDEFGHJKMNPQRS", "qr");
    await standTag(quiet, "04ACAC00000005");

    const viaNfcLink = await scan(`${web}/s/04acac00000001`);
    expect(viaNfcLink.statusCode).toBe(201);
    expect(viaNfcLink.json().sponsor).toMatchObject({ enterpriseId: acme });
    const viaQrLink = await scan(`${web}/s/STAND-ABCDEFGHJKMNPQRS/`);
    expect(viaQrLink.statusCode).toBe(200);
    expect(viaQrLink.json().id).toBe(viaNfcLink.json().id);

    const notScannable = await scan(`${web}/s/04ACAC00000005`);
    expect(notScannable.json().error.code).toBe("stand_unavailable");
    // Another host's link is not a company tag.
    const foreign = await scan("https://evil.example/s/04ACAC00000001");
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe("diary_code_unknown");
    expect(await rowCount()).toBe(1);
  });

  it("never grants a company for scanning its representative's badge", async () => {
    const acme = await enterprise("Acme");
    await standTag(acme, "04ACAC00000001");
    const rep = await person("Rita");
    await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
      acme,
      rep.id,
    ]);
    const res = await scan(rep.badge);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ kind: "person", sponsor: null });
    const collected = await app.inject({
      method: "GET",
      url: "/api/me/diary/sponsors",
      headers: asUser(owner),
    });
    expect(collected.json()).toMatchObject({ collected: 0 });
  });

  it("does not save a revealed sponsor whose stand is not scannable", async () => {
    const quiet = await enterprise("Quiet", "visible", false);
    await standTag(quiet, "04ACAC00000004");
    await standTag(quiet, "STAND-ABCDEFGHJKMNPQRS", "qr");
    for (const code of ["04ACAC00000004", "STAND-ABCDEFGHJKMNPQRS"]) {
      const res = await scan(code);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("stand_unavailable");
      expect(res.body).not.toContain("Quiet");
    }
    expect(await rowCount()).toBe(0);

    await pool.query(`UPDATE enterprises SET stand_scannable = true WHERE id = $1`, [quiet]);
    expect((await scan("04ACAC00000004")).statusCode).toBe(201);
  });
});

describe("the sponsor stand collection", () => {
  function collection(as = owner) {
    return app.inject({ method: "GET", url: "/api/me/diary/sponsors", headers: asUser(as) });
  }

  it("counts revealed tagged stands, in name order, without exposing codes", async () => {
    const acme = await enterprise("Acme");
    const beta = await enterprise("Beta");
    const zeta = await enterprise("Zeta");
    const stealth = await enterprise("Stealth", "hidden");
    const untagged = await enterprise("Untagged", "visible", false);
    await challenge(acme, "Robots", "visible");
    await standTag(acme, "04ACAC00000001");
    await standTag(beta, "04ACAC00000002");
    await standTag(zeta, "STAND-ABCDEFGHJKMNPQRS", "qr");
    await standTag(stealth, "04ACAC00000003");
    await scan("04ACAC00000002");
    await scan("04ACAC00000001");

    const res = await collection();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ total: 3, collected: 2 });
    expect(untagged).toBeGreaterThan(0);
    expect(body.items.map((item: { name: string }) => item.name)).toEqual(["Acme", "Beta", "Zeta"]);
    expect(body.items[0]).toMatchObject({
      enterpriseId: acme,
      challenges: [{ name: "Robots" }],
      entry: { starred: false, note: null },
    });
    expect(body.items[2].entry).toBeNull();
    expect(res.body).not.toContain("04ACAC");
    expect(res.body).not.toContain("STAND-");
    expect(res.body).not.toContain("Stealth");
    expect(res.body).not.toContain("Untagged");
  });

  it("lists a scannable revealed company as locked before staff generate its tags (#935)", async () => {
    const tagged = await enterprise("Acme");
    const waiting = await enterprise("Waiting");
    const off = await enterprise("Off", "visible", false);
    const hiddenOne = await enterprise("Stealth", "hidden");
    await standTag(tagged, "04ACAC00000001");
    await standTag(off, "04ACAC00000009");
    expect(hiddenOne).toBeGreaterThan(0);
    const body = (await collection()).json();
    expect(body).toMatchObject({ total: 2, collected: 0 });
    expect(body.items.map((item: { name: string }) => item.name)).toEqual(["Acme", "Waiting"]);
    expect(body.items.every((item: { entry: unknown }) => item.entry === null)).toBe(true);
    expect(waiting).toBeGreaterThan(0);
  });

  it("orders the album by sponsor priority, then name, collected or not", async () => {
    const acme = await enterprise("Acme");
    const beta = await enterprise("Beta");
    const gold = await enterprise("Gold");
    const noTier = await enterprise("Aardvark");
    await pool.query(`UPDATE enterprises SET priority = 1 WHERE id = $1`, [gold]);
    await pool.query(`UPDATE enterprises SET priority = 2 WHERE id = ANY($1::int[])`, [
      [acme, beta],
    ]);
    await standTag(acme, "04ACAC00000001");
    await standTag(beta, "04ACAC00000002");
    await standTag(gold, "04ACAC00000003");
    await standTag(noTier, "04ACAC00000004");
    await scan("04ACAC00000002");

    const body = (await collection()).json();
    expect(body.items.map((item: { name: string }) => item.name)).toEqual([
      "Gold",
      "Acme",
      "Beta",
      "Aardvark",
    ]);
    expect(body.items[2].entry).not.toBeNull();
    expect(body.items[0].entry).toBeNull();
  });

  it("keeps a collected stand after its tags are removed, but not once it is hidden", async () => {
    const acme = await enterprise("Acme");
    const beta = await enterprise("Beta");
    await standTag(acme, "04ACAC00000001");
    await standTag(beta, "04ACAC00000002");
    await scan("04ACAC00000001");
    await scan("04ACAC00000002");
    await pool.query(`DELETE FROM sponsor_stand_tags`);
    expect((await collection()).json()).toMatchObject({ total: 2, collected: 2 });

    await pool.query(`UPDATE enterprises SET visibility = 'hidden' WHERE id = $1`, [beta]);
    const body = (await collection()).json();
    expect(body).toMatchObject({ total: 1, collected: 1 });
    expect(body.items[0].enterpriseId).toBe(acme);
  });

  it("leaves out stands that are not scannable unless the caller already collected them", async () => {
    const acme = await enterprise("Acme");
    const beta = await enterprise("Beta");
    await enterprise("Gamma", "visible", false).then((id) => standTag(id, "04ACAC00000003"));
    await standTag(acme, "04ACAC00000001");
    await standTag(beta, "04ACAC00000002");
    await scan("04ACAC00000001");
    expect((await collection()).json()).toMatchObject({ total: 2, collected: 1 });

    // Turning scanning off keeps the collected stand (in both counts) and
    // removes the uncollected one.
    await pool.query(`UPDATE enterprises SET stand_scannable = false WHERE id = ANY($1)`, [
      [acme, beta],
    ]);
    const body = (await collection()).json();
    expect(body).toMatchObject({ total: 1, collected: 1 });
    expect(body.items.map((item: { name: string }) => item.name)).toEqual(["Acme"]);
    expect(body.items[0].entry).not.toBeNull();

    // The collected entry stays visible in the owner's diary with its card.
    const diary = (await list()).json();
    expect(diary.items[0].sponsor).toMatchObject({ enterpriseId: acme, name: "Acme" });

    // Another attendee who never collected it sees nothing.
    const other = await createUserWithCapabilities([]);
    await admitParticipant(other);
    expect((await collection(other)).json()).toMatchObject({ total: 0, collected: 0 });
  });

  it("is private to the caller and requires event access", async () => {
    const acme = await enterprise("Acme");
    await standTag(acme, "04ACAC00000001");
    await scan("04ACAC00000001");
    const other = await createUserWithCapabilities([]);
    const theirs = (await collection(other)).json();
    expect(theirs).toMatchObject({ total: 1, collected: 0 });
    expect(theirs.items[0].entry).toBeNull();
    const outsider = await createUser();
    expect((await collection(outsider)).statusCode).toBe(403);
  });
});

describe("no save by id", () => {
  it("adds people only by scanning, never from a browsed id", async () => {
    const ana = await person("Ana");
    const res = await app.inject({
      method: "POST",
      url: "/api/me/diary/people",
      headers: { ...asUser(owner), "idempotency-key": `save-${++keySeq}` },
      payload: { userId: ana.id },
    });
    expect(res.statusCode).toBe(404);
    expect(await rowCount()).toBe(0);
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
    const other = await createUserWithCapabilities([]);
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
