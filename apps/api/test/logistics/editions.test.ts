import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import { scannerCredentialDigest } from "../../src/modules/logistics/credential-tombstones.js";
import { asUser, createRole, createUser, grantAttendeeRole, useTestApp } from "../helpers.js";
import { assignBadge, issueTicket } from "./fixtures.js";

/**
 * Multi-edition logistics (H22, H23, H24, H48): tickets are per edition,
 * logs and schedule lists follow the viewed edition, a badge code has one
 * holder at a time and may be reassigned once its holder's edition is over,
 * and scanners of a closed edition answer edition_closed.
 */

const getApp = useTestApp();

async function db() {
  return (await import("../../src/db/pool.js")).pool;
}

const ed = (key?: string): Record<string, string> => (key ? { "x-edition": key } : {});

async function createEdition(key: string, status: "active" | "closed" = "active") {
  await (await db()).query(
    `INSERT INTO editions (event_key, name, status, closed_at)
     VALUES ($1, $2, $3, CASE WHEN $3 = 'closed' THEN now() END)`,
    [key, key.toUpperCase(), status],
  );
}

/** A user holding `capabilities` in the current edition and in each of `editions`. */
async function staffIn(capabilities: string[], editions: string[] = []): Promise<number> {
  const userId = await createUser();
  const roleId = await createRole(capabilities);
  const pool = await db();
  await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [userId, roleId]);
  for (const key of editions) {
    await pool.query(`INSERT INTO user_roles (user_id, role_id, event_key) VALUES ($1, $2, $3)`, [
      userId,
      roleId,
      key,
    ]);
  }
  return userId;
}

/** An attendee with the Participant role and a ticket in `eventKey`. */
async function attendeeIn(eventKey: string, token: string): Promise<number> {
  const pool = await db();
  const userId = await createUser();
  await grantAttendeeRole(userId, "participant");
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id, event_key)
     SELECT user_id, role_id, $2 FROM user_roles WHERE user_id = $1 AND event_key <> $2`,
    [userId, eventKey],
  );
  await pool.query(`INSERT INTO tickets (user_id, token, event_key) VALUES ($1, $2, $3)`, [
    userId,
    token,
    eventKey,
  ]);
  return userId;
}

async function checkInUser(
  staff: number,
  userId: number,
  badgeId: string,
  edition?: string,
): Promise<{ statusCode: number; json: () => { error: { message: string } } }> {
  const app = await getApp();
  return app.inject({
    method: "POST",
    url: "/api/accreditation/check-in-user",
    headers: { ...asUser(staff), ...ed(edition), "idempotency-key": crypto.randomUUID() },
    payload: { userId, badgeId, method: "manual" },
  });
}

describe("tickets per edition (H22)", () => {
  it("gives the same user one ticket per edition and rejects another edition's token at the scanner", async () => {
    await createEdition("e2");
    const pool = await db();
    const staff = await staffIn([CAPABILITIES.ACCREDIT_SCAN], ["e2"]);
    const user = await createUser({ name: "Ada" });
    const oldToken = await issueTicket(user, "tok-default");
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id, event_key)
       SELECT user_id, role_id, 'e2' FROM user_roles WHERE user_id = $1`,
      [user],
    );
    await pool.query(
      `INSERT INTO tickets (user_id, token, event_key) VALUES ($1, 'tok-e2', 'e2')`,
      [user],
    );
    expect(
      (await pool.query(`SELECT event_key FROM tickets WHERE user_id = $1 ORDER BY 1`, [user]))
        .rows,
    ).toHaveLength(2);

    const app = await getApp();
    const lookup = (token: string, edition?: string) =>
      app.inject({
        method: "POST",
        url: "/api/accreditation/lookup",
        headers: { ...asUser(staff), ...ed(edition) },
        payload: { ticketToken: token },
      });

    expect((await lookup(oldToken)).statusCode).toBe(200);
    const other = await lookup("tok-e2");
    expect(other.statusCode).toBe(409);
    expect(other.json().error.message).toBe("This ticket belongs to another edition");
    expect((await lookup("tok-e2", "e2")).statusCode).toBe(200);
    expect((await lookup(oldToken, "e2")).statusCode).toBe(409);
  });

  it("serves my ticket of the viewed edition only", async () => {
    await createEdition("e2");
    const user = await attendeeIn("e2", "tok-e2-only");
    const app = await getApp();
    const current = await app.inject({
      method: "GET",
      url: "/api/me/ticket",
      headers: asUser(user),
    });
    expect(current.json().ticketToken).toBeNull();
    const viewed = await app.inject({
      method: "GET",
      url: "/api/me/ticket",
      headers: { ...asUser(user), ...ed("e2") },
    });
    expect(viewed.json().ticketToken).toBe("tok-e2-only");
  });
});

