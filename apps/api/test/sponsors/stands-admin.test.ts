import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import yauzl from "yauzl";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

/**
 * #935: staff decide which enterprises have a scannable stand, generate QR
 * codes for all of them and export the codes for printing.
 */

let app: App;
let admin: number;
let keySeq = 0;

beforeAll(async () => {
  app = await buildTestApp();
});
beforeEach(async () => {
  await truncateAll();
  admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
});
afterAll(async () => {
  await app.close();
});

async function enterprise(name: string, scannable = false): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO enterprises (name, stand_scannable) VALUES ($1, $2) RETURNING id`,
    [name, scannable],
  );
  return rows[0].id as number;
}

async function tag(enterpriseId: number, code: string, kind: "nfc" | "qr" = "nfc") {
  const { rows } = await pool.query(
    `INSERT INTO sponsor_stand_tags (enterprise_id, kind, code) VALUES ($1, $2, $3) RETURNING id`,
    [enterpriseId, kind, code],
  );
  return rows[0].id as number;
}

async function rep(enterpriseId: number): Promise<number> {
  const user = await createUser();
  await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
    enterpriseId,
    user,
  ]);
  return user;
}

function setScannable(id: number, scannable: boolean, as = admin, key = `sc-${++keySeq}`) {
  return app.inject({
    method: "PUT",
    url: `/api/enterprises/${id}/stand-scannable`,
    headers: { ...asUser(as), "idempotency-key": key },
    payload: { scannable },
  });
}

function generate(as = admin, key = `gen-${++keySeq}`) {
  return app.inject({
    method: "POST",
    url: "/api/enterprises/stands/qr",
    headers: { ...asUser(as), "idempotency-key": key },
  });
}

function get(url: string, as = admin) {
  return app.inject({ method: "GET", url, headers: asUser(as) });
}

async function audits(action: string) {
  const { rows } = await pool.query(
    `SELECT actor_id, entity_type, entity_id, before, after FROM audit_log WHERE action = $1 ORDER BY id`,
    [action],
  );
  return rows;
}

function readZip(buf: Buffer): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const entries: Record<string, string> = {};
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      zip.readEntry();
      zip.on("entry", (entry) => {
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return reject(streamErr);
          const chunks: Buffer[] = [];
          stream.on("data", (c) => chunks.push(c));
          stream.on("end", () => {
            entries[entry.fileName] = Buffer.concat(chunks).toString("utf8");
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => resolve(entries));
      zip.on("error", reject);
    });
  });
}

describe("the scannable flag", () => {
  it("is off for new enterprises", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/enterprises",
      headers: { ...asUser(admin), "idempotency-key": `new-${++keySeq}` },
      payload: { name: "Fresh" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().stand_scannable).toBe(false);
  });

  it("is toggled by staff, audited once per change", async () => {
    const acme = await enterprise("Acme");
    const on = await setScannable(acme, true);
    expect(on.statusCode).toBe(200);
    expect(on.json()).toEqual({ enterpriseId: acme, scannable: true, changed: true });
    const again = await setScannable(acme, true);
    expect(again.json()).toMatchObject({ scannable: true, changed: false });
    expect((await setScannable(acme, false)).json()).toMatchObject({ changed: true });

    expect(await audits("stand.scannable_changed")).toEqual([
      {
        actor_id: admin,
        entity_type: "enterprise",
        entity_id: String(acme),
        before: { scannable: false },
        after: { scannable: true },
      },
      {
        actor_id: admin,
        entity_type: "enterprise",
        entity_id: String(acme),
        before: { scannable: true },
        after: { scannable: false },
      },
    ]);
    expect((await setScannable(999_999, true)).statusCode).toBe(404);
  });

  it("cannot be changed by a sponsor rep, who still manages and sees their tags", async () => {
    const acme = await enterprise("Acme");
    const representative = await rep(acme);
    const refused = await setScannable(acme, true, representative);
    expect(refused.statusCode).toBe(403);
    // Nor through the profile patch.
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/enterprises/${acme}`,
      headers: { ...asUser(representative), "idempotency-key": `p-${++keySeq}` },
      payload: { standScannable: true },
    });
    expect(patched.statusCode).toBe(400);
    const { rows } = await pool.query(`SELECT stand_scannable FROM enterprises WHERE id = $1`, [
      acme,
    ]);
    expect(rows[0].stand_scannable).toBe(false);

    const added = await app.inject({
      method: "POST",
      url: `/api/enterprises/${acme}/stand-tags`,
      headers: { ...asUser(representative), "idempotency-key": `t-${++keySeq}` },
      payload: { kind: "qr" },
    });
    expect(added.statusCode).toBe(201);
    const listed = await get(`/api/enterprises/${acme}/stand-tags`, representative);
    expect(listed.json().tags).toHaveLength(1);
    const own = await get(`/api/enterprises/${acme}`, representative);
    expect(own.json().stand_scannable).toBe(false);
  });
});

