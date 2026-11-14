import { CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { createApplication } from "../applications/fixtures.js";
import { asUser, createRole, createUser, useTestApp } from "../helpers.js";

/** Multi-edition statistics (H27): application scopes follow the viewed edition. */

const getApp = useTestApp();

describe("statistics editions", () => {
  it("lists application scopes of the viewed edition only", async () => {
    const app = await getApp();
    await pool.query(
      `INSERT INTO editions (event_key, name, status) VALUES ('e2', 'E2', 'active')`,
    );
    const userId = await createUser();
    const roleId = await createRole([CAPABILITIES.LOGISTICS_STATS]);
    await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [userId, roleId]);
    await pool.query(`INSERT INTO user_roles (user_id, role_id, event_key) VALUES ($1, $2, 'e2')`, [
      userId,
      roleId,
    ]);
    await createApplication({ name: "Now form" });
    const next = await createApplication({ name: "Next form" });
    await pool.query("UPDATE applications SET event_key = 'e2' WHERE id = $1", [next]);

    const ids = async (edition?: string) => {
      const res = await app.inject({
        method: "GET",
        url: "/api/statistics/scopes",
        headers: { ...asUser(userId), ...(edition ? { "x-edition": edition } : {}) },
      });
      expect(res.statusCode).toBe(200);
      return res
        .json()
        .scopes.filter((s: { kind: string }) => s.kind === "application")
        .map((s: { id: number }) => s.id);
    };
    const current = await ids();
    expect(current).toHaveLength(1);
    expect(current).not.toContain(next);
    expect(await ids("e2")).toEqual([next]);
  });
});
