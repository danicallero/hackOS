import "./env.js";
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
import { issueTicket } from "../logistics/fixtures.js";

/** #935: staff link NFC tags and printable QR tokens to a sponsor's stand. */

let app: App;
let admin: number;
let enterpriseId: number;
let keySeq = 0;

beforeAll(async () => {
  app = await buildTestApp();
});
beforeEach(async () => {
  await truncateAll();
  admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
  const { rows } = await pool.query(`INSERT INTO enterprises (name) VALUES ('Acme') RETURNING id`);
  enterpriseId = rows[0].id;
});
afterAll(async () => {
  await app.close();
});

function addTag(payload: Record<string, unknown>, as = admin, id = enterpriseId) {
  return app.inject({
    method: "POST",
    url: `/api/enterprises/${id}/stand-tags`,
    headers: { ...asUser(as), "idempotency-key": `tag-${++keySeq}` },
    payload,
  });
}

describe("stand tags", () => {
  it("links an NFC UID in the badge encoding and generates QR tokens", async () => {
    const nfc = await addTag({ kind: "nfc", uid: "04:a1:b2:c3:d4:e5:f6" });
    expect(nfc.statusCode).toBe(201);
    expect(nfc.json()).toMatchObject({ kind: "nfc", code: "04A1B2C3D4E5F6" });

    const qr = await addTag({ kind: "qr" });
    expect(qr.statusCode).toBe(201);
    expect(qr.json().code).toMatch(/^STAND-[0-9A-Z]{16}$/);

    const listed = await app.inject({
      method: "GET",
      url: `/api/enterprises/${enterpriseId}/stand-tags`,
      headers: asUser(admin),
    });
    expect(listed.json().tags.map((t: { kind: string }) => t.kind)).toEqual(["nfc", "qr"]);

    const audits = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'enterprise' AND entity_id = $1`,
      [String(enterpriseId)],
    );
    expect(audits.rows.map((r) => r.action)).toEqual(["stand_tag.added", "stand_tag.added"]);
  });

  it("rejects malformed UIDs and codes already used by a stand, badge or ticket", async () => {
    expect((await addTag({ kind: "nfc", uid: "04A1" })).statusCode).toBe(400);
    expect((await addTag({ kind: "qr", uid: "04A1B2C3D4E5F6" })).statusCode).toBe(400);
    expect((await addTag({ kind: "nfc", uid: "04A1B2C3D4E5F6" })).statusCode).toBe(201);
    expect((await addTag({ kind: "nfc", uid: "04A1B2C3D4E5F6" })).statusCode).toBe(409);

    const person = await createUser();
    await pool.query(
      `UPDATE users SET badge_id = '04000000000001', badge_id_history = ARRAY['04000000000002'] WHERE id = $1`,
      [person],
    );
    expect((await addTag({ kind: "nfc", uid: "04000000000001" })).statusCode).toBe(409);
    expect((await addTag({ kind: "nfc", uid: "04000000000002" })).statusCode).toBe(409);
  });

  it("removes a tag and is restricted to sponsors:manage", async () => {
    const tag = (await addTag({ kind: "nfc", uid: "04A1B2C3D4E5F6" })).json();
    const outsider = await createUser();
    expect((await addTag({ kind: "qr" }, outsider)).statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/enterprises/${enterpriseId}/stand-tags`,
          headers: asUser(outsider),
        })
      ).statusCode,
    ).toBe(403);
    expect((await addTag({ kind: "qr" }, admin, 999_999)).statusCode).toBe(404);

    const del = (id: number) =>
      app.inject({
        method: "DELETE",
        url: `/api/enterprises/${enterpriseId}/stand-tags/${id}`,
        headers: { ...asUser(admin), "idempotency-key": `del-${++keySeq}` },
      });
    expect((await del(tag.id)).statusCode).toBe(204);
    expect((await del(tag.id)).statusCode).toBe(404);
  });

  it("refuses a stand tag as someone's badge at accreditation", async () => {
    await addTag({ kind: "nfc", uid: "04A1B2C3D4E5F6" });
    const staff = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
    const uid = await createUser({ name: "Grace" });
    const token = await issueTicket(uid);
    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers: asUser(staff),
      payload: { ticketToken: token, badgeId: "04A1B2C3D4E5F6", method: "nfc" },
    });
    expect(res.statusCode).toBe(409);
    const { rows } = await pool.query(`SELECT badge_id FROM users WHERE id = $1`, [uid]);
    expect(rows[0].badge_id).toBeNull();
  });
});