describe("logs per edition (H24)", () => {
  it("lists a person's door logs of the viewed edition only", async () => {
    await createEdition("e2");
    const pool = await db();
    const staff = await staffIn([CAPABILITIES.PRESENCE_SCAN], ["e2"]);
    const user = await createUser();
    await pool.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at, event_key) VALUES
         ($1, 'in', now() - interval '3 hours', 'default'),
         ($1, 'in', now() - interval '2 hours', 'e2'),
         ($1, 'out', now() - interval '1 hour', 'e2')`,
      [user],
    );
    const app = await getApp();
    const list = async (edition?: string) =>
      (
        await app.inject({
          method: "GET",
          url: `/api/presence/logs/${user}`,
          headers: { ...asUser(staff), ...ed(edition) },
        })
      ).json().items;
    expect(await list()).toHaveLength(1);
    expect(await list("e2")).toHaveLength(2);
  });

  it("records a door scan in the viewed edition", async () => {
    await createEdition("e2");
    const pool = await db();
    const staff = await staffIn([CAPABILITIES.PRESENCE_SCAN], ["e2"]);
    const user = await createUser();
    await assignBadge(user, "P-ED"); // current edition
    const app = await getApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: { ...asUser(staff), "idempotency-key": crypto.randomUUID() },
      payload: { badgeId: "P-ED", kind: "in" },
    });
    expect(res.statusCode).toBe(200);
    expect(
      (await pool.query(`SELECT event_key FROM time_logs WHERE user_id = $1`, [user])).rows,
    ).toEqual([{ event_key: "default" }]);
    // The badge belongs to the default edition, so e2's scanner does not know it.
    const other = await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: { ...asUser(staff), ...ed("e2"), "idempotency-key": crypto.randomUUID() },
      payload: { badgeId: "P-ED", kind: "out" },
    });
    expect(other.statusCode).toBe(404);
  });
});

describe("badge reassignment across editions (H22, H23, H53)", () => {
  it("refuses a code held in the current edition", async () => {
    const staff = await staffIn([CAPABILITIES.ACCREDIT_SCAN]);
    const holder = await attendeeIn("default", "t-holder");
    const other = await attendeeIn("default", "t-other");
    expect((await checkInUser(staff, holder, "CODE-1")).statusCode).toBe(200);

    const res = await checkInUser(staff, other, "CODE-1");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toBe("This badge is in use in this edition");
    const pool = await db();
    expect(
      (await pool.query(`SELECT badge_id FROM users WHERE id = $1`, [holder])).rows[0].badge_id,
    ).toBe("CODE-1");
    expect((await pool.query(`SELECT 1 FROM badge_id_history`)).rowCount).toBe(0);
  });

  it("moves a code from a previous edition's holder, keeping that edition's history", async () => {
    await createEdition("e2");
    const pool = await db();
    const staff = await staffIn([CAPABILITIES.ACCREDIT_SCAN], ["e2"]);
    const previous = await attendeeIn("e2", "t-prev");
    // Assigned while viewing e2 (the trigger stamps e2), then e2 stops being current.
    expect((await checkInUser(staff, previous, "CODE-2", "e2")).statusCode).toBe(200);
    expect(
      (await pool.query(`SELECT badge_event_key FROM users WHERE id = $1`, [previous])).rows[0]
        .badge_event_key,
    ).toBe("e2");

    const next = await attendeeIn("default", "t-next");
    const res = await checkInUser(staff, next, "CODE-2");
    expect(res.statusCode).toBe(200);

    const rows = await pool.query(
      `SELECT id, badge_id, badge_event_key FROM users WHERE id = ANY($1)`,
      [[previous, next]],
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r]));
    expect(byId.get(previous)?.badge_id).toBeNull();
    expect(byId.get(next)).toMatchObject({ badge_id: "CODE-2", badge_event_key: "default" });
    expect(
      (await pool.query(`SELECT user_id, badge_id, event_key FROM badge_id_history`)).rows,
    ).toEqual([{ user_id: previous, badge_id: "CODE-2", event_key: "e2" }]);
    const audits = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'badge' AND entity_id = $1`,
      [String(previous)],
    );
    expect(audits.rows.map((r) => r.action)).toContain("reassign_released");
  });

  it("does not let a previous edition's revocation block the same code now", async () => {
    await createEdition("e2");
    const pool = await db();
    const staff = await staffIn([CAPABILITIES.ACCREDIT_SCAN, CAPABILITIES.PRESENCE_SCAN], ["e2"]);
    const digest = scannerCredentialDigest("badge", "CODE-3");
    await pool.query(
      `INSERT INTO scanner_revoked_badges (credential_digest, event_key) VALUES ($1, 'e2')`,
      [digest],
    );
    const user = await attendeeIn("default", "t-3");
    expect((await checkInUser(staff, user, "CODE-3")).statusCode).toBe(200);

    const app = await getApp();
    const scan = (edition?: string) =>
      app.inject({
        method: "POST",
        url: "/api/presence/lookup",
        headers: { ...asUser(staff), ...ed(edition) },
        payload: { badgeId: "CODE-3" },
      });
    expect((await scan()).statusCode).toBe(200);
    // Within e2 the tombstone still stands.
    expect((await scan("e2")).json().error.code).toBe("badge_revoked");
  });

  it("only counts a rotated-away badge as revoked in the edition that released it", async () => {
    await createEdition("e2");
    const pool = await db();
    const staff = await staffIn([CAPABILITIES.PRESENCE_SCAN], ["e2"]);
    const user = await createUser();
    await pool.query(
      `INSERT INTO badge_id_history (user_id, badge_id, event_key) VALUES ($1, 'OLD-9', 'e2')`,
      [user],
    );
    const app = await getApp();
    const lookup = (edition?: string) =>
      app.inject({
        method: "POST",
        url: "/api/presence/lookup",
        headers: { ...asUser(staff), ...ed(edition) },
        payload: { badgeId: "OLD-9" },
      });
    expect((await lookup()).json().error.code).toBe("badge_unknown");
    expect((await lookup("e2")).json().error.code).toBe("badge_revoked");
  });
});

