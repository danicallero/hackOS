import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import {
  assignBadge,
  createBadgePass,
  createIntolerance,
  issueTicket,
  makeConfirmed,
  setIntolerances,
} from "./fixtures.js";

let app: App;
let staff: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  staff = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
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

describe("H22 accreditation lookup + check-in", () => {
  it("looks up a person card by ticket token (intolerances resolved, not accredited)", async () => {
    const uid = await createUser({ name: "Ada" });
    await makeConfirmed(uid);
    const intol = await createIntolerance(uid, { en: "Gluten", es: "Gluten", gl: "Gluten" });
    await setIntolerances(uid, [intol], "severe");
    const token = await issueTicket(uid);

    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/lookup",
      headers: asUser(staff),
      payload: { ticketToken: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Ada");
    expect(body.confirmed).toBe(true);
    expect(body.alreadyAccredited).toBe(false);
    expect(body.intolerances).toEqual([
      { id: intol, label: { en: "Gluten", es: "Gluten", gl: "Gluten" } },
    ]);
    expect(body.foodIntoleranceNotes).toBe("severe");
  });

  it("person card carries the identity fields staff verifies at the door", async () => {
    const uid = await createUser({ name: "Ada", email: "ada@test.local" });
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE users SET surname = 'Lovelace', dni = '12345678Z', shirt_size = 'M' WHERE id = $1`,
      [uid],
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/lookup-user",
      headers: asUser(staff),
      payload: { userId: uid },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.email).toBe("ada@test.local");
    expect(body.dni).toBe("12345678Z");
    expect(body.shirtSize).toBe("M");
  });

  it("unknown ticket returns 404 naming no personal data", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/lookup",
      headers: asUser(staff),
      payload: { ticketToken: "nope" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).not.toContain("@");
  });

  it("check-in assigns a badge and writes a check_in_log", async () => {
    const uid = await createUser({ name: "Grace" });
    const token = await issueTicket(uid);
    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers: asUser(staff),
      payload: { ticketToken: token, badgeId: "B-100", method: "qr" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().badgeId).toBe("B-100");

    const { pool } = await import("../../src/db/pool.js");
    const u = await pool.query(`SELECT badge_id FROM users WHERE id = $1`, [uid]);
    expect(u.rows[0].badge_id).toBe("B-100");
    const logs = await pool.query(`SELECT * FROM check_in_logs WHERE user_id = $1`, [uid]);
    expect(logs.rows).toHaveLength(1);
    expect(logs.rows[0].check_in_method).toBe("qr");
    expect(logs.rows[0].staff_id).toBe(staff);
    const audits = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'accreditation' AND entity_id = $1`,
      [String(uid)],
    );
    expect(audits.rows).toHaveLength(1);
  });

  it("idempotency-key replays check-in without a second badge assignment", async () => {
    const uid = await createUser();
    const token = await issueTicket(uid);
    const headers = { ...asUser(staff), "idempotency-key": "checkin-1" };
    const payload = { ticketToken: token, badgeId: "B-200" };

    const first = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers,
      payload,
    });
    const replay = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers,
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");

    const { pool } = await import("../../src/db/pool.js");
    const logs = await pool.query(`SELECT * FROM check_in_logs WHERE user_id = $1`, [uid]);
    expect(logs.rows).toHaveLength(1);
  });

  it("409 when the badge already belongs to someone else", async () => {
    const other = await createUser();
    await assignBadge(other, "B-DUP");
    const uid = await createUser();
    const token = await issueTicket(uid);

    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers: asUser(staff),
      payload: { ticketToken: token, badgeId: "B-DUP" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("409 with current badge info when the user is already accredited", async () => {
    const uid = await createUser();
    await assignBadge(uid, "B-OLD");
    const token = await issueTicket(uid);

    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers: asUser(staff),
      payload: { ticketToken: token, badgeId: "B-NEW" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.currentBadge).toBe("B-OLD");
  });

  it("two concurrent check-ins of the same badge for different users: one wins", async () => {
    const a = await createUser();
    const b = await createUser();
    const tA = await issueTicket(a);
    const tB = await issueTicket(b);

    const [ra, rb] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/accreditation/check-in",
        headers: asUser(staff),
        payload: { ticketToken: tA, badgeId: "B-RACE" },
      }),
      app.inject({
        method: "POST",
        url: "/api/accreditation/check-in",
        headers: asUser(staff),
        payload: { ticketToken: tB, badgeId: "B-RACE" },
      }),
    ]);
    const codes = [ra.statusCode, rb.statusCode].sort();
    expect(codes).toEqual([200, 409]);
  });
});

