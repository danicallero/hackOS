import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
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

describe("GET /api/me (H7)", () => {
  it("lets staff manually classify a user as participant or mentor and issues a ticket", async () => {
    const a = await getApp();
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
    await pool.query(
      `INSERT INTO application_responses
         (user_id, application_id, status, decision_sent_at)
       VALUES ($1, $3, 'accepted', now()), ($2, $3, 'accepted_internal', NULL)`,
      [accepted, internal, applications[0].id],
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

  it("derives the illustrative role: admin > judge > sponsor > staff > mentor > participant > unassigned", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");

    const admin = await createUserWithCapabilities(["*"]);
    const staff = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
    const plain = await createUser();
    const participant = await createUser();
    const mentor = await createUser();
    const { rows: participantApp } = await pool.query(
      `INSERT INTO applications (name, type, template) VALUES ('Hackers', 'participant', '[]') RETURNING id`,
    );
    const { rows: mentorApp } = await pool.query(
      `INSERT INTO applications (name, type, template) VALUES ('Mentors', 'mentor', '[]') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO application_responses (user_id, application_id, status)
       VALUES ($1, $2, 'review'), ($3, $4, 'review')`,
      [participant, participantApp[0].id, mentor, mentorApp[0].id],
    );

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
  it("lets an accepted but unconfirmed applicant delete their account and forfeit the spot", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const user = await createUser({ name: "Accepted Self Deletable", emailVerified: true });
    const { rows: applications } = await pool.query(
      `INSERT INTO applications (name, type, template)
       VALUES ('Participants', 'participant', '[]'::jsonb) RETURNING id`,
    );
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
         (user_id, application_id, status, responses, confirmation_token_id,
          decision_sent_at, submitted_at)
       VALUES ($1, $2, 'accepted', '{}'::jsonb, $3, now(), now())
       RETURNING id`,
      [user, applications[0].id, tokens[0].id],
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

    const removalHeaders = { ...asUser(user), "idempotency-key": "accepted-delete-replay" };
    const deleted = await a.inject({ method: "DELETE", url: "/api/me", headers: removalHeaders });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().deleted).toBe(true);
    const replay = await a.inject({
      method: "DELETE",
      url: "/api/me",
      headers: removalHeaders,
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
    const user = await createUser({ name: "Self Deletable" });
    const { rows: applications } = await pool.query(
      `INSERT INTO applications (name, type, template)
       VALUES ('Participants', 'participant', '[]'::jsonb) RETURNING id`,
    );
    await pool.query(
      `INSERT INTO application_responses (user_id, application_id, status, responses)
       VALUES ($1, $2, 'rejected', '{}'::jsonb)`,
      [user, applications[0].id],
    );

    const eligibility = await a.inject({
      method: "GET",
      url: "/api/me/removal-eligibility",
      headers: asUser(user),
    });
    expect(eligibility.statusCode).toBe(200);
    expect(eligibility.json().action).toBe("delete");

    const deleted = await a.inject({ method: "DELETE", url: "/api/me", headers: asUser(user) });
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
    const user = await createUser({ name: "Invited Unassigned" });
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

    const deleted = await a.inject({ method: "DELETE", url: "/api/me", headers: asUser(user) });
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
    const user = await createUser({ name: "Confirmed Not Accredited" });
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

    const deleted = await a.inject({ method: "DELETE", url: "/api/me", headers: asUser(user) });
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
    const user = await createUser({ name: "Accredited" });
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

    const blocked = await a.inject({ method: "DELETE", url: "/api/me", headers: asUser(user) });
    expect(blocked.statusCode).toBe(409);
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [user])).rowCount).toBe(1);
  });

  it("blocks self-anonymization while the participant is inside the venue", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const user = await createUser({ email: "inside-at-removal@example.test" });
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
      headers: asUser(user),
      payload: { confirm: true },
    });

    expect(removal.statusCode).toBe(409);
    expect(removal.json().error.details.code).toBe("participant_inside");
    expect(
      (await pool.query(`SELECT account_state FROM users WHERE id = $1`, [user])).rows,
    ).toEqual([{ account_state: "active" }]);
    expect((await pool.query(`SELECT 1 FROM anonymous_participants`)).rowCount).toBe(0);
  });

  it("self-anonymizes after venue exit, preserves verified minutes, revokes credentials, and replays safely", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const user = await createUser({
      name: "Self Anonymized Person",
      email: "self-anonymized@example.test",
    });
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
    const { rows: applicationRows } = await pool.query(
      `INSERT INTO applications (name, type, template)
       VALUES ('Demographic extraction', 'participant', $1::jsonb) RETURNING id`,
      [
        JSON.stringify([
          { key: "dob", kind: "date", label: { en: "Date of birth" } },
          { key: "gender", kind: "select", label: { en: "Gender" } },
          { key: "degree", kind: "text", label: { en: "Degree" } },
          { key: "graduation_year", kind: "select", label: { en: "Graduation year" } },
          { key: "origin_city", kind: "text", label: { en: "Origin city" } },
          { key: "university", kind: "university", label: { en: "University" } },
        ]),
      ],
    );
    await pool.query(
      `INSERT INTO application_responses (user_id, application_id, status, responses)
       VALUES ($1, $2, 'accepted', $3::jsonb)`,
      [
        user,
        applicationRows[0].id,
        JSON.stringify({
          dob: "2000-01-01",
          gender: "nonbinary",
          degree: "Computer Science",
          graduation_year: "2024",
          origin_city: "A Coruña",
          university: "Universidade da Coruña",
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
      payload: { confirm: true },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().anonymized).toBe(true);

    const replay = await a.inject({
      method: "POST",
      url: "/api/me/anonymize",
      headers,
      payload: { confirm: true },
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
      `SELECT id, age, gender, university, degree, graduation_year, origin_city,
              guaranteed_presence_minutes
         FROM anonymous_participants`,
    );
    expect(anonymous).toHaveLength(1);
    expect(anonymous[0].id).not.toBe(String(user));
    expect(anonymous[0]).toMatchObject({
      age: new Date().getUTCFullYear() - 2000,
      gender: "nonbinary",
      university: "Universidade da Coruña",
      degree: "Computer Science",
      graduation_year: 2024,
      origin_city: "A Coruña",
    });
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
    expect(
      (
        await pool.query(`SELECT 1 FROM check_in_logs WHERE anonymous_participant_id = $1`, [
          anonymous[0].id,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await pool.query(`SELECT 1 FROM time_logs WHERE anonymous_participant_id = $1`, [
          anonymous[0].id,
        ])
      ).rowCount,
    ).toBe(2);
  });

  it("serializes a deletion racing the first accreditation write (H54)", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const staff = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
    const target = await createUser({ email: "race-before-accreditation@example.test" });
    await pool.query(`INSERT INTO tickets (user_id, token) VALUES ($1, 'race-ticket')`, [target]);

    const [removal, checkIn] = await Promise.all([
      a.inject({
        method: "DELETE",
        url: "/api/me",
        headers: { ...asUser(target), "idempotency-key": "race-delete" },
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

  it("GET /api/users/:id includes role, capabilities and groups", async () => {
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
    expect(Array.isArray(res.json().groups)).toBe(true);
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
      retainedFields: [],
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
    await pool.query(
      `INSERT INTO application_responses (user_id, application_id, status, responses)
       VALUES ($1, $2, 'accepted', '{}'::jsonb)`,
      [target, applications[0].id],
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
      retainedFields: expect.arrayContaining([
        "age",
        "gender",
        "university",
        "degree",
        "graduation year",
        "origin city",
        "guaranteed venue-presence time",
      ]),
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
    const { rows: responseRows } = await pool.query(
      `INSERT INTO application_responses (user_id, application_id, status, responses)
       VALUES ($1, $2, 'rejected', '{}'::jsonb) RETURNING id`,
      [target, applications[0].id],
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

    // While still in review, the participant may edit their own name.
    await pool.query(
      `INSERT INTO application_responses (user_id, application_id, status, responses)
       VALUES ($1, $2, 'review', '{}'::jsonb)`,
      [user, appId],
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
      headers: asUser(admin),
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
      (
        await pool.query(
          `SELECT user_id, anonymous_participant_id, badge_id, staff_id
             FROM check_in_logs WHERE anonymous_participant_id = $1`,
          [anonymousRows[0].id],
        )
      ).rows,
    ).toEqual([
      expect.objectContaining({
        user_id: null,
        badge_id: null,
        staff_id: null,
      }),
    ]);

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

    // The retained anonymous row exposes only the audit fields. An original
    // email, name, or numeric user id must not be searchable through normal
    // database relationships after the users row is gone.
    const identitySearch = await pool.query(
      `SELECT id FROM anonymous_participants
        WHERE id::text = $1
           OR coalesce(university, '') IN ($2, $3)
           OR coalesce(degree, '') IN ($2, $3)
           OR coalesce(origin_city, '') IN ($2, $3)`,
      [String(target), "person@example.test", "Real Person"],
    );
    expect(identitySearch.rows).toHaveLength(0);
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
