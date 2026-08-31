import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { SSE_TOPICS } from "@hackos/shared/events";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  ensureApplicationFormVersion,
  grantAttendeeRole,
  seedAttendeeRoles,
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

const UNVERIFIED_TEST_PASSWORD = "remove-me-with-this-password";

async function addCredentialPassword(
  userId: number,
  password = UNVERIFIED_TEST_PASSWORD,
): Promise<void> {
  const { pool } = await import("../../src/db/pool.js");
  await pool.query(
    `INSERT INTO accounts (user_id, account_id, provider_id, password)
     VALUES ($1, $2, 'credential', $3)`,
    [userId, String(userId), await hashPassword(password)],
  );
}

async function requestRemovalPin(a: App, userId: number): Promise<string> {
  const { pool } = await import("../../src/db/pool.js");
  const response = await a.inject({
    method: "POST",
    url: "/api/me/removal-pin",
    headers: asUser(userId),
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().status).toBe("sent");
  const { rows } = await pool.query<{ payload: { vars?: { pin?: string } } }>(
    `SELECT payload
       FROM notification_outbox
      WHERE user_id = $1
        AND payload->>'template' = 'auth.accountRemovalPin'
      ORDER BY id DESC
      LIMIT 1`,
    [userId],
  );
  const pin = rows[0]?.payload?.vars?.pin;
  expect(pin).toMatch(/^\d{6}$/);
  return pin as string;
}

describe("GET /api/me (H7)", () => {
  it("lets staff manually classify a user as participant or mentor and issues a ticket", async () => {
    const a = await getApp();
    await seedAttendeeRoles();
    const manager = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
    const user = await createUser();
    const res = await a.inject({
      method: "PUT",
      url: `/api/users/${user}/attendee-role`,
      headers: asUser(manager),
      payload: { role: "mentor" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ role: "mentor", ticketIssued: true });
    expect(
      (await a.inject({ method: "GET", url: "/api/me", headers: asUser(user) })).json().role,
    ).toBe("mentor");
  });

  it("returns own data and 401 anonymously", async () => {
    const a = await getApp();
    const anon = await a.inject({ method: "GET", url: "/api/me" });
    expect(anon.statusCode).toBe(401);

    const userId = await createUser({ name: "Grace" });
    const res = await a.inject({ method: "GET", url: "/api/me", headers: asUser(userId) });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Grace");
    expect(res.json().role).toBe("unassigned");
    expect(res.json().mobileAccess).toBe(false);
    // H8/H55: /api/me carries the effective capabilities for UI gating.
    expect(res.json().capabilities).toEqual([]);
  });

  it("allows event team members and sent acceptances into mobile, but not internal decisions", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const staff = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
    const accepted = await createUser();
    const internal = await createUser();
    const invited = await createUser();
    const { rows: applications } = await pool.query(
      `INSERT INTO applications (name, type, template)
       VALUES ('Participants', 'participant', '[]'::jsonb) RETURNING id`,
    );
    const formVersionId = await ensureApplicationFormVersion(applications[0].id);
    await pool.query(
      `INSERT INTO application_responses
         (user_id, application_id, application_form_version_id, status, decision_sent_at)
       VALUES ($1, $3, $4, 'accepted', now()), ($2, $3, $4, 'accepted_internal', NULL)`,
      [accepted, internal, applications[0].id, formVersionId],
    );
    await pool.query(
      `INSERT INTO email_verification_tokens
         (token, type, email, user_id, kind, expires_at, used_at)
       SELECT 'mobile-invite', 'account_claim', email, id, 'participant', now(), now()
       FROM users WHERE id = $1`,
      [invited],
    );

    const accessOf = async (id: number) => {
      const res = await a.inject({ method: "GET", url: "/api/me", headers: asUser(id) });
      return res.json().mobileAccess;
    };
    expect(await accessOf(staff)).toBe(true);
    expect(await accessOf(accepted)).toBe(true);
    expect(await accessOf(internal)).toBe(false);
    expect(await accessOf(invited)).toBe(true);
  });

  it("exposes effective capabilities for UI gating (H8/H55)", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities(["*"]);
    const res = await a.inject({ method: "GET", url: "/api/me", headers: asUser(admin) });
    expect(res.statusCode).toBe(200);
    expect(res.json().capabilities).toContain("*");
  });

  it("exposes the caller's complete assigned-role set alongside the single displayed role (H8)", async () => {
    const a = await getApp();
    const { createRole, assignRole } = await import("../helpers.js");
    const staff = await createUser();
    const lower = await createRole([CAPABILITIES.ACCREDIT_SCAN], {
      name: "lower-role",
      isVisible: false,
    });
    const higher = await createRole([CAPABILITIES.USERS_READ], { name: "higher-role" });
    await assignRole(staff, lower);
    await assignRole(staff, higher);

    const res = await a.inject({ method: "GET", url: "/api/me", headers: asUser(staff) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: lower, name: "lower-role", isVisible: false }),
        expect.objectContaining({ id: higher, name: "higher-role", isVisible: true }),
      ]),
    );
    // Highest-position first — createRole assigns random positions, so just
    // confirm both are present and ordered by position descending.
    const positions = body.roles.map((r: { position: number }) => r.position);
    expect(positions).toEqual([...positions].sort((x, y) => y - x));
  });

  it("derives the illustrative role: admin > judge > sponsor > staff > mentor > participant > unassigned", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");

    const admin = await createUserWithCapabilities(["*"]);
    const staff = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
    const plain = await createUser();
    // H8 full-replacement: mentor/participant is the holder's effective role
    // (getEffectiveRole's badge_category), not a guess from an application's
    // static `type` column — grant the real seeded Mentor/Participant role
    // instead of just submitting an application of that type.
    const participant = await createUser();
    await grantAttendeeRole(participant, "participant");
    const mentor = await createUser();
    await grantAttendeeRole(mentor, "mentor");

    // judge: an enterprise_judges row (the roster is enterprise-scoped)
    const judge = await createUser();
    const { rows: judgeEnt } = await pool.query(
      `INSERT INTO enterprises (name) VALUES ('JudgeCo') RETURNING id`,
    );
    const { rows: judgeSponsor } = await pool.query(
      `INSERT INTO sponsors (enterprise_id) VALUES ($1) RETURNING id`,
      [judgeEnt[0].id],
    );
    await pool.query(`INSERT INTO challenges (author, title) VALUES ($1, 'x') RETURNING id`, [
      judgeSponsor[0].id,
    ]);
    await pool.query(`INSERT INTO enterprise_judges (enterprise_id, user_id) VALUES ($1, $2)`, [
      judgeEnt[0].id,
      judge,
    ]);

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
    expect(await roleOf(mentor)).toBe("mentor");
    expect(await roleOf(participant)).toBe("participant");
    expect(await roleOf(plain)).toBe("unassigned");
  });

  it("exposes isEnterpriseJudge/isSponsorRep independently so a sponsor rep who also judges keeps both (H8/H55, issue #187)", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");

    // One person: a sponsor representative (sponsors.user_id) who is also on
    // an enterprise judge roster (enterprise_judges.user_id). The
    // single-priority `role` field collapses this to "judge" — nav must not
    // rely on it.
    const both = await createUser();
    const { rows: ent } = await pool.query(
      `INSERT INTO enterprises (name) VALUES ('BothCo') RETURNING id`,
    );
    const { rows: sponsor } = await pool.query(
      `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
      [ent[0].id, both],
    );
    await pool.query(`INSERT INTO challenges (author, title) VALUES ($1, 'x')`, [sponsor[0].id]);
    await pool.query(`INSERT INTO enterprise_judges (enterprise_id, user_id) VALUES ($1, $2)`, [
      ent[0].id,
      both,
    ]);

    const res = await a.inject({ method: "GET", url: "/api/me", headers: asUser(both) });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("judge"); // priority order still collapses the display-only role
    expect(res.json().isEnterpriseJudge).toBe(true);
    expect(res.json().isSponsorRep).toBe(true); // ...but both association facts survive independently

    const judgeOnly = await createUser();
    await pool.query(`INSERT INTO enterprise_judges (enterprise_id, user_id) VALUES ($1, $2)`, [
      ent[0].id,
      judgeOnly,
    ]);
    const judgeOnlyRes = await a.inject({
      method: "GET",
      url: "/api/me",
      headers: asUser(judgeOnly),
    });
    expect(judgeOnlyRes.json().isEnterpriseJudge).toBe(true);
    expect(judgeOnlyRes.json().isSponsorRep).toBe(false);
  });

  it("exposes hasProject/hasQueueItems so nav can hide My project/My queue with nothing to show (issue #424)", async () => {
    const a = await getApp();
    const { createChallenge, createRepoWithTeam, enqueueRepo } = await import(
      "../queue/fixtures.js"
    );

    const bystander = await createUser();
    const empty = await a.inject({ method: "GET", url: "/api/me", headers: asUser(bystander) });
    expect(empty.json().hasProject).toBe(false);
    expect(empty.json().hasQueueItems).toBe(false);

    const member = await createUser();
    const { repoId } = await createRepoWithTeam([member]);
    const withProjectOnly = await a.inject({
      method: "GET",
      url: "/api/me",
      headers: asUser(member),
    });
    expect(withProjectOnly.json().hasProject).toBe(true);
    expect(withProjectOnly.json().hasQueueItems).toBe(false);

    const challengeId = await createChallenge();
    await enqueueRepo(challengeId, repoId, 1);
    const withQueueToo = await a.inject({ method: "GET", url: "/api/me", headers: asUser(member) });
    expect(withQueueToo.json().hasProject).toBe(true);
    expect(withQueueToo.json().hasQueueItems).toBe(true);
  });
});

describe("self-service account removal (H54)", () => {
  it("requires and consumes a one-time PIN for verified-primary-email self-removal", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const user = await createUser({
      name: "Verified Self Deletable",
      email: "verified-self-deletable@example.test",
      emailVerified: true,
    });

    const eligibility = await a.inject({
      method: "GET",
      url: "/api/me/removal-eligibility",
      headers: asUser(user),
    });
    expect(eligibility.statusCode).toBe(200);
    expect(eligibility.json()).toMatchObject({
      action: "delete",
      securityPinRequired: true,
      reauthenticationRequired: false,
    });

    const withoutPin = await a.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { ...asUser(user), "idempotency-key": "verified-delete-without-pin" },
    });
    expect(withoutPin.statusCode).toBe(400);
    expect(withoutPin.json().error.message).toContain("security PIN");
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [user])).rowCount).toBe(1);

    const pin = await requestRemovalPin(a, user);
    const { rows: challenge } = await pool.query<{ pin_digest: string; nonce: string }>(
      `SELECT pin_digest, nonce
         FROM account_removal_pin_challenges
        WHERE user_id = $1 AND consumed_at IS NULL`,
      [user],
    );
    expect(challenge).toHaveLength(1);
    const issuedChallenge = challenge[0];
    expect(issuedChallenge).toBeDefined();
    if (!issuedChallenge) throw new Error("Expected an active removal PIN challenge");
    expect(issuedChallenge.pin_digest).not.toBe(pin);
    expect(issuedChallenge.pin_digest).not.toContain(pin);
    expect(issuedChallenge.nonce).not.toBe(pin);

    const wrongPin = pin === "000000" ? "000001" : "000000";
    const wrong = await a.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { ...asUser(user), "idempotency-key": "verified-delete-wrong-pin" },
      payload: { securityPin: wrongPin },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.details.code).toBe("removal_pin_invalid");

    const deleted = await a.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { ...asUser(user), "idempotency-key": "verified-delete-correct-pin" },
      payload: { securityPin: pin },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deleted).toBe(true);
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [user])).rowCount).toBe(0);
    expect(
      (await pool.query(`SELECT 1 FROM account_removal_pin_challenges WHERE user_id = $1`, [user]))
        .rowCount,
    ).toBe(0);
  });

  it("requires the current password when an unverified account cannot receive an email PIN", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const user = await createUser({ emailVerified: false });
    await addCredentialPassword(user);

    const pin = await a.inject({
      method: "POST",
      url: "/api/me/removal-pin",
      headers: asUser(user),
    });
    expect(pin.statusCode).toBe(200);
    expect(pin.json()).toEqual({ status: "not_required" });
    expect(
      (await pool.query(`SELECT 1 FROM account_removal_pin_challenges WHERE user_id = $1`, [user]))
        .rowCount,
    ).toBe(0);

    const eligibility = await a.inject({
      method: "GET",
      url: "/api/me/removal-eligibility",
      headers: asUser(user),
    });
    expect(eligibility.json()).toMatchObject({
      securityPinRequired: false,
      reauthenticationRequired: true,
    });

    const withoutPassword = await a.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { ...asUser(user), "idempotency-key": "unverified-delete-no-password" },
    });
    expect(withoutPassword.statusCode).toBe(400);
    expect(withoutPassword.json().error.details.code).toBe("removal_reauthentication_required");

    const wrongPassword = await a.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { ...asUser(user), "idempotency-key": "unverified-delete-wrong-password" },
      payload: { reauthenticationPassword: "wrong-password" },
    });
    expect(wrongPassword.statusCode).toBe(400);
    expect(wrongPassword.json().error.details.code).toBe("removal_reauthentication_invalid");

    const deleted = await a.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { ...asUser(user), "idempotency-key": "unverified-delete-correct-password" },
      payload: { reauthenticationPassword: UNVERIFIED_TEST_PASSWORD },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deleted).toBe(true);
  });

  it("requires an idempotency key for self-service removal", async () => {
    const a = await getApp();
    const user = await createUser({ emailVerified: true });
    const response = await a.inject({ method: "DELETE", url: "/api/me", headers: asUser(user) });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.code).toBe("idempotency_key_required");
  });

  it("lets an accepted but unconfirmed applicant delete their account and forfeit the spot", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const user = await createUser({ name: "Accepted Self Deletable", emailVerified: true });
    const { rows: applications } = await pool.query(
      `INSERT INTO applications (name, type, template)
       VALUES ('Participants', 'participant', '[]'::jsonb) RETURNING id`,
    );
    const formVersionId = await ensureApplicationFormVersion(applications[0].id);
    const { rows: tokens } = await pool.query(
      `INSERT INTO email_verification_tokens
         (token, type, email, user_id, expires_at)
       VALUES ('accepted-delete-token', 'spot_confirmation', 'accepted@example.com', $1,
               now() + interval '7 days')
       RETURNING id`,
      [user],
    );
    const { rows: responses } = await pool.query(
      `INSERT INTO application_responses
         (user_id, application_id, application_form_version_id, status, responses, confirmation_token_id,
          decision_sent_at, submitted_at)
       VALUES ($1, $2, $3, 'accepted', '{}'::jsonb, $4, now(), now())
       RETURNING id`,
      [user, applications[0].id, formVersionId, tokens[0].id],
    );
    await pool.query(
      `INSERT INTO notification_outbox (user_id, category, channel, status)
       VALUES ($1, 'application', 'email', 'sent')`,
      [user],
    );
    // A saved notification-channel toggle (H51) is a UI preference, not
    // operational history — it must not block self-delete either.
    await pool.query(
      `INSERT INTO notification_preferences (user_id, category, channel, enabled)
       VALUES ($1, 'application', 'push', false)`,
      [user],
    );

    const eligibility = await a.inject({
      method: "GET",
      url: "/api/me/removal-eligibility",
      headers: asUser(user),
    });
    expect(eligibility.statusCode).toBe(200);
    expect(eligibility.json().action).toBe("delete");

    const pin = await requestRemovalPin(a, user);
    const removalHeaders = { ...asUser(user), "idempotency-key": "accepted-delete-replay" };
    const deleted = await a.inject({
      method: "DELETE",
      url: "/api/me",
      headers: removalHeaders,
      payload: { securityPin: pin },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deleted).toBe(true);
    const replay = await a.inject({
      method: "DELETE",
      url: "/api/me",
      headers: removalHeaders,
      payload: { securityPin: pin },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(
      (await pool.query(`SELECT 1 FROM application_responses WHERE id = $1`, [responses[0].id]))
        .rowCount,
    ).toBe(0);
    expect(
      (await pool.query(`SELECT 1 FROM notification_preferences WHERE user_id = $1`, [user]))
        .rowCount,
    ).toBe(0);
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [user])).rowCount).toBe(0);
  });

  it("lets an unaccepted applicant delete their own account and its application data", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const user = await createUser({ name: "Self Deletable", emailVerified: false });
    await addCredentialPassword(user);
    const { rows: applications } = await pool.query(
      `INSERT INTO applications (name, type, template)
       VALUES ('Participants', 'participant', '[]'::jsonb) RETURNING id`,
    );
    const formVersionId = await ensureApplicationFormVersion(applications[0].id);
    await pool.query(
      `INSERT INTO application_responses
         (user_id, application_id, application_form_version_id, status, responses)
       VALUES ($1, $2, $3, 'rejected', '{}'::jsonb)`,
      [user, applications[0].id, formVersionId],
    );

    const eligibility = await a.inject({
      method: "GET",
      url: "/api/me/removal-eligibility",
      headers: asUser(user),
    });
    expect(eligibility.statusCode).toBe(200);
    expect(eligibility.json().action).toBe("delete");

    const deleted = await a.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { ...asUser(user), "idempotency-key": "unaccepted-delete" },
      payload: { reauthenticationPassword: UNVERIFIED_TEST_PASSWORD },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deleted).toBe(true);
    expect(
      (await pool.query(`SELECT 1 FROM application_responses WHERE user_id = $1`, [user])).rowCount,
    ).toBe(0);
    // The test-only x-test-user-id header still passes through the account
    // state guard; a deleted account is no longer authenticated.
    expect(
      (await a.inject({ method: "GET", url: "/api/me", headers: asUser(user) })).statusCode,
    ).toBe(401);
  });

  it("lets an invited-but-unassigned account delete itself, clearing its claim token, outbox rows, and self-authored audit rows", async () => {
    // Regression: a plain participant invite acceptance leaves an unavoidable
    // used email_verification_tokens row, a queued/sent notification_outbox
    // row (the invite/welcome email), and an audit_log row with
    // actor_id = the new user (the "accept" audit entry) — none of that is
    // operational history the org needs, but all three used to permanently
    // force "anonymize" for accounts that never applied, were never
    // accepted, and hold no capability/ticket at all (found in production:
    // a fresh account was stuck on "anonymize" solely because of a leftover
    // notification_outbox row from its invite email).
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const user = await createUser({ name: "Invited Unassigned", emailVerified: false });
    await addCredentialPassword(user);
    const { rows: tok } = await pool.query(
      `INSERT INTO email_verification_tokens (token, type, email, user_id, kind, expires_at, used_at)
       VALUES ('claim-tok', 'account_claim', 'invited@example.com', $1, 'participant', now(), now())
       RETURNING id`,
      [user],
    );
    await pool.query(
      `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, source)
       VALUES ($1, 'invite', '999', 'accept', 'email')`,
      [user],
    );
    await pool.query(
      `INSERT INTO notification_outbox (user_id, category, channel, status)
       VALUES ($1, 'auth', 'email', 'sent')`,
      [user],
    );

    const eligibility = await a.inject({
      method: "GET",
      url: "/api/me/removal-eligibility",
      headers: asUser(user),
    });
    expect(eligibility.statusCode).toBe(200);
    expect(eligibility.json().action).toBe("delete");

    const deleted = await a.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { ...asUser(user), "idempotency-key": "invited-delete" },
      payload: { reauthenticationPassword: UNVERIFIED_TEST_PASSWORD },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deleted).toBe(true);
    expect(
      (await pool.query(`SELECT 1 FROM email_verification_tokens WHERE id = $1`, [tok[0].id]))
        .rowCount,
    ).toBe(0);
    expect(
      (await pool.query(`SELECT 1 FROM notification_outbox WHERE user_id = $1`, [user])).rowCount,
    ).toBe(0);
    const { rows: survivingAudit } = await pool.query(
      `SELECT actor_id FROM audit_log WHERE entity_type = 'invite' AND entity_id = '999'`,
    );
    // Actor attribution is deliberately discarded by full deletion instead
    // of being left as a detached historical identity row.
    expect(survivingAudit).toHaveLength(0);
  });

  it("lets a confirmed ticket-holder who hasn't been accredited yet delete their account", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const user = await createUser({ name: "Confirmed Not Accredited", emailVerified: false });
    await addCredentialPassword(user);
    await pool.query(`INSERT INTO tickets (user_id, token) VALUES ($1, 'tok-self-deletable')`, [
      user,
    ]);
    await pool.query(
      `INSERT INTO wallet_passes (user_id, purpose, platform, serial_number, authentication_token)
       VALUES ($1, 'ticket', 'apple', 'serial-self-deletable', 'auth-self-deletable')`,
      [user],
    );

    const eligibility = await a.inject({
      method: "GET",
      url: "/api/me/removal-eligibility",
      headers: asUser(user),
    });
    expect(eligibility.statusCode).toBe(200);
    expect(eligibility.json().action).toBe("delete");

    const deleted = await a.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { ...asUser(user), "idempotency-key": "confirmed-delete" },
      payload: { reauthenticationPassword: UNVERIFIED_TEST_PASSWORD },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deleted).toBe(true);
    expect((await pool.query(`SELECT 1 FROM tickets WHERE user_id = $1`, [user])).rowCount).toBe(0);
    expect(
      (await pool.query(`SELECT 1 FROM wallet_passes WHERE user_id = $1`, [user])).rowCount,
    ).toBe(0);
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [user])).rowCount).toBe(0);
  });

  it("blocks self-deletion once accredited at check-in (must go through an admin)", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const staff = await createUser({ name: "Door Staff" });
    const user = await createUser({ name: "Accredited", emailVerified: false });
    await pool.query(`INSERT INTO tickets (user_id, token) VALUES ($1, 'tok-self-blocked')`, [
      user,
    ]);
    await pool.query(`UPDATE users SET badge_id = 'B-SELF-BLOCKED' WHERE id = $1`, [user]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id) VALUES ($1, 'B-SELF-BLOCKED', $2)`,
      [user, staff],
    );

    const eligibility = await a.inject({
      method: "GET",
      url: "/api/me/removal-eligibility",
      headers: asUser(user),
    });
    expect(eligibility.statusCode).toBe(200);
    expect(eligibility.json()).toMatchObject({
      action: "anonymize",
      reasonCode: "operational_history",
    });

    const blocked = await a.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { ...asUser(user), "idempotency-key": "accredited-delete-blocked" },
    });
    expect(blocked.statusCode).toBe(409);
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [user])).rowCount).toBe(1);
  });

  it("treats door history without canonical accreditation as an integrity warning, not permanent retention", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const user = await createUser({
      email: "inconsistent-presence@example.test",
      emailVerified: false,
    });
    await addCredentialPassword(user);
    await pool.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at)
       VALUES ($1, 'in', now() - interval '10 minutes')`,
      [user],
    );

    const eligibility = await a.inject({
      method: "GET",
      url: "/api/me/removal-eligibility",
      headers: asUser(user),
    });
    expect(eligibility.statusCode).toBe(200);
    expect(eligibility.json()).toMatchObject({
      action: "delete",
      reasonCode: "inconsistent_operational_reference",
      operationalHistoryRetained: false,
      integrityWarning: true,
      requiresVenueExit: true,
    });

    const removal = await a.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { ...asUser(user), "idempotency-key": "inconsistent-delete" },
      payload: { reauthenticationPassword: UNVERIFIED_TEST_PASSWORD },
    });
    expect(removal.statusCode).toBe(202);
    expect(removal.json()).toEqual({
      status: "pending_exit",
      pendingExit: true,
      accessRevoked: true,
    });
    // Even an inconsistent account selected for full deletion must retain its
    // temporary Better Auth credential while staff still need to record the
    // open exit; deleting it before returning pending_exit strands the flow.
    expect((await pool.query(`SELECT 1 FROM accounts WHERE user_id = $1`, [user])).rowCount).toBe(
      1,
    );
  });

  it("broadcasts queue deletion after self-removal deletes an orphan project", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const { createChallenge, createRepoWithTeam, enqueueRepo, queueGroupOf } = await import(
      "../queue/fixtures.js"
    );
    const { getQueue } = await import("../../src/lib/queues.js");
    const { QUEUE_PARTICIPANT_INVALIDATIONS } = await import("../../src/modules/queue/notify.js");
    const user = await createUser({
      email: "orphan-queue-removal@example.test",
      emailVerified: false,
    });
    await addCredentialPassword(user);
    const challengeId = await createChallenge();
    const { repoId } = await createRepoWithTeam([user]);
    const entryId = await enqueueRepo(challengeId, repoId, 1);
    const queueGroupId = await queueGroupOf(challengeId);

    const removal = await a.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { ...asUser(user), "idempotency-key": "orphan-queue-removal" },
      payload: { reauthenticationPassword: UNVERIFIED_TEST_PASSWORD },
    });

    expect(removal.statusCode).toBe(200);
    expect(removal.json()).toEqual({ status: "completed", deleted: true });
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [user])).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM repos WHERE id = $1`, [repoId])).rowCount).toBe(0);
    expect(
      (await pool.query(`SELECT 1 FROM queue_entries WHERE id = $1`, [entryId])).rowCount,
    ).toBe(0);

    const { valkey } = await import("../../src/lib/valkey.js");
    expect(await valkey.get(`sse:seq:${SSE_TOPICS.QUEUE}`)).toBe("1");
    const jobs = await getQueue(QUEUE_PARTICIPANT_INVALIDATIONS).getJobs([
      "delayed",
      "waiting",
      "active",
    ]);
    expect(jobs).toContainEqual(
      expect.objectContaining({
        data: { challengeId, queueGroupId },
      }),
    );
  });

  it("preserves a shared project held by a linked Devpost member without a submission", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const { createChallenge, createRepoWithTeam, enqueueRepo } = await import(
      "../queue/fixtures.js"
    );
    const departing = await createUser({
      email: "shared-project-departure@example.test",
      emailVerified: false,
    });
    const surviving = await createUser({ email: "linked-devpost-member@example.test" });
    await addCredentialPassword(departing);
    const challengeId = await createChallenge();
    const { repoId } = await createRepoWithTeam([departing], "Shared Devpost project");
    await pool.query(
      `INSERT INTO devpost_participants
         (repo_id, email, user_id, import_batch, merge_status)
       VALUES ($1, $2, $3, 'test', 'manually_linked')`,
      [repoId, "linked-devpost-member@example.test", surviving],
    );
    const entryId = await enqueueRepo(challengeId, repoId, 1);

    const removal = await a.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { ...asUser(departing), "idempotency-key": "shared-project-departure" },
      payload: { reauthenticationPassword: UNVERIFIED_TEST_PASSWORD },
    });

    expect(removal.statusCode).toBe(200);
    expect(removal.json()).toEqual({ status: "completed", deleted: true });
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [departing])).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM repos WHERE id = $1`, [repoId])).rowCount).toBe(1);
    expect(
      (await pool.query(`SELECT 1 FROM queue_entries WHERE id = $1`, [entryId])).rowCount,
    ).toBe(1);
    expect(
      (
        await pool.query(
          `SELECT user_id FROM devpost_participants WHERE repo_id = $1 AND user_id = $2`,
          [repoId, surviving],
        )
      ).rows,
    ).toEqual([{ user_id: surviving }]);
  });

  it("uses event dates only for the live warning, never to bypass the lifecycle boundary", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const staff = await createUser({ emailVerified: false });
    const user = await createUser({
      email: "partial-event-window@example.test",
      emailVerified: false,
    });
    await pool.query(`UPDATE users SET badge_id = 'B-PARTIAL-WINDOW' WHERE id = $1`, [user]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id)
       VALUES ($1, 'B-PARTIAL-WINDOW', $2)`,
      [user, staff],
    );
    await pool.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at)
       VALUES ($1, 'in', now() - interval '10 minutes')`,
      [user],
    );
    await pool.query(
      `UPDATE event_config
          SET event_starts_at = NULL,
              event_ends_at = clock_timestamp() + interval '1 hour'
        WHERE id = 1`,
    );

    const eligibility = await a.inject({
      method: "GET",
      url: "/api/me/removal-eligibility",
      headers: asUser(user),
    });
    expect(eligibility.statusCode).toBe(200);
    expect(eligibility.json()).toMatchObject({
      action: "anonymize",
      activeEventConsequences: false,
      requiresVenueExit: true,
    });
  });

  it("accepts self-anonymization inside and completes it after a valid exit", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const presenceStaff = await createUserWithCapabilities([
      CAPABILITIES.PRESENCE_SCAN,
      CAPABILITIES.ACTIVITY_SCAN,
    ]);
    const user = await createUser({
      email: "inside-at-removal@example.test",
      emailVerified: false,
    });
    await addCredentialPassword(user);
    await pool.query(
      `UPDATE users
          SET badge_id = 'B-INSIDE',
              food_intolerances = ARRAY[7],
              food_intolerance_notes = 'Peanut',
              dietary_data_state = 'present'
        WHERE id = $1`,
      [user],
    );
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, check_in_method)
       VALUES ($1, 'B-INSIDE', 'scan')`,
      [user],
    );
    await pool.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at)
       VALUES ($1, 'in', now() - interval '15 minutes')`,
      [user],
    );

    const removal = await a.inject({
      method: "POST",
      url: "/api/me/anonymize",
      headers: { ...asUser(user), "idempotency-key": "inside-anonymize" },
      payload: { confirm: true, reauthenticationPassword: UNVERIFIED_TEST_PASSWORD },
    });

    expect(removal.statusCode).toBe(202);
    expect(removal.json()).toEqual({
      status: "pending_exit",
      pendingExit: true,
      accessRevoked: true,
    });
    expect(
      (
        await pool.query(`SELECT account_state, removal_requires_exit FROM users WHERE id = $1`, [
          user,
        ])
      ).rows,
    ).toEqual([{ account_state: "removal_pending", removal_requires_exit: true }]);
    // The pending-exit state is reversible until staff record the exit. Keep
    // dietary data available for safe event operations during that short
    // transition; finalization deletes it after the operational relationship
    // ends.
    expect(
      (
        await pool.query(
          `SELECT food_intolerances, food_intolerance_notes, dietary_data_state
             FROM users WHERE id = $1`,
          [user],
        )
      ).rows,
    ).toEqual([
      { food_intolerances: [7], food_intolerance_notes: "Peanut", dietary_data_state: "present" },
    ]);
    expect((await pool.query(`SELECT 1 FROM anonymous_participants`)).rowCount).toBe(0);

    const { rows: removalRows } = await pool.query(
      `SELECT removal_started_at FROM users WHERE id = $1`,
      [user],
    );
    const staleExit = await a.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: { ...asUser(presenceStaff), "idempotency-key": "inside-stale-exit" },
      payload: {
        badgeId: "B-INSIDE",
        kind: "out",
        scannedAt: new Date(removalRows[0].removal_started_at).getTime() - 1,
      },
    });
    expect(staleExit.statusCode).toBe(409);
    expect(staleExit.json().error.details.code).toBe("pending_exit_before_removal");

    const blockedEntry = await a.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: { ...asUser(presenceStaff), "idempotency-key": "inside-entry-after-request" },
      payload: { badgeId: "B-INSIDE", kind: "in" },
    });
    expect(blockedEntry.statusCode).toBe(409);
    expect(blockedEntry.json().error.code).toBe("badge_revoked");
    const { rows: activities } = await pool.query(
      `INSERT INTO activities (name, category, requires_scan)
       VALUES ('Meal after removal request', 'meal', true) RETURNING id`,
    );
    const blockedMeal = await a.inject({
      method: "POST",
      url: `/api/activities/${activities[0].id}/scan`,
      headers: { ...asUser(presenceStaff), "idempotency-key": "inside-meal-after-request" },
      payload: { badgeId: "B-INSIDE" },
    });
    expect(blockedMeal.statusCode).toBe(409);
    expect(blockedMeal.json().error.code).toBe("badge_revoked");

    const { rows: activitiesAfterRemoval } = await pool.query(
      `INSERT INTO activities (name, category, requires_scan)
       VALUES ('Workshop after removal request', 'workshop', true) RETURNING id`,
    );
    const blockedActivity = await a.inject({
      method: "POST",
      url: `/api/activities/${activitiesAfterRemoval[0].id}/scan`,
      headers: { ...asUser(presenceStaff), "idempotency-key": "inside-activity-after-request" },
      payload: { badgeId: "B-INSIDE" },
    });
    expect(blockedActivity.statusCode).toBe(409);
    expect(blockedActivity.json().error.code).toBe("badge_revoked");

    const exit = await a.inject({
      method: "POST",
      url: "/api/presence/scan",
      headers: { ...asUser(presenceStaff), "idempotency-key": "inside-exit" },
      payload: { badgeId: "B-INSIDE", kind: "out" },
    });
    expect(exit.statusCode).toBe(200);
    expect(exit.json()).toMatchObject({ kind: "out" });
    const { rows: exitIdempotency } = await pool.query(
      `SELECT response_body
         FROM idempotency_keys
        WHERE key = 'inside-exit' AND scope = $1`,
      [`POST /api/presence/scan u:${presenceStaff}`],
    );
    expect(exitIdempotency).toHaveLength(1);
    expect(exitIdempotency[0].response_body).not.toHaveProperty("userId");
    expect(JSON.stringify(exitIdempotency[0].response_body)).not.toContain(
      "inside-at-removal@example.test",
    );
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [user])).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM anonymous_participants`)).rowCount).toBe(1);

    const replay = await a.inject({
      method: "POST",
      url: "/api/me/anonymize",
      headers: { ...asUser(user), "idempotency-key": "inside-anonymize" },
      payload: { confirm: true, reauthenticationPassword: UNVERIFIED_TEST_PASSWORD },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
  });

  it("allows a pending-exit request to be cancelled before staff record the exit", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const user = await createUser({ email: "cancel-pending@example.test", emailVerified: false });
    await addCredentialPassword(user);
    await pool.query(
      `UPDATE users
          SET badge_id = 'B-CANCEL-PENDING',
              food_intolerances = ARRAY[7],
              food_intolerance_notes = 'Peanut',
              dietary_data_state = 'present'
        WHERE id = $1`,
      [user],
    );
    // Exercise the transactional pass issuance without requiring Apple
    // signing credentials in this identity-focused suite.
    const { ensurePassRecord } = await import("../../src/modules/logistics/wallet-passes.js");
    const firstPass = await ensurePassRecord(user, "badge", "apple");
    const { rows: issuedPasses } = await pool.query<{ id: number }>(
      `SELECT id FROM wallet_passes WHERE user_id = $1 AND purpose = 'badge' AND platform = 'apple'`,
      [user],
    );
    expect(issuedPasses).toHaveLength(1);
    const oldPassId = firstPass.id;
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, check_in_method)
       VALUES ($1, 'B-CANCEL-PENDING', 'scan')`,
      [user],
    );
    await pool.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at)
       VALUES ($1, 'in', now() - interval '5 minutes')`,
      [user],
    );

    const requested = await a.inject({
      method: "POST",
      url: "/api/me/anonymize",
      headers: { ...asUser(user), "idempotency-key": "cancel-pending-request" },
      payload: { confirm: true, reauthenticationPassword: UNVERIFIED_TEST_PASSWORD },
    });
    expect(requested.statusCode).toBe(202);
    expect(
      (await pool.query(`SELECT status FROM wallet_passes WHERE id = $1`, [oldPassId])).rows,
    ).toEqual([{ status: "voided" }]);

    const profile = await a.inject({ method: "GET", url: "/api/me", headers: asUser(user) });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({
      accountState: "removal_pending",
      mobileAccess: false,
      removal: { status: "pending_exit", action: "anonymize", canCancel: true },
    });

    const status = await a.inject({
      method: "GET",
      url: "/api/me/removal-status",
      headers: asUser(user),
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ status: "pending_exit", canCancel: true });

    const cancelled = await a.inject({
      method: "POST",
      url: "/api/me/anonymize/cancel",
      headers: { ...asUser(user), "idempotency-key": "cancel-pending-request" },
      payload: {},
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toEqual({ status: "cancelled" });

    // Cancellation never restores the old serial: a later issuance is a new
    // active row, while the already-installed pass remains revoked.
    const replacementPass = await ensurePassRecord(user, "badge", "apple");
    const { rows: passStates } = await pool.query<{ id: number; status: string }>(
      `SELECT id, status
         FROM wallet_passes
        WHERE user_id = $1 AND purpose = 'badge' AND platform = 'apple'
        ORDER BY id`,
      [user],
    );
    expect(passStates).toEqual([
      { id: oldPassId, status: "voided" },
      { id: expect.any(Number), status: "active" },
    ]);
    expect(passStates[1]!.id).toBe(replacementPass.id);
    expect(passStates[1]!.id).not.toBe(oldPassId);

    const replay = await a.inject({
      method: "POST",
      url: "/api/me/anonymize/cancel",
      headers: { ...asUser(user), "idempotency-key": "cancel-pending-request" },
      payload: {},
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(
      (
        await pool.query(
          `SELECT account_state, removal_action, removal_requires_exit, removal_expires_at,
                  food_intolerances, food_intolerance_notes
             FROM users WHERE id = $1`,
          [user],
        )
      ).rows,
    ).toEqual([
      {
        account_state: "active",
        removal_action: null,
        removal_requires_exit: false,
        removal_expires_at: null,
        food_intolerances: [7],
        food_intolerance_notes: "Peanut",
      },
    ]);
    expect(
      (
        await a.inject({ method: "GET", url: "/api/me/removal-status", headers: asUser(user) })
      ).json(),
    ).toEqual({ status: "active" });

    // A delayed retry from the cancelled request must not finalize a newer
    // pending request that has a different lifecycle key.
    const secondRequest = await a.inject({
      method: "POST",
      url: "/api/me/anonymize",
      headers: { ...asUser(user), "idempotency-key": "replacement-removal-request" },
      payload: { confirm: true, reauthenticationPassword: UNVERIFIED_TEST_PASSWORD },
    });
    expect(secondRequest.statusCode).toBe(202);
    const { processAccountRemovalRetry } = await import("../../src/modules/identity/removal.js");
    await processAccountRemovalRetry({
      data: {
        targetId: user,
        actorId: user,
        source: "self_service",
        requestedAction: "anonymize",
        preserveIdempotency: {
          key: "cancel-pending-request",
          scope: "POST /api/me/anonymize removal-complete",
          completionScope: "POST /api/me/anonymize removal-complete",
        },
        retryOnlyPending: true,
        walletPassIds: [oldPassId],
      },
    } as never);
    expect(
      (
        await pool.query(
          `SELECT account_state, removal_idempotency_key
             FROM users WHERE id = $1`,
          [user],
        )
      ).rows,
    ).toEqual([
      { account_state: "removal_pending", removal_idempotency_key: "replacement-removal-request" },
    ]);
  });

  it("rejects cancellation at the recovery deadline and leaves the pending state intact", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const user = await createUser({ email: "deadline-race@example.test", emailVerified: false });
    await pool.query(
      `UPDATE users
          SET badge_id = 'B-DEADLINE-RACE'
        WHERE id = $1`,
      [user],
    );
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, check_in_method)
       VALUES ($1, 'B-DEADLINE-RACE', 'scan')`,
      [user],
    );
    await pool.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at)
       VALUES ($1, 'in', now() - interval '5 minutes')`,
      [user],
    );
    // H54 rejects new identity-bearing rows once removal_pending starts. Seed
    // the operational history while the account is active, then move it to
    // the pending lifecycle state before racing the recovery deadline.
    await pool.query(
      `UPDATE users
          SET account_state = 'removal_pending',
              removal_action = 'anonymize',
              removal_requires_exit = true,
              removal_expires_at = clock_timestamp() + interval '1 millisecond',
              removal_idempotency_key = 'deadline-race-removal'
        WHERE id = $1`,
      [user],
    );
    // Let the deadline cross before the cancellation transaction reaches its
    // final guarded UPDATE predicate.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const cancelled = await a.inject({
      method: "POST",
      url: "/api/me/anonymize/cancel",
      headers: { ...asUser(user), "idempotency-key": "deadline-race-cancel" },
      payload: {},
    });
    expect(cancelled.statusCode).toBe(409);
    expect(cancelled.json().error.details.code).toBe("removal_expired");
    expect(
      (
        await pool.query(`SELECT account_state, removal_requires_exit FROM users WHERE id = $1`, [
          user,
        ])
      ).rows,
    ).toEqual([{ account_state: "removal_pending", removal_requires_exit: true }]);
  });

  it("does not let a target cancel an administrator-originated pending request", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const admin = await createUserWithCapabilities(["*"]);
    const target = await createUser({ email: "admin-pending-cancel@example.test" });
    await pool.query(`UPDATE users SET badge_id = 'B-ADMIN-PENDING' WHERE id = $1`, [target]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, check_in_method)
       VALUES ($1, 'B-ADMIN-PENDING', 'scan')`,
      [target],
    );
    await pool.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at)
       VALUES ($1, 'in', now() - interval '5 minutes')`,
      [target],
    );

    const requested = await a.inject({
      method: "POST",
      url: `/api/users/${target}/anonymize`,
      headers: { ...asUser(admin), "idempotency-key": "admin-pending-cancel" },
    });
    expect(requested.statusCode).toBe(202);

    const cancelled = await a.inject({
      method: "POST",
      url: "/api/me/anonymize/cancel",
      headers: { ...asUser(target), "idempotency-key": "target-admin-cancel" },
      payload: {},
    });
    expect(cancelled.statusCode).toBe(409);
    expect(cancelled.json().error.details.code).toBe("removal_not_cancellable");
    expect(
      (await pool.query(`SELECT account_state FROM users WHERE id = $1`, [target])).rows,
    ).toEqual([{ account_state: "removal_pending" }]);
  });

  it("self-anonymizes after venue exit, preserves verified minutes, revokes credentials, and replays safely", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const user = await createUser({
      name: "Self Anonymized Person",
      email: "self-anonymized@example.test",
      emailVerified: false,
    });
    await addCredentialPassword(user);
    await pool.query(
      `UPDATE users SET surname = 'Identity', dni = '12345678Z', badge_id = 'B-SELF-ANON' WHERE id = $1`,
      [user],
    );
    const { rows: universityRows } = await pool.query(
      `INSERT INTO universities (name, proposed_by) VALUES ('Universidade da Coruña', NULL) RETURNING id`,
    );
    await pool.query(
      `UPDATE users
          SET university_id = $2, food_intolerances = ARRAY[7], food_intolerance_notes = 'Peanut'
        WHERE id = $1`,
      [user, universityRows[0].id],
    );
    const demographicTemplate = [
      {
        key: "dob",
        kind: "date",
        label: { en: "Date of birth" },
        retention_mode: "anonymous_audit",
        anonymous_audit_dimension: "age",
      },
      {
        key: "gender",
        kind: "select",
        label: { en: "Gender" },
        retention_mode: "anonymous_audit",
        anonymous_audit_dimension: "gender",
      },
      {
        key: "degree",
        kind: "text",
        label: { en: "Degree" },
        retention_mode: "anonymous_audit",
        anonymous_audit_dimension: "degree",
      },
      {
        key: "graduation_year",
        kind: "number",
        label: { en: "Graduation year" },
        retention_mode: "anonymous_audit",
        anonymous_audit_dimension: "graduation_year",
      },
      {
        key: "origin_city",
        kind: "text",
        label: { en: "Origin city" },
        retention_mode: "anonymous_audit",
        anonymous_audit_dimension: "origin_city",
      },
      {
        key: "university",
        kind: "university",
        label: { en: "University" },
        retention_mode: "anonymous_audit",
        anonymous_audit_dimension: "university",
      },
    ];
    const { rows: applicationRows } = await pool.query(
      `INSERT INTO applications (name, type, template)
       VALUES ('Demographic extraction', 'participant', $1::jsonb) RETURNING id`,
      [JSON.stringify(demographicTemplate)],
    );
    const formVersionId = await ensureApplicationFormVersion(applicationRows[0].id);
    await pool.query(
      `INSERT INTO application_responses
         (user_id, application_id, application_form_version_id, status, responses)
       VALUES ($1, $2, $3, 'accepted', $4::jsonb)`,
      [
        user,
        applicationRows[0].id,
        formVersionId,
        JSON.stringify({
          dob: "2000-01-01",
          gender: "nonbinary",
          degree: "Computer Science",
          graduation_year: 2024,
          origin_city: "A Coruña",
          university: universityRows[0].id,
        }),
      ],
    );
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, check_in_method)
       VALUES ($1, 'B-SELF-ANON', 'scan')`,
      [user],
    );
    await pool.query(
      `INSERT INTO time_logs (user_id, kind, scanned_at)
       VALUES ($1, 'in', now() - interval '2 hours'),
              ($1, 'out', now() - interval '1 hour')`,
      [user],
    );
    await pool.query(
      `INSERT INTO accounts (user_id, account_id, provider_id, refresh_token)
       VALUES ($1, 'self-account', 'credentials', 'refresh-secret')`,
      [user],
    );
    await pool.query(
      `INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, 'session-secret', now() + interval '1 day')`,
      [user],
    );
    await pool.query(
      `INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, 'push-secret', 'ios')`,
      [user],
    );
    await pool.query(`INSERT INTO tickets (user_id, token) VALUES ($1, 'ticket-secret')`, [user]);

    const eligibility = await a.inject({
      method: "GET",
      url: "/api/me/removal-eligibility",
      headers: asUser(user),
    });
    expect(eligibility.statusCode).toBe(200);
    expect(eligibility.json()).toMatchObject({
      action: "anonymize",
      operationalHistoryRetained: true,
      requiresVenueExit: false,
    });

    const headers = { ...asUser(user), "idempotency-key": "self-anonymize-replay" };
    const removed = await a.inject({
      method: "POST",
      url: "/api/me/anonymize",
      headers,
      payload: { confirm: true, reauthenticationPassword: UNVERIFIED_TEST_PASSWORD },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().anonymized).toBe(true);

    const replay = await a.inject({
      method: "POST",
      url: "/api/me/anonymize",
      headers,
      payload: { confirm: true, reauthenticationPassword: UNVERIFIED_TEST_PASSWORD },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");

    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [user])).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM accounts WHERE user_id = $1`, [user])).rowCount).toBe(
      0,
    );
    expect((await pool.query(`SELECT 1 FROM sessions WHERE user_id = $1`, [user])).rowCount).toBe(
      0,
    );
    expect(
      (await pool.query(`SELECT 1 FROM push_tokens WHERE user_id = $1`, [user])).rowCount,
    ).toBe(0);
    expect((await pool.query(`SELECT 1 FROM tickets WHERE user_id = $1`, [user])).rowCount).toBe(0);

    const { rows: anonymous } = await pool.query(
      `SELECT id, guaranteed_presence_minutes FROM anonymous_participants`,
    );
    expect(anonymous).toHaveLength(1);
    expect(anonymous[0].id).not.toBe(String(user));
    const { rows: anonymousFields } = await pool.query(
      `SELECT field_key, anonymous_audit_dimension, field_kind, value
         FROM anonymous_participant_fields
        WHERE anonymous_participant_id = $1
        ORDER BY field_key`,
      [anonymous[0].id],
    );
    expect(anonymousFields).toEqual([
      {
        field_key: "degree",
        anonymous_audit_dimension: "degree",
        field_kind: "text",
        value: "Computer Science",
      },
      {
        field_key: "dob",
        anonymous_audit_dimension: "age",
        field_kind: "date",
        value: new Date().getUTCFullYear() - 2000,
      },
      {
        field_key: "gender",
        anonymous_audit_dimension: "gender",
        field_kind: "select",
        value: "nonbinary",
      },
      {
        field_key: "graduation_year",
        anonymous_audit_dimension: "graduation_year",
        field_kind: "number",
        value: 2024,
      },
      {
        field_key: "origin_city",
        anonymous_audit_dimension: "origin_city",
        field_kind: "text",
        value: "A Coruña",
      },
      {
        field_key: "university",
        anonymous_audit_dimension: "university",
        field_kind: "university",
        value: "Universidade da Coruña",
      },
    ]);
    expect(anonymous[0].guaranteed_presence_minutes).toBe(60);
    expect(JSON.stringify(anonymous[0])).not.toContain("Peanut");
    expect(
      (
        await pool.query(
          `SELECT 1 FROM check_in_logs WHERE user_id = $1 OR staff_id = $1 OR badge_id = 'B-SELF-ANON'`,
          [user],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (await pool.query(`SELECT 1 FROM time_logs WHERE user_id = $1 OR scanned_by = $1`, [user]))
        .rowCount,
    ).toBe(0);
    // Raw presence rows are not a permanent anonymous audit dataset. The
    // aggregate above is calculated before these rows are deleted.
    expect(
      (await pool.query(`SELECT 1 FROM check_in_logs WHERE user_id = $1`, [user])).rowCount,
    ).toBe(0);
    expect((await pool.query(`SELECT 1 FROM time_logs WHERE user_id = $1`, [user])).rowCount).toBe(
      0,
    );
  });

  it("uses the submitted form version for arbitrary anonymous retention and never expands it retroactively", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const admin = await createUserWithCapabilities(["*"]);
    const target = await createUser({
      name: "Versioned Participant",
      email: "versioned-participant@example.test",
    });
    const templateV1 = [
      {
        key: "cohort_answer",
        kind: "text",
        label: { en: "Old cohort label", es: "Etiqueta antiga", gl: "Etiqueta antiga" },
        retention_mode: "none",
      },
      {
        key: "custom_audit_answer",
        kind: "text",
        label: { en: "Old custom label", es: "Etiqueta", gl: "Etiqueta" },
        retention_mode: "anonymous_audit",
        anonymous_audit_dimension: "custom.cohort",
      },
      {
        key: "missing_audit_answer",
        kind: "number",
        label: { en: "Missing", es: "Falta", gl: "Falta" },
        retention_mode: "anonymous_audit",
        anonymous_audit_dimension: "custom.missing",
      },
    ];
    const { rows: applications } = await pool.query(
      `INSERT INTO applications (name, type, template)
       VALUES ('Versioned retention form', 'participant', $1::jsonb) RETURNING id`,
      [JSON.stringify(templateV1)],
    );
    const applicationId = applications[0].id as number;
    const formVersionId = await ensureApplicationFormVersion(applicationId);
    await pool.query(
      `INSERT INTO application_responses
         (user_id, application_id, application_form_version_id, status, responses)
       VALUES ($1, $2, $3, 'accepted', $4::jsonb)`,
      [
        target,
        applicationId,
        formVersionId,
        JSON.stringify({
          cohort_answer: "identity-shaped@example.test",
          custom_audit_answer: "blue",
        }),
      ],
    );
    const draftTemplate = [
      {
        key: "draft_only_audit",
        kind: "text",
        label: { en: "Draft only", es: "Borrador", gl: "Borrador" },
        retention_mode: "anonymous_audit",
        anonymous_audit_dimension: "draft.only",
      },
    ];
    const { rows: draftApplications } = await pool.query(
      `INSERT INTO applications (name, type, template)
       VALUES ('Draft retention form', 'participant', $1::jsonb) RETURNING id`,
      [JSON.stringify(draftTemplate)],
    );
    const draftVersionId = await ensureApplicationFormVersion(draftApplications[0].id);
    await pool.query(
      `INSERT INTO application_responses
         (user_id, application_id, application_form_version_id, status, responses)
       VALUES ($1, $2, $3, 'draft', $4::jsonb)`,
      [
        target,
        draftApplications[0].id,
        draftVersionId,
        JSON.stringify({ draft_only_audit: "must-not-survive" }),
      ],
    );
    await pool.query(`INSERT INTO check_in_logs (user_id, badge_id) VALUES ($1, 'B-VERSIONED')`, [
      target,
    ]);

    const templateV2 = templateV1.map((field) =>
      field.key === "cohort_answer"
        ? {
            ...field,
            label: { en: "Renamed cohort label", es: "Renombrada", gl: "Renomeada" },
            retention_mode: "anonymous_audit" as const,
            anonymous_audit_dimension: "custom.new-purpose",
          }
        : field,
    );
    const changed = await a.inject({
      method: "PATCH",
      url: `/api/applications/${applicationId}`,
      headers: asUser(admin),
      payload: { template: templateV2 },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().current_form_version).toBe(2);

    const removed = await a.inject({
      method: "POST",
      url: `/api/users/${target}/anonymize`,
      headers: asUser(admin),
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().anonymized).toBe(true);

    const { rows: fields } = await pool.query(
      `SELECT application_id, application_form_version, field_key,
              anonymous_audit_dimension, field_kind, value
         FROM anonymous_participant_fields`,
    );
    expect(fields).toEqual([
      {
        application_id: applicationId,
        application_form_version: 1,
        field_key: "custom_audit_answer",
        anonymous_audit_dimension: "custom.cohort",
        field_kind: "text",
        value: "blue",
      },
    ]);
    expect(
      (await pool.query(`SELECT 1 FROM application_responses WHERE user_id = $1`, [target]))
        .rowCount,
    ).toBe(0);
    expect(JSON.stringify(fields)).not.toContain("identity-shaped@example.test");
    expect(JSON.stringify(fields)).not.toContain(String(target));
  });

  it("keeps explicit retention independent between application forms", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const admin = await createUserWithCapabilities(["*"]);
    const target = await createUser({ email: "multi-form-participant@example.test" });
    const templateA = [
      {
        key: "track",
        kind: "text",
        label: { en: "Track", es: "Track", gl: "Track" },
        retention_mode: "anonymous_audit",
        anonymous_audit_dimension: "event.track",
      },
    ];
    const templateB = [
      {
        key: "cohort",
        kind: "text",
        label: { en: "Cohort", es: "Cohorte", gl: "Cohorte" },
        retention_mode: "anonymous_audit",
        anonymous_audit_dimension: "event.cohort",
      },
    ];
    const { rows: formA } = await pool.query(
      `INSERT INTO applications (name, type, template)
       VALUES ('Form A', 'participant', $1::jsonb) RETURNING id`,
      [JSON.stringify(templateA)],
    );
    const { rows: formB } = await pool.query(
      `INSERT INTO applications (name, type, template)
       VALUES ('Form B', 'participant', $1::jsonb) RETURNING id`,
      [JSON.stringify(templateB)],
    );
    const versionA = await ensureApplicationFormVersion(formA[0].id);
    const versionB = await ensureApplicationFormVersion(formB[0].id);
    await pool.query(
      `INSERT INTO application_responses
         (user_id, application_id, application_form_version_id, status, responses)
       VALUES ($1, $2, $3, 'accepted', $4::jsonb),
              ($1, $5, $6, 'accepted', $7::jsonb)`,
      [
        target,
        formA[0].id,
        versionA,
        JSON.stringify({ track: "red" }),
        formB[0].id,
        versionB,
        JSON.stringify({ cohort: "late" }),
      ],
    );
    await pool.query(`INSERT INTO check_in_logs (user_id, badge_id) VALUES ($1, 'B-MULTI-FORM')`, [
      target,
    ]);

    const removed = await a.inject({
      method: "POST",
      url: `/api/users/${target}/anonymize`,
      headers: asUser(admin),
    });
    expect(removed.statusCode).toBe(200);
    const { rows: fields } = await pool.query(
      `SELECT application_id, field_key, anonymous_audit_dimension, value
         FROM anonymous_participant_fields ORDER BY application_id`,
    );
    expect(fields).toEqual([
      {
        application_id: formA[0].id,
        field_key: "track",
        anonymous_audit_dimension: "event.track",
        value: "red",
      },
      {
        application_id: formB[0].id,
        field_key: "cohort",
        anonymous_audit_dimension: "event.cohort",
        value: "late",
      },
    ]);
  });

  it("serializes a deletion racing the first accreditation write (H54)", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const staff = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
    const target = await createUser({
      email: "race-before-accreditation@example.test",
      emailVerified: false,
    });
    await addCredentialPassword(target);
    await pool.query(`INSERT INTO tickets (user_id, token) VALUES ($1, 'race-ticket')`, [target]);

    const [removal, checkIn] = await Promise.all([
      a.inject({
        method: "DELETE",
        url: "/api/me",
        headers: { ...asUser(target), "idempotency-key": "race-delete" },
        payload: { reauthenticationPassword: UNVERIFIED_TEST_PASSWORD },
      }),
      a.inject({
        method: "POST",
        url: "/api/accreditation/check-in",
        headers: { ...asUser(staff), "idempotency-key": "race-check-in" },
        payload: { ticketToken: "race-ticket", badgeId: "RACE-BADGE" },
      }),
    ]);

    // Exactly one side may win the user-row lock. A deleted account cannot
    // receive a late check-in, and a committed check-in makes hard deletion
    // ineligible; both outcomes remain internally coherent.
    expect(
      removal.statusCode === 200 || (removal.statusCode === 409 && checkIn.statusCode === 200),
    ).toBe(true);
    if (removal.statusCode === 200) {
      expect(removal.json().deleted).toBe(true);
      expect(checkIn.statusCode).not.toBe(200);
      expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [target])).rowCount).toBe(0);
      expect(
        (await pool.query(`SELECT 1 FROM check_in_logs WHERE user_id = $1`, [target])).rowCount,
      ).toBe(0);
    } else {
      expect(checkIn.json().badgeId).toBe("RACE-BADGE");
      expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [target])).rowCount).toBe(1);
      expect(
        (await pool.query(`SELECT 1 FROM check_in_logs WHERE user_id = $1`, [target])).rowCount,
      ).toBe(1);
    }
  });

  it("severs a sponsor identity without deleting a challenge author anchor", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const admin = await createUserWithCapabilities(["*"]);
    const sponsorUser = await createUser({ name: "Sponsor Contact" });
    const { rows: enterprise } = await pool.query(
      `INSERT INTO enterprises (name) VALUES ('Removal Anchor Co') RETURNING id`,
    );
    const { rows: sponsor } = await pool.query(
      `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
      [enterprise[0].id, sponsorUser],
    );
    const { rows: challenge } = await pool.query(
      `INSERT INTO challenges (author, title) VALUES ($1, 'Keep this challenge') RETURNING id`,
      [sponsor[0].id],
    );
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id) VALUES ($1, 'B-SPONSOR', $2)`,
      [sponsorUser, admin],
    );

    const removed = await a.inject({
      method: "POST",
      url: `/api/users/${sponsorUser}/anonymize`,
      headers: asUser(admin),
    });

    expect(removed.statusCode).toBe(200);
    expect(
      (await pool.query(`SELECT user_id FROM sponsors WHERE id = $1`, [sponsor[0].id])).rows,
    ).toEqual([{ user_id: null }]);
    expect(
      (await pool.query(`SELECT id FROM challenges WHERE id = $1`, [challenge[0].id])).rowCount,
    ).toBe(1);
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [sponsorUser])).rowCount).toBe(0);
  });
});

