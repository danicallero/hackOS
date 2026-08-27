import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { config } from "../../src/config.js";
import { logisticsStats } from "../../src/modules/logistics/stats.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

/** H54: synthetic App Store/QA fixtures are isolated, repeatable and non-statistical. */

let app: App;
const fixturePassword = "review-fixture-password";
const fixturePin = "246810";

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  config.REVIEW_FIXTURE_PASSWORD = fixturePassword;
  config.REVIEW_FIXTURE_DELETION_PIN = fixturePin;
});

afterEach(() => {
  config.REVIEW_FIXTURE_PASSWORD = undefined;
  config.REVIEW_FIXTURE_DELETION_PIN = undefined;
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

async function regenerate(a: App, adminId: number, key = `review-fixtures-${crypto.randomUUID()}`) {
  const response = await a.inject({
    method: "POST",
    url: "/api/admin/review-fixtures/regenerate",
    headers: { ...asUser(adminId), "idempotency-key": key },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as {
    generation: number;
    accounts: Array<{ fixtureKey: string; kind: "participant" | "staff"; email: string }>;
    staticDeletionPinConfigured: true;
  };
}

async function fixtureUserId(email: string): Promise<number> {
  const { pool } = await import("../../src/db/pool.js");
  const { rows } = await pool.query<{ id: number }>(`SELECT id FROM users WHERE email = $1`, [
    email,
  ]);
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw new Error("Expected a fixture user");
  return row.id;
}

describe("review fixture regeneration", () => {
  it("requires admin capability and returns the four synthetic reviewer accounts", async () => {
    const a = await getApp();
    const ordinary = await createUserWithCapabilities([CAPABILITIES.USERS_READ]);
    const denied = await a.inject({
      method: "POST",
      url: "/api/admin/review-fixtures/regenerate",
      headers: asUser(ordinary),
    });
    expect(denied.statusCode).toBe(403);

    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const result = await regenerate(a, admin);
    expect(result.generation).toBe(1);
    expect(result.staticDeletionPinConfigured).toBe(true);
    expect(result.accounts.map((account) => account.fixtureKey)).toEqual([
      "participant-delete",
      "participant-anonymize-outside",
      "participant-anonymize-inside",
      "staff-exit-operator",
    ]);

    const { pool } = await import("../../src/db/pool.js");
    const { rows: users } = await pool.query<{
      id: number;
      email: string;
      is_test_account: boolean;
    }>(
      `SELECT id, email, is_test_account
         FROM users
        WHERE email LIKE 'app-review-%@hackos.test'
        ORDER BY email`,
    );
    expect(users).toHaveLength(4);
    expect(users.every((user) => user.is_test_account)).toBe(true);
    const { rows: registry } = await pool.query(
      `SELECT fixture_key, user_id, generation
         FROM review_fixture_accounts
        WHERE user_id IS NOT NULL
        ORDER BY fixture_key`,
    );
    expect(registry).toHaveLength(4);
    expect(registry.every((row) => row.generation === 1)).toBe(true);

    const staff = result.accounts.find((account) => account.fixtureKey === "staff-exit-operator");
    const inside = result.accounts.find(
      (account) => account.fixtureKey === "participant-anonymize-inside",
    );
    expect(staff).toBeDefined();
    expect(inside).toBeDefined();
    const staffId = await fixtureUserId(staff?.email ?? "");
    const { rows: badgeRows } = await pool.query<{ badge_id: string }>(
      `SELECT badge_id FROM users WHERE email = $1`,
      [inside?.email],
    );
    const badge = badgeRows[0];
    if (!badge) throw new Error("Expected an inside fixture badge");
    const lookup = await a.inject({
      method: "POST",
      url: "/api/presence/lookup",
      headers: asUser(staffId),
      payload: { badgeId: badge.badge_id },
    });
    expect(lookup.statusCode).toBe(200);

    const realUser = await createUser({
      email: "real-attendee@example.test",
      name: "Real Attendee",
    });
    await pool.query(
      `UPDATE users SET surname = 'Not Fixture', badge_id = 'real-badge' WHERE id = $1`,
      [realUser],
    );
    const hiddenSearch = await a.inject({
      method: "POST",
      url: "/api/logistics/people/search",
      headers: asUser(staffId),
      payload: { q: "real-attendee@example.test" },
    });
    expect(hiddenSearch.statusCode).toBe(200);
    expect(hiddenSearch.json().results).toEqual([]);

    const hiddenLookup = await a.inject({
      method: "POST",
      url: "/api/presence/lookup",
      headers: asUser(staffId),
      payload: { badgeId: "real-badge" },
    });
    expect(hiddenLookup.statusCode).toBe(403);
    expect(hiddenLookup.json().error.details.code).toBe("review_fixture_scope");

    const snapshot = await a.inject({
      method: "GET",
      url: "/api/scanner/snapshot",
      headers: asUser(staffId),
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().people).toHaveLength(3);
    expect(
      snapshot
        .json()
        .people.every((person: { email: string }) => person.email.includes("@hackos.test")),
    ).toBe(true);

    const adminSearch = await a.inject({
      method: "POST",
      url: "/api/logistics/people/search",
      headers: asUser(admin),
      payload: { q: "real-attendee@example.test" },
    });
    expect(adminSearch.statusCode).toBe(200);
    expect(adminSearch.json().results).toHaveLength(1);
  });

  it("fails closed when fixture secrets are not configured", async () => {
    const a = await getApp();
    config.REVIEW_FIXTURE_PASSWORD = undefined;
    config.REVIEW_FIXTURE_DELETION_PIN = undefined;
    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const response = await a.inject({
      method: "POST",
      url: "/api/admin/review-fixtures/regenerate",
      headers: asUser(admin),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.details.code).toBe("review_fixtures_not_configured");
  });

  it("uses the static PIN only for a marked fixture and deletes the fresh fixture account", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const result = await regenerate(a, admin);
    const fixture = result.accounts.find((account) => account.fixtureKey === "participant-delete");
    expect(fixture).toBeDefined();
    const fixtureId = await fixtureUserId(fixture?.email ?? "");

    const pin = await a.inject({
      method: "POST",
      url: "/api/me/removal-pin",
      headers: asUser(fixtureId),
    });
    expect(pin.statusCode).toBe(200);
    expect(pin.json()).toEqual({ status: "static" });

    const deleted = await a.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { ...asUser(fixtureId), "idempotency-key": "fixture-delete" },
      payload: { securityPin: fixturePin },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ status: "completed", deleted: true });

    const { pool } = await import("../../src/db/pool.js");
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [fixtureId])).rowCount).toBe(0);
    expect(
      (
        await pool.query(
          `SELECT user_id FROM review_fixture_accounts WHERE fixture_key = 'participant-delete'`,
        )
      ).rows[0].user_id,
    ).toBeNull();

    const real = await import("../../src/modules/identity/removal-pin.js");
    const realUser = await createUser();
    const realPin = await pool.connect();
    try {
      const issued = await real.issueRemovalPin(realPin, realUser);
      expect(issued.status).toBe("sent");
    } finally {
      realPin.release();
    }
  });

  it("retains an anonymized fixture's presence aggregate without an identity mapping", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const result = await regenerate(a, admin);
    const fixture = result.accounts.find(
      (account) => account.fixtureKey === "participant-anonymize-outside",
    );
    expect(fixture).toBeDefined();
    const fixtureId = await fixtureUserId(fixture?.email ?? "");

    const response = await a.inject({
      method: "POST",
      url: "/api/me/anonymize",
      headers: { ...asUser(fixtureId), "idempotency-key": "fixture-anonymize" },
      payload: { confirm: true, securityPin: fixturePin },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "completed", anonymized: true });

    const { pool } = await import("../../src/db/pool.js");
    const { rows: anonymous } = await pool.query<{
      id: string;
      guaranteed_presence_minutes: number;
      is_test_account: boolean;
    }>(
      `SELECT id, guaranteed_presence_minutes, is_test_account
         FROM anonymous_participants
        WHERE is_test_account = true`,
    );
    expect(anonymous).toHaveLength(1);
    const anonymousRow = anonymous[0];
    if (!anonymousRow) throw new Error("Expected an anonymous fixture subject");
    expect(anonymousRow.is_test_account).toBe(true);
    expect(anonymousRow.guaranteed_presence_minutes).toBeGreaterThanOrEqual(29);
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [fixtureId])).rowCount).toBe(0);
    expect(
      (
        await pool.query(`SELECT 1 FROM anonymous_participant_fields WHERE value::text LIKE $1`, [
          "%participant-anonymize-outside%",
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query(
          `SELECT user_id FROM review_fixture_accounts
            WHERE fixture_key = 'participant-anonymize-outside'`,
        )
      ).rows[0].user_id,
    ).toBeNull();
  });

  it("keeps synthetic accreditation and presence out of logistics statistics", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    await regenerate(a, admin);
    const stats = await logisticsStats();
    expect(stats.accreditedCount).toBe(0);
    expect(stats.currentlyPresent).toBe(0);
    expect(stats.accreditedByRole).toEqual([]);
  });
});
