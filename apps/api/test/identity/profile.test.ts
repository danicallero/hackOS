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

/** H7 profile routes + the derived illustrative role in GET /api/me. */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
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

async function getApp(): Promise<App> {
  if (!app) app = await buildTestApp();
  return app;
}

describe("GET /api/me (H7)", () => {
  it("returns own data and 401 anonymously", async () => {
    const a = await getApp();
    const anon = await a.inject({ method: "GET", url: "/api/me" });
    expect(anon.statusCode).toBe(401);

    const userId = await createUser({ name: "Grace" });
    const res = await a.inject({ method: "GET", url: "/api/me", headers: asUser(userId) });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Grace");
    expect(res.json().role).toBe("participant");
    // H8/H55: /api/me carries the effective capabilities for UI gating.
    expect(res.json().capabilities).toEqual([]);
  });

  it("exposes effective capabilities for UI gating (H8/H55)", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities(["*"]);
    const res = await a.inject({ method: "GET", url: "/api/me", headers: asUser(admin) });
    expect(res.statusCode).toBe(200);
    expect(res.json().capabilities).toContain("*");
  });

  it("derives the illustrative role: admin > judge > sponsor > staff > participant", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");

    const admin = await createUserWithCapabilities(["*"]);
    const staff = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
    const plain = await createUser();

    // judge: a room_judges row (needs the enterprise->sponsor->challenge chain)
    const judge = await createUser();
    const { rows: judgeEnt } = await pool.query(
      `INSERT INTO enterprises (name) VALUES ('JudgeCo') RETURNING id`,
    );
    const { rows: judgeSponsor } = await pool.query(
      `INSERT INTO sponsors (enterprise_id) VALUES ($1) RETURNING id`,
      [judgeEnt[0].id],
    );
    const { rows: challenge } = await pool.query(
      `INSERT INTO challenges (author, title) VALUES ($1, 'x') RETURNING id`,
      [judgeSponsor[0].id],
    );
    const { rows: room } = await pool.query(
      `INSERT INTO rooms (name, slug) VALUES ('Sala 1', 'sala-1') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO room_judges (room_id, challenge_id, user_id) VALUES ($1, $2, $3)`,
      [room[0].id, challenge[0].id, judge],
    );

    // sponsor: a sponsors row linked to the user
    const sponsorUser = await createUser();
    const { rows: ent } = await pool.query(
      `INSERT INTO enterprises (name) VALUES ('SponCo') RETURNING id`,
    );
    await pool.query(`INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)`, [
      ent[0].id,
      sponsorUser,
    ]);

    const roleOf = async (id: number) => {
      const res = await a.inject({ method: "GET", url: "/api/me", headers: asUser(id) });
      return res.json().role;
    };
    expect(await roleOf(admin)).toBe("admin");
    expect(await roleOf(judge)).toBe("judge");
    expect(await roleOf(sponsorUser)).toBe("sponsor");
    expect(await roleOf(staff)).toBe("staff");
    expect(await roleOf(plain)).toBe("participant");
  });
});

describe("PATCH /api/me (H7)", () => {
  it("updates own restricted fields", async () => {
    const a = await getApp();
    const userId = await createUser();
    const res = await a.inject({
      method: "PATCH",
      url: "/api/me",
      headers: asUser(userId),
      payload: { phone: "+34600000000", language: "gl", shirtSize: "M" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().phone).toBe("+34600000000");
    expect(res.json().language).toBe("gl");
    expect(res.json().shirtSize).toBe("M");
  });

  it("rejects restricted/system fields on self-edit (email, badge, dni, notes)", async () => {
    const a = await getApp();
    const userId = await createUser();
    for (const payload of [
      { email: "stolen@example.com" },
      { badgeId: "HACK" },
      { dni: "123X" },
      { notes: "self-noted" },
      { emailVerified: true },
    ]) {
      const res = await a.inject({
        method: "PATCH",
        url: "/api/me",
        headers: asUser(userId),
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it("rejects an empty patch", async () => {
    const a = await getApp();
    const userId = await createUser();
    const res = await a.inject({
      method: "PATCH",
      url: "/api/me",
      headers: asUser(userId),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("staff user routes (H7)", () => {
  it("GET /api/users/:id requires USERS_READ", async () => {
    const a = await getApp();
    const target = await createUser({ name: "Target" });
    const pleb = await createUser();
    const reader = await createUserWithCapabilities([CAPABILITIES.USERS_READ]);

    expect(
      (await a.inject({ method: "GET", url: `/api/users/${target}`, headers: asUser(pleb) }))
        .statusCode,
    ).toBe(403);
    const ok = await a.inject({
      method: "GET",
      url: `/api/users/${target}`,
      headers: asUser(reader),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().name).toBe("Target");
  });

  it("GET /api/users lists and searches users (USERS_READ)", async () => {
    const a = await getApp();
    await createUser({ name: "Ada", email: "ada@example.test" });
    await createUser({ name: "Grace", email: "grace@example.test" });
    const reader = await createUserWithCapabilities([CAPABILITIES.USERS_READ]);
    const pleb = await createUser();

    expect(
      (await a.inject({ method: "GET", url: "/api/users", headers: asUser(pleb) })).statusCode,
    ).toBe(403);

    const all = await a.inject({ method: "GET", url: "/api/users", headers: asUser(reader) });
    expect(all.statusCode).toBe(200);
    expect(all.json().total).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(all.json().users)).toBe(true);

    const search = await a.inject({
      method: "GET",
      url: "/api/users?q=grace",
      headers: asUser(reader),
    });
    expect(search.json().users.map((u: { email: string }) => u.email)).toContain(
      "grace@example.test",
    );
  });

  it("GET /api/users/:id includes role, capabilities and groups", async () => {
    const a = await getApp();
    const target = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
    const reader = await createUserWithCapabilities([CAPABILITIES.USERS_READ]);
    const res = await a.inject({
      method: "GET",
      url: `/api/users/${target}`,
      headers: asUser(reader),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("staff");
    expect(res.json().capabilities).toContain(CAPABILITIES.ACCREDIT_SCAN);
    expect(Array.isArray(res.json().groups)).toBe(true);
  });

  it("PATCH /api/users/:id requires USERS_WRITE, can fix dni/notes, and is audited (H53)", async () => {
    const a = await getApp();
    const target = await createUser();
    const editor = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
    const reader = await createUserWithCapabilities([CAPABILITIES.USERS_READ]);

    expect(
      (
        await a.inject({
          method: "PATCH",
          url: `/api/users/${target}`,
          headers: asUser(reader),
          payload: { name: "No" },
        })
      ).statusCode,
    ).toBe(403);

    const res = await a.inject({
      method: "PATCH",
      url: `/api/users/${target}`,
      headers: asUser(editor),
      payload: { name: "Fixed", dni: "00000000T", notes: "verified at desk" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dni).toBe("00000000T");

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'user' AND entity_id = $1 AND action = 'profile_update'`,
      [String(target)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBe(editor);
    expect(rows[0].after.dni).toBe("00000000T");
    expect(rows[0].before.dni).toBeNull();
  });

  it("404s on a missing user", async () => {
    const a = await getApp();
    const editor = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
    const res = await a.inject({
      method: "PATCH",
      url: "/api/users/999999",
      headers: asUser(editor),
      payload: { name: "Ghost" },
    });
    expect(res.statusCode).toBe(404);
  });
});
