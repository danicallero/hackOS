import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  assignRole,
  asUser,
  buildTestApp,
  createRole,
  createUser,
  createUserWithCapabilities,
  ensureApplicationFormVersion,
  grantAttendeeRole,
  truncateAll,
} from "../helpers.js";
import { assignBadge, makeConfirmed } from "./fixtures.js";

let app: App;
let scanner: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  scanner = await createUserWithCapabilities([CAPABILITIES.ACTIVITY_SCAN]);
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

async function getStats(app: App, userId: number) {
  const res = await app.inject({
    method: "GET",
    url: "/api/scanner/role-stats",
    headers: asUser(userId),
  });
  expect(res.statusCode).toBe(200);
  return res.json().byRole as Array<{
    role: string;
    hasCapabilities: boolean;
    eligible: number;
    accredited: number;
    inside: number;
  }>;
}

function forRole<T extends { role: string }>(byRole: T[], role: string) {
  return byRole.find((r) => r.role === role);
}

/** A named "Staff" role holding the given capabilities, so scanner-role-stats' by-name grouping is assertable. */
async function createNamedStaff(capabilities: string[]): Promise<number> {
  const userId = await createUser();
  const roleId = await createRole(capabilities, { name: "Staff" });
  await assignRole(userId, roleId);
  return userId;
}

describe("scanner role stats", () => {
  it("treats staff as always eligible regardless of application status", async () => {
    const staff = await createNamedStaff([CAPABILITIES.ACTIVITY_SCAN]);
    await assignBadge(staff, "STF-1");

    const byRole = await getStats(app, scanner);
    const row = forRole(byRole, "Staff");
    expect(row?.eligible).toBeGreaterThanOrEqual(1); // staff (the scanner's own throwaway role has a different name)
    expect(row?.accredited).toBe(1);
    // H8: no more fixed admin/staff role-name spelling to match on — the
    // mobile scanner's "staff" group instead reads this real capability
    // signal, same underlying data as the eligibility check above.
    expect(row?.hasCapabilities).toBe(true);
  });

  it("reports hasCapabilities: false for a role with no capability holders", async () => {
    const confirmed = await createUser();
    await makeConfirmed(confirmed);
    await grantAttendeeRole(confirmed, "participant");
    await assignBadge(confirmed, "PAX-NOCAP");

    const byRole = await getStats(app, scanner);
    const row = forRole(byRole, "Participant");
    expect(row?.hasCapabilities).toBe(false);
  });

  it("gates participants on their application's confirmed status", async () => {
    const { pool } = await import("../../src/db/pool.js");

    const confirmed = await createUser();
    await makeConfirmed(confirmed);
    await grantAttendeeRole(confirmed, "participant");
    await assignBadge(confirmed, "PAX-CONFIRMED");

    const unconfirmed = await createUser();
    await grantAttendeeRole(unconfirmed, "participant");
    await pool.query(
      `INSERT INTO applications (name, type, template) VALUES ('participant-app', 'participant', '{}'::jsonb)`,
    );
    const app_ = await pool.query(`SELECT id FROM applications WHERE name = 'participant-app'`);
    const formVersionId = await ensureApplicationFormVersion(app_.rows[0].id);
    await pool.query(
      `INSERT INTO application_responses
         (user_id, application_id, application_form_version_id, status)
       VALUES ($1, $2, $3, 'submitted')`,
      [unconfirmed, app_.rows[0].id, formVersionId],
    );

    const byRole = await getStats(app, scanner);
    const row = forRole(byRole, "Participant");
    // Only the confirmed participant is eligible; the unconfirmed one isn't.
    expect(row?.eligible).toBe(1);
    expect(row?.accredited).toBe(1);
  });

  it("counts a currently-present person as inside", async () => {
    const doorStaff = await createUserWithCapabilities([CAPABILITIES.PRESENCE_SCAN]);
    const staff = await createNamedStaff([CAPABILITIES.ACTIVITY_SCAN]);
    await assignBadge(staff, "IN-1");

    const scan = await app.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: asUser(doorStaff),
      payload: { badgeId: "IN-1", kind: "in" },
    });
    expect(scan.statusCode).toBe(200);

    const byRole = await getStats(app, scanner);
    const row = forRole(byRole, "Staff");
    expect(row?.inside).toBeGreaterThanOrEqual(1);
  });

  it("requires a scanner-adjacent capability", async () => {
    const bystander = await createUser();
    const res = await app.inject({
      method: "GET",
      url: "/api/scanner/role-stats",
      headers: asUser(bystander),
    });
    expect(res.statusCode).toBe(403);
  });
});