describe("H22/H23 unified person search", () => {
  const search = (q: string, as = staff, fields?: string[]) =>
    app.inject({
      method: "POST",
      url: "/api/logistics/people/search",
      headers: asUser(as),
      payload: fields ? { q, fields } : { q },
    });

  it("resolves an exact ticket token to exactly one person", async () => {
    const uid = await createUser({ name: "Ada" });
    await makeConfirmed(uid);
    const token = await issueTicket(uid);

    const res = await search(token);
    expect(res.statusCode).toBe(200);
    const { results } = res.json();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ userId: uid, matchedBy: "ticket", confirmed: true });
  });

  it("resolves a current badge id", async () => {
    const uid = await createUser();
    await assignBadge(uid, "B-500");

    const { results } = (await search("B-500")).json();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ userId: uid, matchedBy: "badge", badgeId: "B-500" });
  });

  it("finds the holder of a rotated-away badge", async () => {
    const uid = await createUser();
    await assignBadge(uid, "B-LOST");
    await app.inject({
      method: "POST",
      url: "/api/accreditation/rotate",
      headers: asUser(staff),
      payload: { userId: uid, newBadgeId: "B-NEW", reason: "lost" },
    });

    const { results } = (await search("B-LOST")).json();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      userId: uid,
      matchedBy: "badge_history",
      badgeId: "B-NEW",
    });
  });

  it("falls back to name/email substring search", async () => {
    const uid = await createUser({ name: "Margaret", email: "peggy@test.local" });
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE users SET surname = 'Hamilton' WHERE id = $1`, [uid]);

    for (const q of ["hamil", "peggy@", "margaret ham"]) {
      const { results } = (await search(q)).json();
      expect(results.map((r: { userId: number }) => r.userId)).toContain(uid);
      expect(results[0].matchedBy).toBe("profile");
    }
  });

  it("returns only the default fields unless asked for more", async () => {
    const uid = await createUser({ name: "Dorothy", email: "dot@test.local" });
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE users SET dni = '99999999R', shirt_size = 'L' WHERE id = $1`, [uid]);

    const byDefault = (await search("dot@test.local")).json().results[0];
    expect(byDefault).toMatchObject({ userId: uid, email: "dot@test.local", badgeId: null });
    expect(byDefault.dni).toBeUndefined();
    expect(byDefault.shirtSize).toBeUndefined();

    const picked = (await search("dot@test.local", staff, ["dni", "shirtSize"])).json().results[0];
    expect(picked).toMatchObject({ userId: uid, dni: "99999999R", shirtSize: "L" });
    expect(picked.email).toBeUndefined();
    expect(picked.confirmed).toBeUndefined();
  });

  it("rejects fields outside the whitelist", async () => {
    const res = await search("whatever", staff, ["badge_id_history"]);
    expect(res.statusCode).toBe(400);
  });

  it("any logistics capability grants access, none denies it", async () => {
    const door = await createUserWithCapabilities([CAPABILITIES.PRESENCE_SCAN]);
    expect((await search("anything", door)).statusCode).toBe(200);

    const outsider = await createUser();
    expect((await search("anything", outsider)).statusCode).toBe(403);
  });
});

describe("H23 badge rotation", () => {
  it("rotates the badge, revokes the old one, and voids badge wallet passes", async () => {
    const uid = await createUser();
    await assignBadge(uid, "OLD-1");
    const passId = await createBadgePass(uid);

    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/rotate",
      headers: asUser(staff),
      payload: { userId: uid, newBadgeId: "NEW-1", reason: "lost badge" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().oldBadge).toBe("OLD-1");
    expect(res.json().voidedPasses).toBe(1);

    const { pool } = await import("../../src/db/pool.js");
    const u = await pool.query(`SELECT badge_id, badge_id_history FROM users WHERE id = $1`, [uid]);
    expect(u.rows[0].badge_id).toBe("NEW-1");
    expect(u.rows[0].badge_id_history).toContain("OLD-1");
    const pass = await pool.query(`SELECT status FROM wallet_passes WHERE id = $1`, [passId]);
    expect(pass.rows[0].status).toBe("voided");
    const audits = await pool.query(
      `SELECT before, after FROM audit_log WHERE entity_type = 'badge' AND entity_id = $1`,
      [String(uid)],
    );
    expect(audits.rows[0].before).toEqual({ badge_id: "OLD-1" });
    expect(audits.rows[0].after).toEqual({ badge_id: "NEW-1" });
  });

  it("a scan of the rotated-away badge is rejected as revoked (via presence)", async () => {
    const uid = await createUser();
    await assignBadge(uid, "OLD-2");
    await app.inject({
      method: "POST",
      url: "/api/accreditation/rotate",
      headers: asUser(staff),
      payload: { currentBadgeId: "OLD-2", newBadgeId: "NEW-2", reason: "lost" },
    });

    const presenceStaff = await createUserWithCapabilities([CAPABILITIES.PRESENCE_SCAN]);
    const res = await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(presenceStaff),
      payload: { badgeId: "OLD-2", kind: "in" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("badge_revoked");
  });

  it("409 when the new badge is already assigned", async () => {
    const holder = await createUser();
    await assignBadge(holder, "TAKEN");
    const uid = await createUser();
    await assignBadge(uid, "OLD-3");

    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/rotate",
      headers: asUser(staff),
      payload: { userId: uid, newBadgeId: "TAKEN", reason: "lost" },
    });
    expect(res.statusCode).toBe(409);
  });
});
