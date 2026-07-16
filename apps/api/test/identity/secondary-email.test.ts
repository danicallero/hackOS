import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { asUser, buildTestApp, createUser, truncateAll } from "../helpers.js";

/** H6: add + verify a secondary email; strict cross-account uniqueness. */

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

async function requestSecondary(a: App, userId: number, email: string) {
  return a.inject({
    method: "POST",
    url: "/api/me/secondary-email",
    headers: asUser(userId),
    payload: { email },
  });
}

async function latestToken(userId: number): Promise<string> {
  const { pool } = await import("../../src/db/pool.js");
  const { rows } = await pool.query(
    `SELECT token FROM email_verification_tokens
     WHERE user_id = $1 AND type = 'secondary_email' AND used_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    [userId],
  );
  return rows[0].token;
}

describe("H6 secondary email", () => {
  it("happy path: request stores a pending address + token + outbox row; verify stamps it", async () => {
    const a = await getApp();
    const userId = await createUser();
    const { pool } = await import("../../src/db/pool.js");
    const repo = await pool.query(
      `INSERT INTO repos (name) VALUES ('Secondary reconciliation') RETURNING id`,
    );
    const repoId = repo.rows[0].id;
    await pool.query(
      `INSERT INTO devpost_participants (repo_id, email, import_batch, merge_status)
       VALUES ($1, 'devpost-me@example.com', 'test-import', 'unmatched')`,
      [repoId],
    );
    const res = await requestSecondary(a, userId, "devpost-me@example.com");
    expect(res.statusCode).toBe(200);

    const { rows: pending } = await pool.query(
      `SELECT secondary_email, secondary_email_verified_at FROM users WHERE id = $1`,
      [userId],
    );
    expect(pending[0].secondary_email).toBe("devpost-me@example.com");
    expect(pending[0].secondary_email_verified_at).toBeNull();

    const { rows: outbox } = await pool.query(
      `SELECT * FROM notification_outbox WHERE user_id = $1 AND category = 'auth'`,
      [userId],
    );
    expect(outbox).toHaveLength(1);
    // H6 regression: the verification email must be addressed to the NEW
    // secondary address, never the user's primary (payload.recipient overrides
    // users.email in the email channel adapter).
    expect(outbox[0].payload.recipient).toBe("devpost-me@example.com");

    const token = await latestToken(userId);
    const verify = await a.inject({
      method: "POST",
      url: "/api/me/secondary-email/verify",
      headers: asUser(userId),
      payload: { token },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().alreadyVerified).toBe(false);

    const { rows: after } = await pool.query(
      `SELECT secondary_email, secondary_email_verified_at FROM users WHERE id = $1`,
      [userId],
    );
    expect(after[0].secondary_email_verified_at).not.toBeNull();
    const reconciled = await pool.query(
      `SELECT user_id, merge_status FROM devpost_participants WHERE repo_id = $1`,
      [repoId],
    );
    expect(reconciled.rows).toEqual([{ user_id: userId, merge_status: "auto_matched" }]);
    const submission = await pool.query(
      `SELECT 1 FROM submissions WHERE repo_id = $1 AND user_id = $2`,
      [repoId, userId],
    );
    expect(submission.rows).toHaveLength(1);

    // audited
    const { rows: auditRows } = await pool.query(
      `SELECT * FROM audit_log WHERE action = 'secondary_email_verified' AND entity_id = $1`,
      [String(userId)],
    );
    expect(auditRows).toHaveLength(1);
  });

  it("409 when the address equals ANY user's primary email", async () => {
    const a = await getApp();
    await createUser({ email: "taken@example.com" });
    const userId = await createUser();
    const res = await requestSecondary(a, userId, "taken@example.com");
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("conflict");
  });

  it("reconciles added and replaced secondary emails without removing manual links", async () => {
    const a = await getApp();
    const userId = await createUser({ email: "primary@example.com" });
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE users
          SET secondary_email = 'old-devpost@example.com', secondary_email_verified_at = now()
        WHERE id = $1`,
      [userId],
    );
    const oldRepo = await pool.query(
      `INSERT INTO repos (name) VALUES ('Old secondary') RETURNING id`,
    );
    const newRepo = await pool.query(
      `INSERT INTO repos (name) VALUES ('New secondary') RETURNING id`,
    );
    const manualRepo = await pool.query(
      `INSERT INTO repos (name) VALUES ('Manual link') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO devpost_participants (repo_id, email, user_id, import_batch, merge_status)
       VALUES ($1, 'old-devpost@example.com', $2, 'test-import', 'auto_matched'),
              ($3, 'new-devpost@example.com', NULL, 'test-import', 'unmatched'),
              ($4, 'operator-linked@example.com', $2, 'test-import', 'manually_linked')`,
      [oldRepo.rows[0].id, userId, newRepo.rows[0].id, manualRepo.rows[0].id],
    );
    await pool.query(
      `INSERT INTO submissions (repo_id, user_id, imported_from)
       VALUES ($1, $2, 'devpost'), ($3, $2, 'devpost')`,
      [oldRepo.rows[0].id, userId, manualRepo.rows[0].id],
    );

    expect((await requestSecondary(a, userId, "new-devpost@example.com")).statusCode).toBe(200);
    const afterChange = await pool.query(
      `SELECT repo_id, user_id, merge_status FROM devpost_participants ORDER BY repo_id`,
    );
    expect(afterChange.rows).toEqual([
      { repo_id: oldRepo.rows[0].id, user_id: null, merge_status: "unmatched" },
      { repo_id: newRepo.rows[0].id, user_id: null, merge_status: "unmatched" },
      { repo_id: manualRepo.rows[0].id, user_id: userId, merge_status: "manually_linked" },
    ]);
    const removedSubmission = await pool.query(
      `SELECT 1 FROM submissions WHERE repo_id = $1 AND user_id = $2`,
      [oldRepo.rows[0].id, userId],
    );
    expect(removedSubmission.rows).toHaveLength(0);

    const verify = await a.inject({
      method: "POST",
      url: "/api/me/secondary-email/verify",
      headers: asUser(userId),
      payload: { token: await latestToken(userId) },
    });
    expect(verify.statusCode).toBe(200);
    const afterVerify = await pool.query(
      `SELECT user_id, merge_status FROM devpost_participants WHERE repo_id = $1`,
      [newRepo.rows[0].id],
    );
    expect(afterVerify.rows).toEqual([{ user_id: userId, merge_status: "auto_matched" }]);
    const newSubmission = await pool.query(
      `SELECT 1 FROM submissions WHERE repo_id = $1 AND user_id = $2`,
      [newRepo.rows[0].id, userId],
    );
    expect(newSubmission.rows).toHaveLength(1);
  });

  it("409 when the address is another user's VERIFIED secondary email", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const other = await createUser();
    await pool.query(
      `UPDATE users SET secondary_email = 'shared@example.com', secondary_email_verified_at = now() WHERE id = $1`,
      [other],
    );
    const userId = await createUser();
    const res = await requestSecondary(a, userId, "shared@example.com");
    expect(res.statusCode).toBe(409);
  });

  it("another user's merely PENDING secondary does not block (only verified ones identify accounts)", async () => {
    const a = await getApp();
    const other = await createUser();
    await requestSecondary(a, other, "raceable@example.com");
    const userId = await createUser();
    const res = await requestSecondary(a, userId, "raceable@example.com");
    expect(res.statusCode).toBe(200);
  });

  it("verification re-checks uniqueness at consumption time (H6)", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const userId = await createUser();
    await requestSecondary(a, userId, "late-clash@example.com");
    const token = await latestToken(userId);

    // someone registers that address as a primary account in between
    await createUser({ email: "late-clash@example.com" });

    const verify = await a.inject({
      method: "POST",
      url: "/api/me/secondary-email/verify",
      headers: asUser(userId),
      payload: { token },
    });
    expect(verify.statusCode).toBe(409);
    const { rows } = await pool.query(
      `SELECT secondary_email_verified_at FROM users WHERE id = $1`,
      [userId],
    );
    expect(rows[0].secondary_email_verified_at).toBeNull();
  });

  it("cannot equal your own primary email; expired tokens ask for a new one; reused tokens say already verified", async () => {
    const a = await getApp();
    const { pool } = await import("../../src/db/pool.js");
    const userId = await createUser({ email: "self@example.com" });

    const own = await requestSecondary(a, userId, "self@example.com");
    expect(own.statusCode).toBe(400);

    // expired
    await requestSecondary(a, userId, "fresh@example.com");
    const expiredToken = await latestToken(userId);
    await pool.query(
      `UPDATE email_verification_tokens SET expires_at = now() - interval '1 minute' WHERE token = $1`,
      [expiredToken],
    );
    const expired = await a.inject({
      method: "POST",
      url: "/api/me/secondary-email/verify",
      headers: asUser(userId),
      payload: { token: expiredToken },
    });
    expect(expired.statusCode).toBe(400);
    expect(expired.json().error.details.expired).toBe(true);

    // fresh request, verify, then verify AGAIN with the same token
    await requestSecondary(a, userId, "fresh@example.com");
    const token = await latestToken(userId);
    const first = await a.inject({
      method: "POST",
      url: "/api/me/secondary-email/verify",
      headers: asUser(userId),
      payload: { token },
    });
    expect(first.statusCode).toBe(200);
    const again = await a.inject({
      method: "POST",
      url: "/api/me/secondary-email/verify",
      headers: asUser(userId),
      payload: { token },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().alreadyVerified).toBe(true);
  });

  it("someone else's token is rejected", async () => {
    const a = await getApp();
    const owner = await createUser();
    await requestSecondary(a, owner, "mine@example.com");
    const token = await latestToken(owner);
    const thief = await createUser();
    const res = await a.inject({
      method: "POST",
      url: "/api/me/secondary-email/verify",
      headers: asUser(thief),
      payload: { token },
    });
    expect(res.statusCode).toBe(400);
  });
});
