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
import { assignChallengeToRoom } from "../queue/fixtures.js";
import {
  createChallenge,
  EMAILS,
  participantsCsv,
  projectsCsv,
  seedMatchableUsers,
} from "./fixtures.js";

/** H17: list + manually link unmatched Devpost participants, claim emails. */

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

async function importFixtures(operator: number): Promise<number> {
  const server = await getApp();
  const res = await server.inject({
    method: "POST",
    url: "/api/devpost/imports/confirm",
    headers: asUser(operator),
    payload: { projectsCsv: projectsCsv(), participantsCsv: participantsCsv() },
  });
  expect(res.statusCode).toBe(200);
  const { pool } = await import("../../src/db/pool.js");
  const repo = await pool.query(`SELECT id FROM repos WHERE name = 'Rustacean Station'`);
  return repo.rows[0].id;
}

describe("GET /api/devpost/imports/unmatched (H17)", () => {
  it("lists only unmatched participants, capability-guarded", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);
    await importFixtures(operator);

    const forbidden = await server.inject({
      method: "GET",
      url: "/api/devpost/imports/unmatched",
      headers: asUser(await createUser()),
    });
    expect(forbidden.statusCode).toBe(403);

    const res = await server.inject({
      method: "GET",
      url: "/api/devpost/imports/unmatched",
      headers: asUser(operator),
    });
    expect(res.statusCode).toBe(200);
    const { participants } = res.json();
    const emails = participants.map((p: { email: string }) => p.email).sort();
    expect(emails).toEqual([EMAILS.carolDevpost, EMAILS.dave, EMAILS.frank].sort());
    expect(participants[0].repo_name).toBeDefined();
  });
});

