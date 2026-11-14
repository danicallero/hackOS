import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { asUser, createRole, createUser, seedAttendeeRoles, useTestApp } from "../helpers.js";
import { createApplication } from "./fixtures.js";

/**
 * Multi-edition applications (H11-H15): form lists and my-responses are scoped
 * to the viewed edition, and confirming a spot grants the form's roles in the
 * application's own edition (never the viewer's).
 */

const getApp = useTestApp();

async function createEdition(key: string) {
  await pool.query(`INSERT INTO editions (event_key, name, status) VALUES ($1, $1, 'active')`, [
    key,
  ]);
}

async function staffIn2(capabilities: string[]): Promise<number> {
  const userId = await createUser({ emailVerified: true });
  const roleId = await createRole(capabilities);
  await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [userId, roleId]);
  await pool.query(`INSERT INTO user_roles (user_id, role_id, event_key) VALUES ($1, $2, 'e2')`, [
    userId,
    roleId,
  ]);
  return userId;
}

describe("application editions", () => {
  it("lists forms per edition for staff and the public", async () => {
    const app = await getApp();
    await createEdition("e2");
    const staff = await staffIn2([CAPABILITIES.APPLICATIONS_MANAGE]);
    await createApplication({ name: "Now form" });
    const next = await createApplication({ name: "Next form" });
    await pool.query("UPDATE applications SET event_key = 'e2' WHERE id = $1", [next]);

    const names = async (url: string, edition?: string) =>
      (
        await app.inject({
          method: "GET",
          url,
          headers: { ...asUser(staff), ...(edition ? { "x-edition": edition } : {}) },
        })
      )
        .json()
        .applications.map((a: { name: string }) => a.name);
    expect(await names("/api/applications")).toEqual(["Now form"]);
    expect(await names("/api/applications", "e2")).toEqual(["Next form"]);
    expect(await names("/api/public/applications")).toEqual(["Now form"]);
  });

  it("grants confirmation roles in the application's edition", async () => {
    const app = await getApp();
    await seedAttendeeRoles();
    await createEdition("e2");
    const decider = await staffIn2([CAPABILITIES.APPLICATIONS_DECIDE]);
    const appId = await createApplication({ name: "E2 form" });
    await pool.query("UPDATE applications SET event_key = 'e2' WHERE id = $1", [appId]);

    const userId = await createUser({ emailVerified: true });
    const edition = { "x-edition": "e2" };
    // The applicant took part in e2 through a prior role there, so they may scope to it.
    await pool.query(`INSERT INTO user_roles (user_id, role_id, event_key) VALUES ($1, $2, 'e2')`, [
      userId,
      await createRole([]),
    ]);
    await app.inject({
      method: "PUT",
      url: `/api/applications/${appId}/response`,
      headers: { ...asUser(userId), ...edition },
      payload: { responses: { motivation: "yes" } },
    });
    await app.inject({
      method: "POST",
      url: `/api/applications/${appId}/response/submit`,
      headers: { ...asUser(userId), ...edition },
      payload: { food_intolerances: [], shirt_size: "M" },
    });
    const { rows } = await pool.query(
      "SELECT id FROM application_responses WHERE user_id = $1 AND application_id = $2",
      [userId, appId],
    );
    const responseId = rows[0].id;
    for (const [url, as, extra] of [
      [`/api/responses/${responseId}/decide`, decider, { decision: "accepted" }],
      [`/api/responses/${responseId}/send-decision`, decider, undefined],
      [`/api/me/responses/${responseId}/confirm`, userId, undefined],
    ] as const) {
      const res = await app.inject({
        method: "POST",
        url,
        headers: { ...asUser(as), ...edition },
        ...(extra ? { payload: extra } : {}),
      });
      expect(res.statusCode, url).toBeLessThan(300);
    }
    const granted = await pool.query(
      `SELECT event_key FROM user_roles WHERE user_id = $1 AND source = 'application_confirmed'`,
      [userId],
    );
    expect(granted.rows.map((r) => r.event_key)).toEqual(["e2"]);
  });
});
