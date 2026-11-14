import { CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { assignRole, asUser, createRole, createUser, useTestApp } from "../helpers.js";

/**
 * Enterprises, challenges, stand tags and the diary per edition (H43, H44, H45;
 * docs/multi-edition-plan.md §2, §9).
 */
const getApp = useTestApp();

function idem(userId: number, edition?: string): Record<string, string> {
  return {
    ...asUser(userId),
    "idempotency-key": crypto.randomUUID(),
    ...(edition ? { "x-edition": edition } : {}),
  };
}

function scoped(userId: number, edition?: string): Record<string, string> {
  return { ...asUser(userId), ...(edition ? { "x-edition": edition } : {}) };
}

async function setup() {
  await pool.query("INSERT INTO event_config (id, event_key, name) VALUES (1, 'e2026', 'E2026')");
  await pool.query(
    `INSERT INTO editions (event_key, name, status, closed_at) VALUES
       ('e2', 'E2', 'active', NULL), ('old', 'Old', 'active', NULL)`,
  );
  const admin = await createUser();
  const roleId = await createRole([CAPABILITIES.ADMIN_ALL], { isProtected: true });
  await assignRole(admin, roleId);
  return { admin };
}

/** Seed a past edition while it is open, then close it (read-only). */
async function closeOld(): Promise<void> {
  await pool.query(
    "UPDATE editions SET status = 'closed', closed_at = now() WHERE event_key = 'old'",
  );
}

async function enterprise(name: string, eventKey: string): Promise<number> {
  const { rows } = await pool.query(
    "INSERT INTO enterprises (name, event_key) VALUES ($1, $2) RETURNING id",
    [name, eventKey],
  );
  return rows[0].id;
}

async function tagOf(code: string, enterpriseId: number) {
  await pool.query(
    "INSERT INTO sponsor_stand_tags (enterprise_id, kind, code) VALUES ($1, 'nfc', $2)",
    [enterpriseId, code],
  );
}

describe("enterprises per edition", () => {
  it("allows the same name in two editions but not twice in one", async () => {
    const { admin } = await setup();
    const app = await getApp();
    const post = (edition?: string) =>
      app.inject({
        method: "POST",
        url: "/api/enterprises",
        headers: idem(admin, edition),
        payload: { name: "Acme", kind: "sponsor", visibility: "hidden" },
      });
    expect((await post()).statusCode).toBe(201);
    expect((await post("e2")).statusCode).toBe(201);
    expect((await post()).statusCode).toBe(409);
    expect((await post("e2")).statusCode).toBe(409);
  });

  it("lists enterprises and challenges of the viewed edition only", async () => {
    const { admin } = await setup();
    const app = await getApp();
    await enterprise("Current Co", "e2026");
    const e2Id = await enterprise("Second Co", "e2");
    const sponsor = await pool.query(
      "INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, NULL) RETURNING id",
      [e2Id],
    );
    await pool.query("INSERT INTO challenges (author, title) VALUES ($1, 'E2 challenge')", [
      sponsor.rows[0].id,
    ]);

    const names = async (edition?: string) =>
      (
        await app.inject({
          method: "GET",
          url: "/api/enterprises",
          headers: scoped(admin, edition),
        })
      )
        .json()
        .enterprises.map((e: { name: string }) => e.name);
    expect(await names()).toEqual(["Current Co"]);
    expect(await names("e2")).toEqual(["Second Co"]);

    const titles = async (edition?: string) =>
      (await app.inject({ method: "GET", url: "/api/challenges", headers: scoped(admin, edition) }))
        .json()
        .challenges.map((c: { title: { en: string } }) => c.title.en);
    expect(await titles()).toEqual([]);
    expect(await titles("e2")).toEqual(["E2 challenge"]);
  });
});

describe("stand tags across editions", () => {
  it("reassigns a previous edition's tag to a current company, audited", async () => {
    const { admin } = await setup();
    const app = await getApp();
    const previous = await enterprise("Old Co", "old");
    const current = await enterprise("New Co", "e2026");
    await tagOf("04AA0000000001", previous);
    await closeOld();
    const res = await app.inject({
      method: "POST",
      url: `/api/enterprises/${current}/stand-tags`,
      headers: idem(admin),
      payload: { kind: "nfc", uid: "04AA0000000001" },
    });
    expect(res.statusCode).toBe(201);
    const { rows } = await pool.query(
      "SELECT enterprise_id FROM sponsor_stand_tags WHERE code = '04AA0000000001'",
    );
    expect(rows).toEqual([{ enterprise_id: current }]);
    const audits = await pool.query(
      "SELECT 1 FROM audit_log WHERE action = 'stand_tag.reassigned' AND entity_id = $1",
      [String(current)],
    );
    expect(audits.rowCount).toBe(1);
  });

  it("refuses a tag held by a company of the current edition", async () => {
    const { admin } = await setup();
    const app = await getApp();
    const a = await enterprise("A", "e2026");
    const b = await enterprise("B", "e2026");
    await tagOf("04AA0000000002", a);
    const res = await app.inject({
      method: "POST",
      url: `/api/enterprises/${b}/stand-tags`,
      headers: idem(admin),
      payload: { kind: "nfc", uid: "04AA0000000002" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("answers edition_closed when scanning a code of a closed edition and writes nothing", async () => {
    await setup();
    const app = await getApp();
    const attendee = await createUser();
    const roleId = await createRole([]);
    await pool.query("UPDATE roles SET event_access = true WHERE id = $1", [roleId]);
    await assignRole(attendee, roleId);
    const previous = await enterprise("Old Co", "old");
    await tagOf("04AA0000000003", previous);
    await closeOld();
    const res = await app.inject({
      method: "POST",
      url: "/api/me/diary/scan",
      headers: idem(attendee),
      payload: { code: "04AA0000000003" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("edition_closed");
    expect((await pool.query("SELECT 1 FROM diary_entries")).rowCount).toBe(0);
  });
});

describe("diary per edition", () => {
  it("keeps one entry per owner and target in each edition and lists the viewed one", async () => {
    const { admin } = await setup();
    const app = await getApp();
    const target = await createUser();
    await pool.query(
      `INSERT INTO diary_entries (owner_id, target_user_id, event_key) VALUES
         ($1, $2, 'e2026'), ($1, $2, 'e2')`,
      [admin, target],
    );
    await expect(
      pool.query(
        "INSERT INTO diary_entries (owner_id, target_user_id, event_key) VALUES ($1, $2, 'e2')",
        [admin, target],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    const count = async (edition?: string) =>
      (
        await app.inject({ method: "GET", url: "/api/me/diary", headers: scoped(admin, edition) })
      ).json().items.length;
    // The target has no public profile, so cards are null but entries still list.
    expect(await count()).toBe(1);
    expect(await count("e2")).toBe(1);
  });
});
