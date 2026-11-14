import { CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { asUser, createRole, createUser, useTestApp } from "../helpers.js";

/**
 * Multi-edition help desk (H61-H67): helper profiles, listings, requests and
 * opening windows are per edition; a closed edition rejects help desk writes.
 */

const getApp = useTestApp();

async function createEdition(key: string) {
  await pool.query(`INSERT INTO editions (event_key, name, status) VALUES ($1, $1, 'active')`, [
    key,
  ]);
}

/** A user holding `capabilities` in the current edition and in `e2`. */
async function userIn(capabilities: string[]): Promise<number> {
  const userId = await createUser();
  const roleId = await createRole(capabilities);
  await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [userId, roleId]);
  await pool.query(`INSERT INTO user_roles (user_id, role_id, event_key) VALUES ($1, $2, 'e2')`, [
    userId,
    roleId,
  ]);
  return userId;
}

function call(
  method: "GET" | "PUT" | "POST",
  url: string,
  as: number,
  opts: { edition?: string; payload?: object } = {},
) {
  return getApp().then((app) =>
    app.inject({
      method,
      url,
      headers: {
        ...asUser(as),
        ...(opts.edition ? { "x-edition": opts.edition } : {}),
        ...(method === "GET" ? {} : { "idempotency-key": crypto.randomUUID() }),
      },
      ...(opts.payload ? { payload: opts.payload } : {}),
    }),
  );
}

const listed = async (as: number, edition?: string) =>
  (await call("GET", "/api/helpdesk/helpers", as, { edition }))
    .json()
    .helpers.map((h: { userId: number }) => h.userId);

describe("help desk editions", () => {
  it("keeps helper profiles per edition", async () => {
    await createEdition("e2");
    const helper = await userIn([CAPABILITIES.HELPDESK_OFFER]);
    const browser = await userIn([CAPABILITIES.HELPDESK_REQUEST]);

    const published = await call("PUT", "/api/me/helper-profile", helper, {
      payload: { published: true, topicIds: [] },
    });
    expect(published.json(), JSON.stringify(published.json())).toBeTruthy();
    expect(published.statusCode).toBe(200);
    expect(await listed(browser)).toEqual([helper]);
    expect(await listed(browser, "e2")).toEqual([]);

    const mineE2 = await call("GET", "/api/me/helper-profile", helper, { edition: "e2" });
    expect(mineE2.json().published).toBe(false);

    const again = await call("PUT", "/api/me/helper-profile", helper, {
      edition: "e2",
      payload: { published: true, topicIds: [] },
    });
    expect(again.statusCode).toBe(200);
    expect(await listed(browser, "e2")).toEqual([helper]);
    const { rows } = await pool.query(
      "SELECT event_key FROM helper_profiles WHERE user_id = $1 ORDER BY event_key",
      [helper],
    );
    expect(rows.map((r) => r.event_key)).toEqual(["default", "e2"]);
  });

  it("scopes request lists to the viewed edition", async () => {
    await createEdition("e2");
    const requester = await userIn([CAPABILITIES.HELPDESK_REQUEST]);
    await pool.query(
      `INSERT INTO help_requests (requester_id, description, location, other, routing, status, cancelled_at, event_key)
       VALUES ($1, 'here', 'A1', true, 'none', 'cancelled', now(), 'default'),
              ($1, 'there', 'B2', true, 'none', 'cancelled', now(), 'e2')`,
      [requester],
    );
    const current = await call("GET", "/api/helpdesk/requests/mine", requester);
    const other = await call("GET", "/api/helpdesk/requests/mine", requester, { edition: "e2" });
    expect(current.json().requests.map((r: { description: string }) => r.description)).toEqual([
      "here",
    ]);
    expect(other.json().requests.map((r: { description: string }) => r.description)).toEqual([
      "there",
    ]);
  });

  it("scopes open windows and rejects helper writes in a closed edition", async () => {
    await createEdition("e2");
    const manager = await userIn([CAPABILITIES.HELPDESK_MANAGE]);
    const helper = await userIn([CAPABILITIES.HELPDESK_OFFER]);
    await pool.query(
      `INSERT INTO helpdesk_open_windows (starts_at, ends_at, event_key)
       VALUES (now() - interval '1 hour', now() + interval '1 hour', 'e2')`,
    );
    const current = await call("GET", "/api/helpdesk/schedule", manager);
    const e2 = await call("GET", "/api/helpdesk/schedule", manager, { edition: "e2" });
    expect(current.json().windows).toHaveLength(0);
    expect(e2.json().windows).toHaveLength(1);

    await pool.query(
      "UPDATE editions SET status = 'closed', closed_at = now() WHERE event_key = 'e2'",
    );
    const write = await call("PUT", "/api/me/helper-profile", helper, {
      edition: "e2",
      payload: { published: true, topicIds: [] },
    });
    expect(write.statusCode).toBe(409);
    expect(JSON.stringify(write.json())).toContain("edition_closed");
    // Reading a closed edition still works.
    const read = await call("GET", "/api/helpdesk/schedule", manager, { edition: "e2" });
    expect(read.statusCode).toBe(200);
  });
});