describe("the stands list", () => {
  it("summarises every enterprise without exposing codes, for staff only", async () => {
    const acme = await enterprise("Acme", true);
    const beta = await enterprise("Beta");
    await tag(acme, "04ACAC00000001");
    await tag(acme, "STAND-AAAAAAAAAAAAAAAA", "qr");
    const newest = await tag(acme, "STAND-BBBBBBBBBBBBBBBB", "qr");

    const res = await get("/api/enterprises/stands");
    expect(res.statusCode).toBe(200);
    expect(res.json().stands).toEqual([
      expect.objectContaining({
        enterpriseId: acme,
        name: "Acme",
        visibility: "hidden",
        scannable: true,
        nfcCount: 1,
        qrCount: 2,
        latestQrTagId: newest,
      }),
      expect.objectContaining({
        enterpriseId: beta,
        scannable: false,
        nfcCount: 0,
        qrCount: 0,
        latestQrTagId: null,
      }),
    ]);
    expect(res.body).not.toContain("STAND-");
    expect(res.body).not.toContain("04ACAC");

    const representative = await rep(acme);
    expect((await get("/api/enterprises/stands", representative)).statusCode).toBe(403);
  });
});

describe("bulk QR generation", () => {
  it("adds one QR to each scannable stand without one, audited, and nothing on a rerun", async () => {
    const acme = await enterprise("Acme", true);
    const beta = await enterprise("Beta", true);
    const hasQr = await enterprise("Gamma", true);
    const off = await enterprise("Delta");
    await tag(acme, "04ACAC00000001");
    await tag(hasQr, "STAND-CCCCCCCCCCCCCCCC", "qr");

    const res = await generate();
    expect(res.statusCode).toBe(200);
    const created = res.json().created as {
      enterpriseId: number;
      name: string;
      tag: { code: string };
    }[];
    expect(created.map((item) => item.enterpriseId).sort()).toEqual([acme, beta].sort());
    for (const item of created) expect(item.tag.code).toMatch(/^STAND-[0-9A-Z]{16}$/);

    const { rows } = await pool.query(
      `SELECT enterprise_id, count(*)::int AS n FROM sponsor_stand_tags WHERE kind = 'qr' GROUP BY 1`,
    );
    expect(Object.fromEntries(rows.map((row) => [row.enterprise_id, row.n]))).toEqual({
      [acme]: 1,
      [beta]: 1,
      [hasQr]: 1,
    });
    expect(rows.some((row) => row.enterprise_id === off)).toBe(false);

    const bulkAudits = (await audits("stand_tag.added")).filter((row) => row.after.bulk);
    expect(bulkAudits.map((row) => Number(row.entity_id)).sort()).toEqual([acme, beta].sort());

    expect((await generate()).json().created).toEqual([]);
  });

  it("replays a retried request and converges concurrent runs on one QR per stand", async () => {
    const ids = await Promise.all(["A", "B", "C"].map((name) => enterprise(name, true)));
    const first = await generate(admin, "gen-replay");
    const replay = await generate(admin, "gen-replay");
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());

    await pool.query(`DELETE FROM sponsor_stand_tags`);
    const runs = await Promise.all([generate(), generate(), generate()]);
    expect(runs.map((run) => run.statusCode)).toEqual([200, 200, 200]);
    expect(runs.flatMap((run) => run.json().created)).toHaveLength(ids.length);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM sponsor_stand_tags WHERE kind = 'qr'`,
    );
    expect(rows[0].n).toBe(ids.length);
  });

  it("is refused to sponsor reps", async () => {
    const acme = await enterprise("Acme", true);
    expect((await generate(await rep(acme))).statusCode).toBe(403);
  });
});

describe("code exports", () => {
  it("exports the codes of scannable stands as CSV, audited", async () => {
    const acme = await enterprise("Acme, Inc.", true);
    const off = await enterprise("Hidden Stand");
    await tag(acme, "04ACAC00000001");
    await tag(acme, "STAND-AAAAAAAAAAAAAAAA", "qr");
    await tag(off, "STAND-ZZZZZZZZZZZZZZZZ", "qr");

    const res = await get("/api/enterprises/stands/codes.csv");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.body).toBe(
      `enterprise_id,name,kind,code\r\n${acme},"Acme, Inc.",nfc,04ACAC00000001\r\n${acme},"Acme, Inc.",qr,STAND-AAAAAAAAAAAAAAAA\r\n`,
    );
    expect(await audits("stand_codes.exported")).toEqual([
      expect.objectContaining({
        actor_id: admin,
        entity_type: "stand_codes",
        after: { format: "csv", codeCount: 2, enterpriseCount: 1 },
      }),
    ]);
  });

  it("zips one labelled SVG per QR of the scannable stands, audited", async () => {
    const acme = await enterprise("Ácme & Co", true);
    const beta = await enterprise("Beta", true);
    await tag(acme, "04ACAC00000001");
    await tag(acme, "STAND-AAAAAAAAAAAAAAAA", "qr");
    await tag(beta, "STAND-BBBBBBBBBBBBBBBB", "qr");

    const res = await app.inject({
      method: "GET",
      url: "/api/enterprises/stands/qr.zip",
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    const entries = await readZip(res.rawPayload);
    expect(Object.keys(entries).sort()).toEqual([
      "acme-co-STAND-AAAAAAAAAAAAAAAA.svg",
      "beta-STAND-BBBBBBBBBBBBBBBB.svg",
    ]);
    const svg = entries["acme-co-STAND-AAAAAAAAAAAAAAAA.svg"] as string;
    expect(svg).toContain("<svg");
    expect(svg).toContain('width="80mm"');
    expect(svg).toContain("Ácme &amp; Co");
    expect(svg).toContain("STAND-AAAAAAAAAAAAAAAA");
    expect(await audits("stand_codes.exported")).toEqual([
      expect.objectContaining({ after: { format: "svg", codeCount: 2, enterpriseCount: 2 } }),
    ]);
  });

  it("answers an explicit 409 when there is nothing to export, and 403 to reps", async () => {
    const acme = await enterprise("Acme", true);
    await tag(acme, "04ACAC00000001");
    const zip = await get("/api/enterprises/stands/qr.zip");
    expect(zip.statusCode).toBe(409);
    expect(zip.json().error.code).toBe("stand_codes_empty");
    expect(await audits("stand_codes.exported")).toEqual([]);

    const representative = await rep(acme);
    expect((await get("/api/enterprises/stands/codes.csv", representative)).statusCode).toBe(403);
    expect((await get("/api/enterprises/stands/qr.zip", representative)).statusCode).toBe(403);
  });
});

describe("one stand QR as SVG", () => {
  it("is downloadable by the enterprise's reps and staff; NFC and foreign tags are 404", async () => {
    const acme = await enterprise("Acme");
    const other = await enterprise("Other");
    const qr = await tag(acme, "STAND-AAAAAAAAAAAAAAAA", "qr");
    const nfc = await tag(acme, "04ACAC00000001");
    const foreign = await tag(other, "STAND-BBBBBBBBBBBBBBBB", "qr");
    const representative = await rep(acme);

    const res = await get(`/api/enterprises/${acme}/stand-tags/${qr}/qr.svg`, representative);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    expect(res.headers["content-disposition"]).toContain("acme-STAND-AAAAAAAAAAAAAAAA.svg");
    expect(res.body).toContain(">Acme</tspan>");
    expect((await get(`/api/enterprises/${acme}/stand-tags/${qr}/qr.svg`)).statusCode).toBe(200);
    expect((await get(`/api/enterprises/${acme}/stand-tags/${nfc}/qr.svg`)).statusCode).toBe(404);
    expect((await get(`/api/enterprises/${acme}/stand-tags/${foreign}/qr.svg`)).statusCode).toBe(
      404,
    );
    expect(
      (await get(`/api/enterprises/${other}/stand-tags/${foreign}/qr.svg`, representative))
        .statusCode,
    ).toBe(403);
  });
});

describe("linking a tag already in use", () => {
  it("says whether the tag is a badge or already a stand", async () => {
    const acme = await enterprise("Acme");
    await tag(acme, "04ACAC00000001");
    const person = await createUser();
    await pool.query(`UPDATE users SET badge_id = '04000000000001' WHERE id = $1`, [person]);
    const link = (uid: string) =>
      app.inject({
        method: "POST",
        url: `/api/enterprises/${acme}/stand-tags`,
        headers: { ...asUser(admin), "idempotency-key": `l-${++keySeq}` },
        payload: { kind: "nfc", uid },
      });
    const stand = await link("04ACAC00000001");
    expect(stand.statusCode).toBe(409);
    expect(stand.json().error.details).toEqual({ code: "stand_tag_in_use", usedBy: "stand" });
    const badge = await link("04000000000001");
    expect(badge.json().error.details).toEqual({ code: "stand_tag_in_use", usedBy: "badge" });
  });
});
