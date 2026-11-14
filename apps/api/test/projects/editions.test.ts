import { CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { assignRole, asUser, createRole, createUser, useTestApp } from "../helpers.js";

/**
 * Projects and gallery per edition (H18, H20; docs/multi-edition-plan.md §4,
 * §8.2): lists scoped, by-id stable with the project's edition, closed-edition
 * projects public and read-only.
 */
const getApp = useTestApp();

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

async function repo(name: string, eventKey: string, status = "submitted"): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO repos (name, submission_status, submitted_at, event_key)
     VALUES ($1, $2, CASE WHEN $2 = 'submitted' THEN now() END, $3) RETURNING id`,
    [name, status, eventKey],
  );
  const id = rows[0].id as number;
  if (status === "submitted") {
    await pool.query(
      `INSERT INTO project_submission_versions (repo_id, source, snapshot)
       SELECT id, 'native', jsonb_build_object('project', to_jsonb(r)) FROM repos r WHERE id = $1`,
      [id],
    );
  }
  return id;
}

describe("gallery per edition", () => {
  it("lists the viewed edition's projects and serves by id across editions with the edition", async () => {
    const { admin } = await setup();
    const app = await getApp();
    const current = await repo("Current project", "e2026");
    const second = await repo("Second project", "e2");
    const names = async (edition?: string) =>
      (
        await app.inject({
          method: "GET",
          url: "/api/public/projects",
          headers: scoped(admin, edition),
        })
      )
        .json()
        .items.map((p: { name: string }) => p.name);
    expect(await names()).toEqual(["Current project"]);
    expect(await names("e2")).toEqual(["Second project"]);

    const byId = await app.inject({
      method: "GET",
      url: `/api/public/projects/${second}`,
      headers: scoped(admin),
    });
    expect(byId.statusCode).toBe(200);
    expect(byId.json().edition).toEqual({ eventKey: "e2", name: "E2" });
    const cur = await app.inject({
      method: "GET",
      url: `/api/public/projects/${current}`,
      headers: scoped(admin, "e2"),
    });
    expect(cur.json().edition.eventKey).toBe("e2026");
  });

  it("makes a closed edition's submitted projects public regardless of current gallery rules", async () => {
    await setup();
    const app = await getApp();
    const past = await repo("Past project", "old");
    await repo("Past draft", "old", "draft");
    await closeOld();
    const list = await app.inject({
      method: "GET",
      url: "/api/public/projects",
      headers: { "x-edition": "old" },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((p: { name: string }) => p.name)).toEqual(["Past project"]);
    const byId = await app.inject({ method: "GET", url: `/api/public/projects/${past}` });
    expect(byId.statusCode).toBe(200);
    expect(byId.json().edition.eventKey).toBe("old");
  });
});

describe("my projects and closed editions", () => {
  it("scopes my projects to the viewed edition", async () => {
    const { admin } = await setup();
    const app = await getApp();
    const a = await repo("Mine now", "e2026", "draft");
    const b = await repo("Mine in e2", "e2", "draft");
    for (const id of [a, b])
      await pool.query(
        "INSERT INTO submissions (repo_id, user_id, status) VALUES ($1, $2, 'active')",
        [id, admin],
      );
    const names = async (edition?: string) =>
      (
        await app.inject({
          method: "GET",
          url: "/api/me/projects",
          headers: scoped(admin, edition),
        })
      )
        .json()
        .projects.map((p: { name: string }) => p.name);
    expect(await names()).toEqual(["Mine now"]);
    expect(await names("e2")).toEqual(["Mine in e2"]);
  });

  it("rejects editing a closed edition's project with 409 edition_closed", async () => {
    await setup();
    const app = await getApp();
    const member = await createUser();
    const id = await repo("Past draft", "old", "draft");
    await pool.query(
      "INSERT INTO submissions (repo_id, user_id, status) VALUES ($1, $2, 'active')",
      [id, member],
    );
    await closeOld();
    const res = await app.inject({
      method: "PUT",
      url: `/api/me/projects/${id}/draft`,
      headers: { ...asUser(member), "idempotency-key": crypto.randomUUID() },
      payload: { responses: {}, revision: 0 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("edition_closed");
  });
});