describe("closed edition scanners (H8)", () => {
  it("answers edition_closed to a scan and writes nothing", async () => {
    await createEdition("e3");
    const pool = await db();
    const staff = await staffIn([CAPABILITIES.PRESENCE_SCAN], ["e3"]);
    const user = await createUser();
    await pool.query(`UPDATE users SET badge_id = 'CODE-C' WHERE id = $1`, [user]);
    await pool.query(
      `UPDATE editions SET status = 'closed', closed_at = now() WHERE event_key = 'e3'`,
    );
    const app = await getApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: { ...asUser(staff), ...ed("e3"), "idempotency-key": crypto.randomUUID() },
      payload: { badgeId: "CODE-C", kind: "in" },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.stringify(res.json())).toContain("edition_closed");
    expect((await pool.query(`SELECT 1 FROM time_logs`)).rowCount).toBe(0);
  });
});

describe("schedule per edition (H48)", () => {
  it("lists the viewed edition's items and serves any item by id", async () => {
    await createEdition("e2");
    const pool = await db();
    const staff = await staffIn([CAPABILITIES.SCHEDULE_MANAGE], ["e2"]);
    const current = await pool.query(
      `INSERT INTO schedule (title, starts_at, ends_at)
       VALUES ('Opening', now() + interval '1 day', now() + interval '1 day 1 hour') RETURNING id`,
    );
    const previous = await pool.query(
      `INSERT INTO schedule (title, starts_at, ends_at, event_key)
       VALUES ('Old keynote', now() + interval '2 day', now() + interval '2 day 1 hour', 'e2')
       RETURNING id`,
    );
    const app = await getApp();
    const titles = async (edition?: string) =>
      (
        await app.inject({
          method: "GET",
          url: "/api/schedule",
          headers: { ...asUser(staff), ...ed(edition) },
        })
      )
        .json()
        .items.map((i: { title: string }) => i.title);
    expect(await titles()).toEqual(["Opening"]);
    expect(await titles("e2")).toEqual(["Old keynote"]);

    for (const id of [current.rows[0].id, previous.rows[0].id]) {
      for (const edition of [undefined, "e2"]) {
        const res = await app.inject({
          method: "GET",
          url: `/api/schedule/${id}/owners`,
          headers: { ...asUser(staff), ...ed(edition) },
        });
        expect(res.statusCode).toBe(200);
      }
    }
  });
});
