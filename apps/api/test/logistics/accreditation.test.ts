import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  seedAttendeeRoles,
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

  it("classifies an unassigned person and issues their ticket before accreditation", async () => {
    await seedAttendeeRoles();
    const uid = await createUser({ name: "Manual mentor" });
    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in-user",
      headers: { ...asUser(staff), "idempotency-key": "manual-mentor-checkin" },
      payload: { userId: uid, badgeId: "B-MENTOR", attendeeRole: "mentor" },
    });
    expect(res.statusCode).toBe(200);
    const { pool } = await import("../../src/db/pool.js");
    expect(
      (
        await pool.query(
          `SELECT r.badge_category FROM user_roles ur
             JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = $1 AND r.badge_category = 'mentor'`,
          [uid],
        )
      ).rows[0]?.badge_category,
    ).toBe("mentor");
    expect(
      (await pool.query(`SELECT token FROM tickets WHERE user_id = $1`, [uid])).rows,
    ).toHaveLength(1);
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

  it("409 when the scanned badgeId is actually someone's ticket token", async () => {
    const victim = await createUser();
    const ticketAsBadge = await issueTicket(victim);
    const uid = await createUser();
    const token = await issueTicket(uid);

    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers: asUser(staff),
      payload: { ticketToken: token, badgeId: ticketAsBadge },
    });
    expect(res.statusCode).toBe(409);

    const { pool } = await import("../../src/db/pool.js");
    const u = await pool.query(`SELECT badge_id FROM users WHERE id = $1`, [uid]);
    expect(u.rows[0].badge_id).toBeNull();
  });

  it("403 when the ticket's owner no longer has event access (revoked spot, stale QR)", async () => {
    // The tickets row is permanent (plan/07 invariant 10) — a captured QR
    // never itself expires. Once event access is gone, check-in must refuse
    // it even though the token still resolves (H43).
    const uid = await createUser();
    const token = await issueTicket(uid);
    const { pool } = await import("../../src/db/pool.js");
    // issueTicket (fixtures.ts) now grants the seeded Participant role
    // (H8 full-replacement) rather than writing manual_attendee_roles — undo
    // that grant to simulate the same "no more event access" state.
    await pool.query(
      `DELETE FROM user_roles ur USING roles r
        WHERE ur.role_id = r.id AND ur.user_id = $1 AND r.badge_category = 'participant'`,
      [uid],
    );

    const lookup = await app.inject({
      method: "POST",
      url: "/api/accreditation/lookup",
      headers: asUser(staff),
      payload: { ticketToken: token },
    });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().hasEventAccess).toBe(false);

    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers: asUser(staff),
      payload: { ticketToken: token, badgeId: "B-STALE" },
    });
    expect(res.statusCode).toBe(403);
    expect(
      (await pool.query(`SELECT badge_id FROM users WHERE id = $1`, [uid])).rows[0].badge_id,
    ).toBeNull();
  });

  it("rejects a revoked ticket even if its token is later assigned to another user (H54)", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const formerOwner = await createUser();
    const staleToken = await issueTicket(formerOwner, "ticket-retired");
    await assignBadge(formerOwner, "BADGE-TICKET-RETIRED");
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id) VALUES ($1, 'BADGE-TICKET-RETIRED')`,
      [formerOwner],
    );
    const admin = await createUserWithCapabilities(["*"]);
    const removed = await app.inject({
      method: "POST",
      url: `/api/users/${formerOwner}/anonymize`,
      headers: asUser(admin),
    });
    expect(removed.statusCode).toBe(200);

    const replacement = await createUser();
    await issueTicket(replacement, staleToken);
    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers: asUser(staff),
      payload: { ticketToken: staleToken, badgeId: "BADGE-NEW-OWNER", method: "qr" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("ticket_revoked");
    expect(
      (await pool.query(`SELECT badge_id FROM users WHERE id = $1`, [replacement])).rows[0]
        .badge_id,
    ).toBeNull();
    const retired = await pool.query<{ credential_digest: string }>(
      `SELECT credential_digest FROM scanner_revoked_tickets`,
    );
    expect(retired.rows).toHaveLength(1);
    const retiredRow = retired.rows[0];
    if (!retiredRow) throw new Error("Expected one retired ticket digest");
    expect(retiredRow.credential_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(retiredRow.credential_digest).not.toContain(staleToken);
  });

  it("rejects a retired ticket token when it is presented as a new badge", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const formerOwner = await createUser();
    const staleToken = await issueTicket(formerOwner, "ticket-retired-badge");
    await assignBadge(formerOwner, "BADGE-FORMER-TICKET");
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id) VALUES ($1, 'BADGE-FORMER-TICKET')`,
      [formerOwner],
    );
    const admin = await createUserWithCapabilities(["*"]);
    const removed = await app.inject({
      method: "POST",
      url: `/api/users/${formerOwner}/anonymize`,
      headers: asUser(admin),
    });
    expect(removed.statusCode).toBe(200);

    const replacement = await createUser();
    await issueTicket(replacement, "ticket-replacement");
    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in-user",
      headers: asUser(staff),
      payload: { userId: replacement, badgeId: staleToken, method: "manual" },
    });

    expect(res.statusCode).toBe(409);
    expect(
      (await pool.query(`SELECT badge_id FROM users WHERE id = $1`, [replacement])).rows[0]
        .badge_id,
    ).toBeNull();
  });

  it("check-in succeeds for a capability holder with no confirmed application at all (H43)", async () => {
    const admin = await createUserWithCapabilities([CAPABILITIES.APPLICATIONS_DECIDE]);
    const token = await (async () => {
      const { pool } = await import("../../src/db/pool.js");
      const t = `tkt-${crypto.randomUUID()}`;
      await pool.query(`INSERT INTO tickets (user_id, token) VALUES ($1, $2)`, [admin, t]);
      return t;
    })();

    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/check-in",
      headers: asUser(staff),
      payload: { ticketToken: token, badgeId: "B-ADMIN" },
    });
    expect(res.statusCode).toBe(200);
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

  it("falls back to name/surname/email substring search, in any casing or order", async () => {
    const uid = await createUser({ name: "Margaret", email: "peggy@test.local" });
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE users SET surname = 'Hamilton' WHERE id = $1`, [uid]);

    for (const q of [
      "hamil", // surname fragment
      "MARGARET", // name, uppercased
      "peggy@", // email fragment
      "PEGGY@TEST.LOCAL", // full email, uppercased
      "margaret ham", // name + surname
      "Hamilton Margaret", // surname + name
    ]) {
      const { results } = (await search(q)).json();
      expect(
        results.map((r: { userId: number }) => r.userId),
        q,
      ).toContain(uid);
      expect(results[0].matchedBy).toBe("profile");
    }
  });

  it("finds accented names from unaccented queries, keeping the stored accents", async () => {
    const uid = await createUser({ name: "Ana", email: "ana@test.local" });
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE users SET surname = 'Pérez Muñoz' WHERE id = $1`, [uid]);

    for (const q of ["perez", "PEREZ MUNOZ", "ana pérez", "ana per", "munoz"]) {
      const { results } = (await search(q)).json();
      expect(
        results.map((r: { userId: number }) => r.userId),
        q,
      ).toContain(uid);
    }

    const { rows } = await pool.query(`SELECT surname FROM users WHERE id = $1`, [uid]);
    expect(rows[0].surname).toBe("Pérez Muñoz");
  });

  it("exact identifiers (ticket, badge, old badge) match case-insensitively", async () => {
    const uid = await createUser();
    await issueTicket(uid, "TkT-CaSe-1");
    expect((await search("tkt-case-1")).json().results[0]).toMatchObject({
      userId: uid,
      matchedBy: "ticket",
    });

    await assignBadge(uid, "B-CaSe-9");
    expect((await search("b-case-9")).json().results[0]).toMatchObject({
      userId: uid,
      matchedBy: "badge",
    });

    await app.inject({
      method: "POST",
      url: "/api/accreditation/rotate",
      headers: asUser(staff),
      payload: { userId: uid, newBadgeId: "B-CASE-10", reason: "lost" },
    });
    expect((await search("B-CASE-9")).json().results[0]).toMatchObject({
      userId: uid,
      matchedBy: "badge_history",
    });
  });

  it("a badge id matches its CURRENT holder even if it lingers in someone's history", async () => {
    // Manufacture the ambiguous case directly: B-SHARED sits in alice's
    // history but is bob's current badge — the current holder must win.
    const alice = await createUser({ name: "Alice" });
    const bob = await createUser({ name: "Bob" });
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE users SET badge_id_history = '{B-SHARED}' WHERE id = $1`, [alice]);
    await assignBadge(bob, "B-SHARED");

    const { results } = (await search("b-shared")).json();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ userId: bob, matchedBy: "badge" });
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
    const u = await pool.query(
      `SELECT badge_id, badge_id_history, badge_assigned_at FROM users WHERE id = $1`,
      [uid],
    );
    expect(u.rows[0].badge_id).toBe("NEW-1");
    expect(u.rows[0].badge_id_history).toContain("OLD-1");
    expect(u.rows[0].badge_assigned_at).toBeInstanceOf(Date);
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

  it("409 when the new badge is actually someone's ticket token", async () => {
    const victim = await createUser();
    const ticketAsBadge = await issueTicket(victim);
    const uid = await createUser();
    await assignBadge(uid, "OLD-9");

    const res = await app.inject({
      method: "POST",
      url: "/api/accreditation/rotate",
      headers: asUser(staff),
      payload: { userId: uid, newBadgeId: ticketAsBadge, reason: "lost" },
    });
    expect(res.statusCode).toBe(409);

    const { pool } = await import("../../src/db/pool.js");
    const u = await pool.query(`SELECT badge_id FROM users WHERE id = $1`, [uid]);
    expect(u.rows[0].badge_id).toBe("OLD-9");
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