describe("GET /api/projects/member-candidates (H21)", () => {
  it("returns only minimal searchable identity fields to project editors", async () => {
    const server = await getApp();
    await createUser({ email: "candidate@example.com", name: "Candidate" });
    const editor = await createUserWithCapabilities([CAPABILITIES.PROJECTS_EDIT]);
    const unauthorized = await createUser();

    const denied = await server.inject({
      method: "GET",
      url: "/api/projects/member-candidates?q=candidate",
      headers: asUser(unauthorized),
    });
    expect(denied.statusCode).toBe(403);

    const result = await server.inject({
      method: "GET",
      url: "/api/projects/member-candidates?q=candidate",
      headers: asUser(editor),
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().users).toEqual([
      expect.objectContaining({
        email: "candidate@example.com",
        name: "Candidate",
        surname: null,
      }),
    ]);
    expect(Object.keys(result.json().users[0]).sort()).toEqual(["email", "id", "name", "surname"]);
  });
});

describe("POST /api/devpost/imports/link (H17)", () => {
  it("links a participant, creates the submission, audits", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);
    const repoId = await importFixtures(operator);
    const daveAccount = await createUser({ email: "dave-real@primary.test" });

    const res = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/link",
      headers: asUser(operator),
      payload: { repoId, email: EMAILS.dave, userId: daveAccount },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      repoId,
      email: EMAILS.dave,
      userId: daveAccount,
      mergeStatus: "manually_linked",
    });

    const { pool } = await import("../../src/db/pool.js");
    const row = await pool.query(
      `SELECT * FROM devpost_participants WHERE repo_id = $1 AND email = $2`,
      [repoId, EMAILS.dave],
    );
    expect(row.rows[0].merge_status).toBe("manually_linked");
    expect(row.rows[0].user_id).toBe(daveAccount);
    expect(row.rows[0].linked_by).toBe(operator);
    expect(row.rows[0].linked_at).not.toBeNull();

    const sub = await pool.query(`SELECT * FROM submissions WHERE repo_id = $1 AND user_id = $2`, [
      repoId,
      daveAccount,
    ]);
    expect(sub.rows).toHaveLength(1);
    expect(sub.rows[0].imported_from).toBe("devpost");

    const auditRows = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'devpost_participant' AND action = 'manual_link'`,
    );
    expect(auditRows.rows).toHaveLength(1);
    expect(auditRows.rows[0].actor_id).toBe(operator);
  });

  it("404s on unknown participant or unknown user", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);
    const repoId = await importFixtures(operator);
    const someUser = await createUser();

    const noParticipant = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/link",
      headers: asUser(operator),
      payload: { repoId, email: "nobody@nowhere.test", userId: someUser },
    });
    expect(noParticipant.statusCode).toBe(404);

    const noUser = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/link",
      headers: asUser(operator),
      payload: { repoId, email: EMAILS.dave, userId: 999_999 },
    });
    expect(noUser.statusCode).toBe(404);
  });
});

describe("POST /api/devpost/imports/link-secondary (H16/H17)", () => {
  it("waits for secondary verification before linking the participant and submission", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);
    const repoId = await importFixtures(operator);
    const account = await createUser({ email: "dave-real@primary.test", name: "Dave Account" });

    const res = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/link-secondary",
      headers: asUser(operator),
      payload: { repoId, email: EMAILS.dave, userId: account },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      repoId,
      email: EMAILS.dave,
      userId: account,
      secondaryEmailSent: true,
      linked: false,
      mergeStatus: "unmatched",
    });

    const { pool } = await import("../../src/db/pool.js");
    const participant = await pool.query(
      `SELECT user_id, merge_status, linked_by, linked_at FROM devpost_participants
       WHERE repo_id = $1 AND email = $2`,
      [repoId, EMAILS.dave],
    );
    expect(participant.rows[0]).toMatchObject({
      user_id: null,
      merge_status: "unmatched",
      linked_by: null,
      linked_at: null,
    });

    const submission = await pool.query(
      `SELECT imported_from, external_id FROM submissions WHERE repo_id = $1 AND user_id = $2`,
      [repoId, account],
    );
    expect(submission.rows).toEqual([]);
    const token = await pool.query(
      `SELECT email FROM email_verification_tokens
       WHERE user_id = $1 AND type = 'secondary_email' AND used_at IS NULL`,
      [account],
    );
    expect(token.rows).toEqual([{ email: EMAILS.dave }]);
    const tokenValue = await pool.query(
      `SELECT token FROM email_verification_tokens
       WHERE user_id = $1 AND type = 'secondary_email' AND used_at IS NULL`,
      [account],
    );
    const verified = await server.inject({
      method: "POST",
      url: "/api/me/secondary-email/verify",
      headers: asUser(account),
      payload: { token: tokenValue.rows[0].token },
    });
    expect(verified.statusCode).toBe(200);
    const submissions = await pool.query(
      `SELECT 1 FROM submissions WHERE repo_id = $1 AND user_id = $2`,
      [repoId, account],
    );
    expect(submissions.rows).toHaveLength(1);

    const challengeId = await createChallenge("Queue challenge", []);
    await pool.query(
      `INSERT INTO queue_entries (challenge_id, repo_id, status, position) VALUES ($1, $2, 'waiting', 1)`,
      [challengeId, repoId],
    );
    const myQueue = await server.inject({
      method: "GET",
      url: "/api/queue/me",
      headers: asUser(account),
    });
    expect(myQueue.statusCode).toBe(200);
    expect(myQueue.json()).toMatchObject([{ repoId, challengeId, status: "waiting" }]);

    const room = await pool.query(
      `INSERT INTO rooms (name, slug, status) VALUES ('Judge room', 'judge-room', 'active') RETURNING id`,
    );
    const roomId = room.rows[0].id;
    await pool.query(`INSERT INTO room_queue_state (room_id) VALUES ($1)`, [roomId]);
    await assignChallengeToRoom(roomId, challengeId);
    await pool.query(
      `UPDATE queue_entries SET assigned_room_id = $1, status = 'presenting' WHERE repo_id = $2`,
      [roomId, repoId],
    );
    const { roomView } = await import("../../src/modules/queue/reads.js");
    const view = await roomView(roomId);
    expect(view.active.repo_members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: account,
          email: EMAILS.dave,
          source: "devpost",
          matchType: "secondary_email",
        }),
      ]),
    );
  });

  it("links immediately without issuing a secondary token when the address is already primary", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);
    const repoId = await importFixtures(operator);
    const account = await createUser({ email: EMAILS.dave });

    const res = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/link-secondary",
      headers: asUser(operator),
      payload: { repoId, email: EMAILS.dave, userId: account },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      secondaryEmailSent: false,
      linked: true,
      mergeStatus: "auto_matched",
    });

    const { pool } = await import("../../src/db/pool.js");
    const participant = await pool.query(
      `SELECT user_id, merge_status FROM devpost_participants WHERE repo_id = $1 AND email = $2`,
      [repoId, EMAILS.dave],
    );
    expect(participant.rows).toEqual([{ user_id: account, merge_status: "auto_matched" }]);
    const tokens = await pool.query(
      `SELECT 1 FROM email_verification_tokens WHERE user_id = $1 AND type = 'secondary_email'`,
      [account],
    );
    expect(tokens.rows).toHaveLength(0);
  });
});

describe("POST /api/devpost/imports/claim-email (H17)", () => {
  it("creates the account_claim token + outbox email and stamps claim_email_sent_at", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);
    const repoId = await importFixtures(operator);

    const res = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/claim-email",
      headers: asUser(operator),
      payload: { repoId, email: EMAILS.dave },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sent).toBe(true);

    const { pool } = await import("../../src/db/pool.js");

    // stub account to claim (unverified) exists for the devpost email
    const stub = await pool.query(`SELECT * FROM users WHERE email = $1`, [EMAILS.dave]);
    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0].email_verified).toBe(false);
    const stubId = stub.rows[0].id;

    const token = await pool.query(
      `SELECT * FROM email_verification_tokens WHERE type = 'account_claim' AND email = $1`,
      [EMAILS.dave],
    );
    expect(token.rows).toHaveLength(1);
    expect(token.rows[0].user_id).toBe(stubId);
    expect(new Date(token.rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());

    const outbox = await pool.query(
      `SELECT * FROM notification_outbox WHERE category = 'devpost' AND channel = 'email'`,
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0].user_id).toBe(stubId);
    expect(outbox.rows[0].payload.recipient).toBe(EMAILS.dave);
    expect(outbox.rows[0].payload.template).toBe("devpost_account_claim");
    expect(outbox.rows[0].payload.token).toBe(token.rows[0].token);

    const participant = await pool.query(
      `SELECT claim_email_sent_at FROM devpost_participants WHERE repo_id = $1 AND email = $2`,
      [repoId, EMAILS.dave],
    );
    expect(participant.rows[0].claim_email_sent_at).not.toBeNull();

    const auditRows = await pool.query(`SELECT * FROM audit_log WHERE action = 'claim_email_sent'`);
    expect(auditRows.rows).toHaveLength(1);
  });

  it("409s when the participant is not unmatched", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const operator = await createUserWithCapabilities([CAPABILITIES.PROJECTS_IMPORT]);
    const repoId = await importFixtures(operator);

    const { pool } = await import("../../src/db/pool.js");
    const beans = await pool.query(`SELECT id FROM repos WHERE name = 'Neural Beans'`);

    const res = await server.inject({
      method: "POST",
      url: "/api/devpost/imports/claim-email",
      headers: asUser(operator),
      payload: { repoId: beans.rows[0].id, email: EMAILS.alice }, // auto_matched
    });
    expect(res.statusCode).toBe(409);
    expect(repoId).toBeGreaterThan(0);
  });
});

describe("DELETE /api/repos/:repoId/devpost-participants/:email", () => {
  it("deletes an unmatched imported participant without requiring a user id", async () => {
    const server = await getApp();
    await seedMatchableUsers();
    const operator = await createUserWithCapabilities([
      CAPABILITIES.PROJECTS_IMPORT,
      CAPABILITIES.PROJECTS_EDIT,
    ]);
    const repoId = await importFixtures(operator);

    const res = await server.inject({
      method: "DELETE",
      url: `/api/repos/${repoId}/devpost-participants/${encodeURIComponent(EMAILS.dave)}`,
      headers: asUser(operator),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ repoId, email: EMAILS.dave, removed: true });

    const { pool } = await import("../../src/db/pool.js");
    const participant = await pool.query(
      `SELECT 1 FROM devpost_participants WHERE repo_id = $1 AND email = $2`,
      [repoId, EMAILS.dave],
    );
    expect(participant.rows).toHaveLength(0);

    const auditRows = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'devpost_participant' AND action = 'delete'`,
    );
    expect(auditRows.rows).toHaveLength(1);
  });

  it("removes the devpost submission when deleting a matched imported participant", async () => {
    const server = await getApp();
    const { aliceId } = await seedMatchableUsers();
    const operator = await createUserWithCapabilities([
      CAPABILITIES.PROJECTS_IMPORT,
      CAPABILITIES.PROJECTS_EDIT,
    ]);
    await importFixtures(operator);

    const { pool } = await import("../../src/db/pool.js");
    const repo = await pool.query(`SELECT id FROM repos WHERE name = 'Neural Beans'`);
    const repoId = repo.rows[0].id;

    const res = await server.inject({
      method: "DELETE",
      url: `/api/repos/${repoId}/devpost-participants/${encodeURIComponent(EMAILS.alice)}`,
      headers: asUser(operator),
    });
    expect(res.statusCode).toBe(200);

    const participant = await pool.query(
      `SELECT 1 FROM devpost_participants WHERE repo_id = $1 AND email = $2`,
      [repoId, EMAILS.alice],
    );
    expect(participant.rows).toHaveLength(0);

    const submission = await pool.query(
      `SELECT 1 FROM submissions WHERE repo_id = $1 AND user_id = $2`,
      [repoId, aliceId],
    );
    expect(submission.rows).toHaveLength(0);
  });
});