describe("PATCH /api/me (H7)", () => {
  it("updates own restricted fields (A: food/shirt are staff-only now)", async () => {
    const a = await getApp();
    const userId = await createUser();
    // shirtSize was removed from self-edit — it's staff-only now.
    const res = await a.inject({
      method: "PATCH",
      url: "/api/me",
      headers: asUser(userId),
      payload: { language: "gl" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().language).toBe("gl");
  });

  it("staff can still edit food/shirt via PATCH /api/users/:id", async () => {
    const a = await getApp();
    const userId = await createUser();
    const staff = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);

    const res = await a.inject({
      method: "PATCH",
      url: `/api/users/${userId}`,
      headers: asUser(staff),
      payload: { shirtSize: "L", foodIntolerances: [1, 2] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().shirtSize).toBe("L");
    expect(res.json().foodIntolerances).toEqual([1, 2]);
  });

  it("self-edit of food/shirt/dietary notes is allowed (a participant owns their logistics data)", async () => {
    const a = await getApp();
    const userId = await createUser();
    const res = await a.inject({
      method: "PATCH",
      url: "/api/me",
      headers: asUser(userId),
      payload: { shirtSize: "L", foodIntolerances: [1, 2], foodIntoleranceNotes: "no nuts" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().shirtSize).toBe("L");
    expect(res.json().foodIntolerances).toEqual([1, 2]);
    expect(res.json().foodIntoleranceNotes).toBe("no nuts");
    expect(res.json().dietaryDataState).toBe("present");

    const cleared = await a.inject({
      method: "PATCH",
      url: "/api/me",
      headers: asUser(userId),
      payload: { foodIntolerances: [], foodIntoleranceNotes: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().dietaryDataState).toBe("not_provided");
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

  it("GET /api/users/:id includes role, capabilities and roles", async () => {
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
    expect(Array.isArray(res.json().roles)).toBe(true);
    expect(res.json().roles[0]).toMatchObject({
      id: expect.any(Number),
      name: expect.any(String),
      position: expect.any(Number),
      isVisible: expect.any(Boolean),
    });
  });

  it("strips system:superadmin out of another user's role list unless the viewer holds PERMISSIONS_MANAGE (H8)", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const { createRole, assignRole } = await import("../helpers.js");
    const superadminRoleId = await createRole([CAPABILITIES.ADMIN_ALL], {
      name: "system:superadmin",
      isProtected: true,
    });
    await pool.query(`UPDATE roles SET position = 999999999 WHERE id = $1`, [superadminRoleId]);
    const target = await createUser();
    await assignRole(target, superadminRoleId);

    const plainReader = await createUserWithCapabilities([CAPABILITIES.USERS_READ]);
    const asPlainReader = await a.inject({
      method: "GET",
      url: `/api/users/${target}`,
      headers: asUser(plainReader),
    });
    expect(asPlainReader.statusCode).toBe(200);
    expect(
      asPlainReader.json().roles.some((r: { name: string }) => r.name === "system:superadmin"),
    ).toBe(false);

    const permissionsManager = await createUserWithCapabilities([
      CAPABILITIES.USERS_READ,
      CAPABILITIES.PERMISSIONS_MANAGE,
    ]);
    const asManager = await a.inject({
      method: "GET",
      url: `/api/users/${target}`,
      headers: asUser(permissionsManager),
    });
    expect(asManager.statusCode).toBe(200);
    expect(
      asManager.json().roles.some((r: { name: string }) => r.name === "system:superadmin"),
    ).toBe(true);
  });

  it("DELETE /api/users/:id — superadmin only, blocks self, removes a fresh account", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities(["*"]);
    const staff = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
    const victim = await createUser({ name: "Deletable" });

    // Even USERS_WRITE isn't enough — only ADMIN_ALL.
    expect(
      (await a.inject({ method: "DELETE", url: `/api/users/${victim}`, headers: asUser(staff) }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await a.inject({
          method: "GET",
          url: `/api/users/${victim}/removal-eligibility`,
          headers: asUser(staff),
        })
      ).statusCode,
    ).toBe(403);
    // Can't delete yourself.
    expect(
      (await a.inject({ method: "DELETE", url: `/api/users/${admin}`, headers: asUser(admin) }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await a.inject({
          method: "GET",
          url: `/api/users/${admin}/removal-eligibility`,
          headers: asUser(admin),
        })
      ).statusCode,
    ).toBe(400);
    const eligibility = await a.inject({
      method: "GET",
      url: `/api/users/${victim}/removal-eligibility`,
      headers: asUser(admin),
    });
    expect(eligibility.statusCode).toBe(200);
    expect(eligibility.json()).toMatchObject({
      action: "delete",
      reasonCode: "fresh_account",
      accessRevoked: true,
      operationalHistoryRetained: false,
      activeEventConsequences: false,
      requiresVenueExit: false,
    });
    // Admin removes a fresh account.
    const ok = await a.inject({
      method: "DELETE",
      url: `/api/users/${victim}`,
      headers: asUser(admin),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().deleted).toBe(true);
    expect(
      (await a.inject({ method: "GET", url: `/api/users/${victim}`, headers: asUser(admin) }))
        .statusCode,
    ).toBe(404);
  });

  it("keeps eligibility and mutation aligned for historically referenced accounts (H54)", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const target = await createUser({ name: "Historically Referenced" });
    const { rows: applications } = await pool.query(
      `INSERT INTO applications (name, type, template)
       VALUES ('Participants', 'participant', '[]'::jsonb) RETURNING id`,
    );
    const formVersionId = await ensureApplicationFormVersion(applications[0].id);
    await pool.query(
      `INSERT INTO application_responses
         (user_id, application_id, application_form_version_id, status, responses)
       VALUES ($1, $2, $3, 'accepted', '{}'::jsonb)`,
      [target, applications[0].id, formVersionId],
    );
    // Accreditation at check-in is the real operational history — not the
    // ticket itself (a confirmed-but-not-yet-accredited holder can still
    // self-delete), and not the application row, which a never-accepted
    // applicant can clean up on their own (H54, unaccepted participants
    // delete cleanly).
    await pool.query(`INSERT INTO tickets (user_id, token) VALUES ($1, 'tok-historic')`, [target]);
    await pool.query(`UPDATE users SET badge_id = 'B-HISTORIC' WHERE id = $1`, [target]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id) VALUES ($1, 'B-HISTORIC', $2)`,
      [target, admin],
    );

    const eligibility = await a.inject({
      method: "GET",
      url: `/api/users/${target}/removal-eligibility`,
      headers: asUser(admin),
    });
    expect(eligibility.statusCode).toBe(200);
    expect(eligibility.json()).toMatchObject({
      action: "anonymize",
      reasonCode: "operational_history",
      accessRevoked: true,
      operationalHistoryRetained: true,
      requiresVenueExit: false,
    });

    const rejectedDelete = await a.inject({
      method: "DELETE",
      url: `/api/users/${target}`,
      headers: asUser(admin),
    });
    expect(rejectedDelete.statusCode).toBe(409);
    expect(rejectedDelete.json().error.details.reasonCode).toBe("operational_history");

    const anonymized = await a.inject({
      method: "POST",
      url: `/api/users/${target}/anonymize`,
      headers: asUser(admin),
    });
    expect(anonymized.statusCode).toBe(200);
    expect(anonymized.json().anonymized).toBe(true);
    expect(
      (await pool.query(`SELECT 1 FROM application_responses WHERE user_id = $1`, [target]))
        .rowCount,
    ).toBe(0);
  });

  it("hard-deletes an unaccepted applicant, cascading their own application data (H54)", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const admin = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const target = await createUser({ name: "Never Accepted" });
    const { rows: applications } = await pool.query(
      `INSERT INTO applications (name, type, template)
       VALUES ('Participants', 'participant', '[]'::jsonb) RETURNING id`,
    );
    const formVersionId = await ensureApplicationFormVersion(applications[0].id);
    const { rows: responseRows } = await pool.query(
      `INSERT INTO application_responses
         (user_id, application_id, application_form_version_id, status, responses)
       VALUES ($1, $2, $3, 'rejected', '{}'::jsonb) RETURNING id`,
      [target, applications[0].id, formVersionId],
    );
    await pool.query(
      `INSERT INTO applicant_reviews (response_id, author_id, score) VALUES ($1, $2, 50)`,
      [responseRows[0].id, admin],
    );

    const eligibility = await a.inject({
      method: "GET",
      url: `/api/users/${target}/removal-eligibility`,
      headers: asUser(admin),
    });
    expect(eligibility.statusCode).toBe(200);
    expect(eligibility.json().action).toBe("delete");

    const deleted = await a.inject({
      method: "DELETE",
      url: `/api/users/${target}`,
      headers: asUser(admin),
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deleted).toBe(true);
    expect(
      (await pool.query(`SELECT 1 FROM application_responses WHERE user_id = $1`, [target]))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query(`SELECT 1 FROM applicant_reviews WHERE response_id = $1`, [
          responseRows[0].id,
        ])
      ).rowCount,
    ).toBe(0);
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

  it("PATCH /api/users/:id/email — USERS_WRITE updates primary email, rejects collisions, audited (M5.1)", async () => {
    const a = await getApp();
    const editor = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
    const reader = await createUserWithCapabilities([CAPABILITIES.USERS_READ]);
    const target = await createUser({ email: "old@example.test" });
    const other = await createUser({ email: "taken@example.test" });
    const { pool } = await import("../../src/db/pool.js");
    const oldRepo = await pool.query(
      `INSERT INTO repos (name) VALUES ('Old primary') RETURNING id`,
    );
    const repo = await pool.query(
      `INSERT INTO repos (name) VALUES ('Primary reconciliation') RETURNING id`,
    );
    const repoId = repo.rows[0].id;
    await pool.query(
      `INSERT INTO devpost_participants (repo_id, email, import_batch, merge_status)
       VALUES ($1, 'old@example.test', 'test-import', 'auto_matched'),
              ($2, 'new@example.test', 'test-import', 'unmatched')`,
      [oldRepo.rows[0].id, repoId],
    );
    await pool.query(`UPDATE devpost_participants SET user_id = $2 WHERE repo_id = $1`, [
      oldRepo.rows[0].id,
      target,
    ]);
    await pool.query(
      `INSERT INTO submissions (repo_id, user_id, imported_from) VALUES ($1, $2, 'devpost')`,
      [oldRepo.rows[0].id, target],
    );

    // Needs USERS_WRITE.
    expect(
      (
        await a.inject({
          method: "PATCH",
          url: `/api/users/${target}/email`,
          headers: asUser(reader),
          payload: { email: "new@example.test" },
        })
      ).statusCode,
    ).toBe(403);

    // Can't take another account's primary email.
    expect(
      (
        await a.inject({
          method: "PATCH",
          url: `/api/users/${target}/email`,
          headers: asUser(editor),
          payload: { email: "taken@example.test" },
        })
      ).statusCode,
    ).toBe(409);

    // Happy path: updates the column (lower-cased) and marks it verified.
    const ok = await a.inject({
      method: "PATCH",
      url: `/api/users/${target}/email`,
      headers: asUser(editor),
      payload: { email: "New@Example.test" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().email).toBe("new@example.test");
    expect(ok.json().emailVerified).toBe(true);

    const { rows } = await pool.query(
      `SELECT before, after FROM audit_log
         WHERE entity_type = 'user' AND entity_id = $1 AND action = 'primary_email_changed'`,
      [String(target)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].before.email).toBe("old@example.test");
    expect(rows[0].after.email).toBe("new@example.test");
    const reconciled = await pool.query(
      `SELECT user_id, merge_status FROM devpost_participants WHERE repo_id = $1`,
      [repoId],
    );
    expect(reconciled.rows).toEqual([{ user_id: target, merge_status: "auto_matched" }]);
    const oldReconciled = await pool.query(
      `SELECT user_id, merge_status FROM devpost_participants WHERE repo_id = $1`,
      [oldRepo.rows[0].id],
    );
    expect(oldReconciled.rows).toEqual([{ user_id: null, merge_status: "unmatched" }]);
    const oldSubmission = await pool.query(
      `SELECT 1 FROM submissions WHERE repo_id = $1 AND user_id = $2`,
      [oldRepo.rows[0].id, target],
    );
    expect(oldSubmission.rows).toHaveLength(0);
    void other;
  });

  it("H7: locks own name/surname/shirt size/dietary info once an application is accepted; staff can still fix it", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const user = await createUser({ name: "Ada" });
    const editor = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);

    const { rows: appRows } = await pool.query(
      `INSERT INTO applications (name, type, template, description, active, confirmation_window_hours)
       VALUES ('F', 'participant', '[]'::jsonb, '', true, 168) RETURNING id`,
    );
    const appId = appRows[0].id;
    const formVersionId = await ensureApplicationFormVersion(appId);

    // While still in review, the participant may edit their own name.
    await pool.query(
      `INSERT INTO application_responses
         (user_id, application_id, application_form_version_id, status, responses)
       VALUES ($1, $2, $3, 'review', '{}'::jsonb)`,
      [user, appId, formVersionId],
    );
    expect(
      (
        await a.inject({
          method: "PATCH",
          url: "/api/me",
          headers: asUser(user),
          payload: { name: "Ada Lovelace" },
        })
      ).statusCode,
    ).toBe(200);

    // Once accepted, self-edits of name/surname are locked (409 profile_locked)…
    await pool.query(`UPDATE application_responses SET status = 'accepted' WHERE user_id = $1`, [
      user,
    ]);
    const locked = await a.inject({
      method: "PATCH",
      url: "/api/me",
      headers: asUser(user),
      payload: { surname: "Byron" },
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.details.code).toBe("profile_locked");

    // …and so are shirt size and dietary info.
    const lockedShirt = await a.inject({
      method: "PATCH",
      url: "/api/me",
      headers: asUser(user),
      payload: { shirtSize: "M" },
    });
    expect(lockedShirt.statusCode).toBe(409);
    expect(lockedShirt.json().error.details.code).toBe("profile_locked");
    const lockedDietary = await a.inject({
      method: "PATCH",
      url: "/api/me",
      headers: asUser(user),
      payload: { foodIntoleranceNotes: "no nuts" },
    });
    expect(lockedDietary.statusCode).toBe(409);
    expect(lockedDietary.json().error.details.code).toBe("profile_locked");

    // …but non-locked fields still work, and staff can still change locked ones.
    expect(
      (
        await a.inject({
          method: "PATCH",
          url: "/api/me",
          headers: asUser(user),
          payload: { language: "en" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await a.inject({
          method: "PATCH",
          url: `/api/users/${user}`,
          headers: asUser(editor),
          payload: { surname: "Byron", shirtSize: "M" },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("POST /api/users/:id/anonymize — scrubs PII, revokes access, blocks self, ADMIN_ALL (M5.3/H54)", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities(["*"]);
    const staff = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
    const target = await createUserWithCapabilities([CAPABILITIES.USERS_READ]);

    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE users
       SET email = 'person@example.test', name = 'Real Person', surname = 'Doe', dni = '00000000T'
       WHERE id = $1`,
      [target],
    );
    await pool.query(`UPDATE users SET badge_id = 'B-ADMIN-ANON' WHERE id = $1`, [target]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id) VALUES ($1, 'B-ADMIN-ANON', $2)`,
      [target, admin],
    );
    // Devpost audit producers historically encoded the participant email in
    // a composite entity_id rather than in JSON. That indirect copy must not
    // survive the identity break either (H54).
    await pool.query(
      `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, source)
       VALUES ($1, 'devpost_repo', 'repo:person@example.test', 'participant_import', 'devpost')`,
      [admin],
    );
    const { rows: repoRows } = await pool.query(
      `INSERT INTO repos (name) VALUES ('Anonymized member audit fixture') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO submissions (repo_id, user_id, imported_from)
       VALUES ($1, $2, 'manual')`,
      [repoRows[0].id, target],
    );
    await pool.query(
      `INSERT INTO audit_log (actor_id, entity_type, entity_id, action, source)
       VALUES ($1, 'submission', $2, 'member_added', 'admin')`,
      [admin, `${repoRows[0].id}:${target}`],
    );

    // USERS_WRITE isn't enough — needs ADMIN_ALL.
    expect(
      (
        await a.inject({
          method: "POST",
          url: `/api/users/${target}/anonymize`,
          headers: asUser(staff),
        })
      ).statusCode,
    ).toBe(403);
    // Can't anonymize yourself.
    expect(
      (
        await a.inject({
          method: "POST",
          url: `/api/users/${admin}/anonymize`,
          headers: asUser(admin),
        })
      ).statusCode,
    ).toBe(400);

    const ok = await a.inject({
      method: "POST",
      url: `/api/users/${target}/anonymize`,
      headers: { ...asUser(admin), "idempotency-key": "admin-anonymize-scrub" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().anonymized).toBe(true);

    const { rows } = await pool.query(
      `SELECT email, name, surname, dni, email_verified, anonymized_at FROM users WHERE id = $1`,
      [target],
    );
    expect(rows).toHaveLength(0);
    const { rows: anonymousRows } = await pool.query(
      `SELECT id, guaranteed_presence_minutes FROM anonymous_participants`,
    );
    expect(anonymousRows).toHaveLength(1);
    expect(anonymousRows[0].id).not.toBe(String(target));
    expect(anonymousRows[0].guaranteed_presence_minutes).toBe(0);
    expect(
      (await pool.query(`SELECT 1 FROM check_in_logs WHERE user_id = $1`, [target])).rowCount,
    ).toBe(0);

    const { getEffectiveCapabilities, userHasCapability } = await import(
      "../../src/lib/capabilities.js"
    );
    expect(await getEffectiveCapabilities(target)).toEqual(new Set());
    expect(await userHasCapability(target, CAPABILITIES.USERS_READ)).toBe(false);

    // The audit trail for the anonymize action must not retain the very PII
    // it was supposed to scrub.
    const auditRows = await pool.query(
      `SELECT before, after FROM audit_log WHERE entity_type = 'anonymous_participant' AND action = 'anonymized'`,
    );
    expect(auditRows.rows).toHaveLength(1);
    expect(JSON.stringify(auditRows.rows[0].before ?? "")).not.toContain("person@example.test");
    expect(JSON.stringify(auditRows.rows[0].after ?? "")).not.toContain("person@example.test");
    expect(
      (await pool.query(`SELECT 1 FROM audit_log WHERE entity_id ILIKE '%person@example.test%'`))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query(
          `SELECT 1 FROM audit_log WHERE entity_type = 'submission' AND entity_id = $1`,
          [`${repoRows[0].id}:${target}`],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query(
          `SELECT 1 FROM idempotency_keys
             WHERE key = 'admin-anonymize-scrub'
                OR scope LIKE $1
                OR scope LIKE $2`,
          [`%/api/users/${target} %`, `%/api/users/${target}/anonymize %`],
        )
      ).rowCount,
    ).toBe(0);

    // The retained anonymous row exposes only the audit fields. An original
    // email, name, or numeric user id must not be searchable through normal
    // database relationships after the users row is gone.
    const identitySearch = await pool.query(
      `SELECT ap.id
         FROM anonymous_participants ap
         LEFT JOIN anonymous_participant_fields apf
           ON apf.anonymous_participant_id = ap.id
        WHERE ap.id::text = $1
           OR coalesce(apf.value::text, '') ILIKE ANY($2::text[])`,
      [String(target), ["%person@example.test%", "%Real Person%", `%${target}%`]],
    );
    expect(identitySearch.rows).toHaveLength(0);
  });

  it("uses historical emails when scrubbing detached denormalized identities (H54)", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities(["*"]);
    const target = await createUser({ email: "historical-old@example.test" });
    const { pool } = await import("../../src/db/pool.js");
    const { rows: repoRows } = await pool.query(
      `INSERT INTO repos (name) VALUES ('Historical email fixture') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO devpost_participants (repo_id, email, import_batch, merge_status)
       VALUES ($1, 'historical-old@example.test', 'test-import', 'unmatched')`,
      [repoRows[0].id],
    );

    const changed = await a.inject({
      method: "PATCH",
      url: `/api/users/${target}/email`,
      headers: asUser(admin),
      payload: { email: "historical-new@example.test" },
    });
    expect(changed.statusCode).toBe(200);
    await pool.query(`UPDATE users SET badge_id = 'B-HISTORICAL' WHERE id = $1`, [target]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id) VALUES ($1, 'B-HISTORICAL', $2)`,
      [target, admin],
    );

    const removed = await a.inject({
      method: "POST",
      url: `/api/users/${target}/anonymize`,
      headers: asUser(admin),
    });
    expect(removed.statusCode).toBe(200);
    expect(
      (
        await pool.query(
          `SELECT 1 FROM devpost_participants
             WHERE repo_id = $1 AND lower(email) = 'historical-old@example.test'`,
          [repoRows[0].id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (await pool.query(`SELECT 1 FROM user_email_history WHERE user_id = $1`, [target])).rowCount,
    ).toBe(0);
  });

  it("does not copy identity-shaped free text into the anonymous demographics (H54)", async () => {
    const a = await getApp();
    const admin = await createUserWithCapabilities(["*"]);
    const target = await createUser({ email: "free-text@example.test" });
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE users SET name = 'Free Text', surname = 'Participant' WHERE id = $1`, [
      target,
    ]);
    await pool.query(
      `INSERT INTO user_email_history (user_id, email) VALUES ($1, 'historical-free-text@example.test')`,
      [target],
    );
    const freeTextTemplate = [
      {
        key: "gender",
        kind: "text",
        label: { en: "Gender" },
        retention_mode: "anonymous_audit",
        anonymous_audit_dimension: "gender",
      },
      {
        key: "degree",
        kind: "text",
        label: { en: "Degree" },
        retention_mode: "anonymous_audit",
        anonymous_audit_dimension: "degree",
      },
      {
        key: "origin_city",
        kind: "text",
        label: { en: "Origin city" },
        retention_mode: "anonymous_audit",
        anonymous_audit_dimension: "origin_city",
      },
      { key: "year_founded", kind: "number", label: { en: "Year founded" } },
    ];
    const { rows: applicationRows } = await pool.query(
      `INSERT INTO applications (name, type, template)
       VALUES ('Free-text minimization', 'participant', $1::jsonb) RETURNING id`,
      [JSON.stringify(freeTextTemplate)],
    );
    const formVersionId = await ensureApplicationFormVersion(applicationRows[0].id);
    await pool.query(
      `INSERT INTO application_responses
         (user_id, application_id, application_form_version_id, status, responses)
       VALUES ($1, $2, $3, 'accepted', $4::jsonb)`,
      [
        target,
        applicationRows[0].id,
        formVersionId,
        JSON.stringify({
          gender: "historical-free-text@example.test",
          degree: "Free Text Participant",
          origin_city: "+34 600 123 456",
          year_founded: 2015,
        }),
      ],
    );
    await pool.query(`UPDATE users SET badge_id = 'B-FREE-TEXT' WHERE id = $1`, [target]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id) VALUES ($1, 'B-FREE-TEXT', $2)`,
      [target, admin],
    );

    const removed = await a.inject({
      method: "POST",
      url: `/api/users/${target}/anonymize`,
      headers: asUser(admin),
    });
    expect(removed.statusCode).toBe(200);
    const { rows } = await pool.query(
      `SELECT field_key, value FROM anonymous_participant_fields ORDER BY field_key`,
    );
    expect(rows).toEqual([]);
  });

  it("keeps the last active wildcard holder when an anonymization job runs", async () => {
    const soleHolder = await createUserWithCapabilities([CAPABILITIES.ADMIN_ALL]);
    const { pool } = await import("../../src/db/pool.js");
    const { runAccountRemoval } = await import("../../src/modules/identity/removal.js");
    const staff = await createUser();
    await pool.query(`UPDATE users SET badge_id = 'B-SOLE-ADMIN' WHERE id = $1`, [soleHolder]);
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id, staff_id) VALUES ($1, 'B-SOLE-ADMIN', $2)`,
      [soleHolder, staff],
    );

    await expect(
      runAccountRemoval({
        targetId: soleHolder,
        actorId: null,
        source: "system",
        requestedAction: "anonymize",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    const { rows } = await pool.query(
      `SELECT account_state, anonymized_at FROM users WHERE id = $1`,
      [soleHolder],
    );
    expect(rows[0]).toMatchObject({ account_state: "active", anonymized_at: null });
    expect((await pool.query(`SELECT 1 FROM anonymous_participants`)).rowCount).toBe(0);
  });
});
