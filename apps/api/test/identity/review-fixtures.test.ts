import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { config } from "../../src/config.js";
import { recordReviewFixtureAuthentication } from "../../src/modules/identity/review-fixture-usage.js";
import { logisticsStats } from "../../src/modules/logistics/stats.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  ensureApplicationFormVersion,
  seedAttendeeRoles,
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
  // H8 full-replacement: configureFixtureParticipant grants the real seeded
  // Participant role (identity/role.ts's assignAttendeeRole) instead of
  // writing manual_attendee_roles directly — truncateAll wipes 0805's seed
  // data every test, so recreate it before regenerate() runs.
  await seedAttendeeRoles();
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

  it("keeps fixture subjects and queues out of ordinary admin reads and reports safe usage telemetry", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const result = await regenerate(a, admin);
    const outside = result.accounts.find(
      (account) => account.fixtureKey === "participant-anonymize-outside",
    );
    if (!outside) throw new Error("Expected outside fixture");
    const outsideId = await fixtureUserId(outside.email);

    const statusBefore = await a.inject({
      method: "GET",
      url: "/api/admin/review-fixtures",
      headers: asUser(admin),
    });
    expect(statusBefore.statusCode).toBe(200);
    expect(statusBefore.json().accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fixtureKey: "participant-anonymize-outside",
          email: outside.email,
          active: true,
          lastAuthenticatedAt: null,
        }),
      ]),
    );

    const { pool } = await import("../../src/db/pool.js");
    await recordReviewFixtureAuthentication(pool, outside.email);
    const statusAfter = await a.inject({
      method: "GET",
      url: "/api/admin/review-fixtures",
      headers: asUser(admin),
    });
    expect(statusAfter.statusCode).toBe(200);
    const used = statusAfter
      .json()
      .accounts.find(
        (account: { fixtureKey: string }) => account.fixtureKey === outside.fixtureKey,
      );
    expect(used.lastAuthenticatedAt).toEqual(expect.any(String));

    const ordinaryList = await a.inject({
      method: "GET",
      url: `/api/users?q=${encodeURIComponent(outside.email)}`,
      headers: asUser(admin),
    });
    expect(ordinaryList.statusCode).toBe(200);
    expect(ordinaryList.json()).toMatchObject({ users: [], total: 0 });

    const directProfile = await a.inject({
      method: "GET",
      url: `/api/users/${outsideId}`,
      headers: asUser(admin),
    });
    expect(directProfile.statusCode).toBe(404);

    const { rows: queueRows } = await pool.query<{
      challenge_id: number;
      repo_id: number;
      queue_entry_id: number;
    }>(
      `SELECT challenge_id, repo_id, queue_entry_id
         FROM review_fixture_queues
        WHERE fixture_key = 'participant-anonymize-outside'`,
    );
    expect(queueRows).toHaveLength(1);
    const queue = queueRows[0];
    if (!queue) throw new Error("Expected fixture queue");
    const { rows: groupRows } = await pool.query<{ queue_group_id: number }>(
      `SELECT queue_group_id FROM queue_group_challenges WHERE challenge_id = $1`,
      [queue.challenge_id],
    );
    expect(groupRows).toHaveLength(1);
    const queueGroupId = groupRows[0]?.queue_group_id;
    if (!queueGroupId) throw new Error("Expected fixture queue group");

    const hiddenQueue = await a.inject({
      method: "GET",
      url: `/api/queue/groups/${queueGroupId}/queue`,
      headers: asUser(admin),
    });
    expect(hiddenQueue.statusCode).toBe(404);

    const participantQueue = await a.inject({
      method: "GET",
      url: "/api/queue/me",
      headers: asUser(outsideId),
    });
    expect(participantQueue.statusCode).toBe(200);
    expect(participantQueue.json()).toHaveLength(1);
    expect(participantQueue.json()[0]).toMatchObject({
      challengeId: queue.challenge_id,
      repoId: queue.repo_id,
      entryId: queue.queue_entry_id,
    });

    // Application responses are another participant-data edge: a guessed
    // response id must not bypass the synthetic visibility boundary even when
    // the caller has the broad admin capability.
    const { rows: applicationRows } = await pool.query<{ id: number }>(
      `INSERT INTO applications (name, type, template)
       VALUES ('Synthetic response form', 'participant', '[]'::jsonb)
       RETURNING id`,
    );
    const applicationId = applicationRows[0]?.id;
    if (!applicationId) throw new Error("Expected synthetic response form");
    const formVersionId = await ensureApplicationFormVersion(applicationId);
    const { rows: responseRows } = await pool.query<{ id: number }>(
      `INSERT INTO application_responses
         (user_id, application_id, application_form_version_id, status, responses)
       VALUES ($1, $2, $3, 'review', '{}'::jsonb)
       RETURNING id`,
      [outsideId, applicationId, formVersionId],
    );
    const responseId = responseRows[0]?.id;
    if (!responseId) throw new Error("Expected synthetic application response");

    const hiddenUserApplications = await a.inject({
      method: "GET",
      url: `/api/users/${outsideId}/applications`,
      headers: asUser(admin),
    });
    expect(hiddenUserApplications.statusCode).toBe(200);
    expect(hiddenUserApplications.json()).toEqual({ responses: [] });

    const hiddenApplicationResponses = await a.inject({
      method: "GET",
      url: `/api/applications/${applicationId}/responses`,
      headers: asUser(admin),
    });
    expect(hiddenApplicationResponses.statusCode).toBe(200);
    expect(hiddenApplicationResponses.json()).toEqual({ responses: [] });

    const hiddenResponseDetail = await a.inject({
      method: "GET",
      url: `/api/responses/${responseId}`,
      headers: asUser(admin),
    });
    expect(hiddenResponseDetail.statusCode).toBe(404);

    const hiddenDecision = await a.inject({
      method: "POST",
      url: `/api/responses/${responseId}/decide`,
      headers: asUser(admin),
      payload: { decision: "accepted" },
    });
    expect(hiddenDecision.statusCode).toBe(404);

    // DSR/export rows are also participant data. A legacy row aimed at a
    // synthetic subject must not become visible through a guessed request id,
    // and a new request must fail at the subject-scope boundary.
    const { rows: requestRows } = await pool.query<{ id: number }>(
      `INSERT INTO data_subject_requests (subject_user_id, requested_by, type, status)
       VALUES ($1, $2, 'export', 'completed')
       RETURNING id`,
      [outsideId, admin],
    );
    const requestId = requestRows[0]?.id;
    if (!requestId) throw new Error("Expected synthetic data-subject request");

    const hiddenRequests = await a.inject({
      method: "GET",
      url: "/api/exports/requests",
      headers: asUser(admin),
    });
    expect(hiddenRequests.statusCode).toBe(200);
    expect(hiddenRequests.json().items).toEqual([]);

    const hiddenRequest = await a.inject({
      method: "GET",
      url: `/api/exports/requests/${requestId}`,
      headers: asUser(admin),
    });
    expect(hiddenRequest.statusCode).toBe(404);

    const refusedRequest = await a.inject({
      method: "POST",
      url: "/api/exports/requests",
      headers: { ...asUser(admin), "idempotency-key": "synthetic-export" },
      payload: { subjectUserId: outsideId, type: "export" },
    });
    expect(refusedRequest.statusCode).toBe(404);
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
    const { pool } = await import("../../src/db/pool.js");
    const { rows: announcementRows } = await pool.query<{ id: number }>(
      `INSERT INTO announcements (author_id, title, body)
       VALUES ($1, 'Synthetic announcement', 'Fixture-only announcement')
       RETURNING id`,
      [fixtureId],
    );
    const announcementId = announcementRows[0]?.id;
    if (!announcementId) throw new Error("Expected synthetic announcement");
    const { rows: requestRows } = await pool.query<{ id: number }>(
      `INSERT INTO data_subject_requests (subject_user_id, requested_by, type, status)
       VALUES ($1, $2, 'export', 'pending')
       RETURNING id`,
      [fixtureId, admin],
    );
    const requestId = requestRows[0]?.id;
    if (!requestId) throw new Error("Expected synthetic data-subject request");

    const response = await a.inject({
      method: "POST",
      url: "/api/me/anonymize",
      headers: { ...asUser(fixtureId), "idempotency-key": "fixture-anonymize" },
      payload: { confirm: true, securityPin: fixturePin },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "completed", anonymized: true });

    expect(
      (await pool.query(`SELECT 1 FROM announcements WHERE id = $1`, [announcementId])).rowCount,
    ).toBe(0);
    const { rows: scrubbedRequestRows } = await pool.query<{
      subject_user_id: number | null;
      status: string;
    }>(`SELECT subject_user_id, status FROM data_subject_requests WHERE id = $1`, [requestId]);
    expect(scrubbedRequestRows).toEqual([{ subject_user_id: null, status: "pending" }]);
    expect(
      (
        await pool.query(
          `SELECT 1 FROM audit_log
            WHERE entity_type = 'data_subject_request'
              AND entity_id = $1::text
              AND action = 'fixture_scope_marked'
              AND after ->> 'is_test_account' = 'true'`,
          [requestId],
        )
      ).rowCount,
    ).toBe(1);
    const scrubbedRequests = await a.inject({
      method: "GET",
      url: "/api/exports/requests",
      headers: asUser(admin),
    });
    expect(scrubbedRequests.statusCode).toBe(200);
    expect(scrubbedRequests.json().items).toEqual([]);

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
