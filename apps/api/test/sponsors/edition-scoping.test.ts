import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { scoped, setup } from "../edition-fixtures.js";
import { asUser, createUser, createUserWithCapabilities, useTestApp } from "../helpers.js";

/**
 * H43-H45/H8: by-id enterprise routes act on the viewed edition only (404 for
 * another edition's enterprise); batch visibility/reorder skip or reject its
 * ids; a capability unrelated to sponsors reveals no hidden company content.
 */
const getApp = useTestApp();

function headers(userId: number, edition?: string): Record<string, string> {
  return { ...scoped(userId, edition), "idempotency-key": crypto.randomUUID() };
}

async function enterprise(name: string, eventKey: string, visibility = "visible"): Promise<number> {
  const { rows } = await pool.query(
    "INSERT INTO enterprises (name, event_key, visibility) VALUES ($1, $2, $3) RETURNING id",
    [name, eventKey, visibility],
  );
  return rows[0].id;
}

describe("enterprise by-id routes per edition", () => {
  it("answers 404 for an enterprise of another edition and works in its own", async () => {
    const { admin } = await setup();
    const app = await getApp();
    const other = await enterprise("Second Co", "e2");
    const member = await createUser();
    const call = (
      method: "GET" | "PATCH" | "POST" | "PUT",
      path: string,
      payload?: unknown,
      edition?: string,
    ) =>
      app.inject({
        method,
        url: `/api/enterprises/${other}${path}`,
        headers: headers(admin, edition),
        payload: payload as Record<string, unknown> | undefined,
      });

    expect((await call("GET", "")).statusCode).toBe(404);
    expect((await call("PATCH", "", { website: "https://x.test" })).statusCode).toBe(404);
    expect((await call("GET", "/members")).statusCode).toBe(404);
    expect((await call("POST", "/members", { userId: member })).statusCode).toBe(404);
    expect((await call("GET", "/judges")).statusCode).toBe(404);
    expect((await call("POST", "/judges", { userId: member })).statusCode).toBe(404);
    expect((await call("GET", "/stand-tags")).statusCode).toBe(404);
    expect((await call("PUT", "/stand-scannable", { scannable: true })).statusCode).toBe(404);
    const untouched = await pool.query(
      "SELECT website, stand_scannable FROM enterprises WHERE id = $1",
      [other],
    );
    expect(untouched.rows[0]).toEqual({ website: null, stand_scannable: false });
    expect(
      (await pool.query("SELECT 1 FROM sponsors WHERE enterprise_id = $1", [other])).rowCount,
    ).toBe(0);

    expect((await call("GET", "", undefined, "e2")).statusCode).toBe(200);
    expect((await call("PATCH", "", { website: "https://x.test" }, "e2")).statusCode).toBe(200);
    expect((await call("GET", "/members", undefined, "e2")).statusCode).toBe(200);
    expect((await call("GET", "/stand-tags", undefined, "e2")).statusCode).toBe(200);
    expect((await call("PUT", "/stand-scannable", { scannable: true }, "e2")).statusCode).toBe(200);
  });

  it("keeps another edition's enterprises out of bulk visibility and reorder", async () => {
    const { admin } = await setup();
    const app = await getApp();
    const mine = await enterprise("Mine", "e2026", "hidden");
    const theirs = await enterprise("Theirs", "e2", "hidden");

    const visibility = await app.inject({
      method: "POST",
      url: "/api/enterprises/visibility",
      headers: headers(admin),
      payload: { ids: [mine, theirs], visible: true },
    });
    expect(visibility.statusCode).toBe(200);
    expect(visibility.json().updated).toEqual([mine]);
    const { rows } = await pool.query("SELECT id, visibility FROM enterprises ORDER BY id");
    expect(rows).toEqual([
      { id: mine, visibility: "visible" },
      { id: theirs, visibility: "hidden" },
    ]);

    const reorder = await app.inject({
      method: "POST",
      url: "/api/enterprises/reorder",
      headers: headers(admin),
      payload: { ids: [mine, theirs], priority: 1 },
    });
    expect(reorder.statusCode).toBe(404);
    const after = await pool.query("SELECT priority FROM enterprises WHERE id = $1", [theirs]);
    expect(after.rows[0].priority).toBeNull();
  });

  it("does not let a sponsor rep of an old edition edit that edition's company from the current view", async () => {
    await setup();
    const app = await getApp();
    const old = await enterprise("Old Co", "e2");
    const rep = await createUser();
    await pool.query("INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2)", [old, rep]);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/enterprises/${old}`,
      headers: headers(rep),
      payload: { website: "https://rep.test" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("company page for users holding an unrelated capability", () => {
  it("shows a scanner volunteer no hidden company, hidden challenge or draft item", async () => {
    await setup();
    const app = await getApp();
    const hidden = await enterprise("Stealth", "e2026", "hidden");
    const acme = await enterprise("Acme", "e2026");
    const { rows: sponsor } = await pool.query(
      "INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, NULL) RETURNING id",
      [acme],
    );
    await pool.query(
      `INSERT INTO challenges (author, title, description, visibility) VALUES
         ($1, 'Revealed', 'Open', 'visible'), ($1, 'Secret', 'Not yet', 'hidden')`,
      [sponsor[0].id],
    );
    const { rows: draft } = await pool.query(
      `INSERT INTO schedule (title, starts_at, ends_at, visibility, audiences)
       VALUES ('Draft', now() + interval '1 hour', now() + interval '2 hours', 'hidden', ARRAY['participant'])
       RETURNING id`,
    );
    await pool.query(
      "INSERT INTO schedule_enterprises (schedule_id, enterprise_id) VALUES ($1, $2)",
      [draft[0].id, acme],
    );
    const volunteer = await createUserWithCapabilities([CAPABILITIES.PRESENCE_MANAGE]);
    const get = (userId: number, id: number) =>
      app.inject({ method: "GET", url: `/api/enterprises/${id}/profile`, headers: asUser(userId) });

    expect((await get(volunteer, hidden)).statusCode).toBe(404);
    const page = (await get(volunteer, acme)).json();
    expect(page.challenges.map((c: { title: string }) => c.title)).toEqual(["Revealed"]);
    expect(page.activities).toEqual([]);

    const manager = await createUserWithCapabilities([
      CAPABILITIES.SPONSORS_MANAGE,
      CAPABILITIES.SCHEDULE_READ,
    ]);
    expect((await get(manager, hidden)).statusCode).toBe(200);
    const full = (await get(manager, acme)).json();
    expect(full.challenges).toHaveLength(2);
    expect(full.activities).toHaveLength(1);
  });
});
