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
    const res = await requestSecondary(a, userId, "second-me@example.com");
    expect(res.statusCode).toBe(200);

    const { rows: pending } = await pool.query(
      `SELECT secondary_email, secondary_email_verified_at FROM users WHERE id = $1`,
      [userId],
    );
    expect(pending[0].secondary_email).toBe("second-me@example.com");
    expect(pending[0].secondary_email_verified_at).toBeNull();

    const { rows: outbox } = await pool.query(
      `SELECT * FROM notification_outbox WHERE user_id = $1 AND category = 'auth'`,
      [userId],
    );
    expect(outbox).toHaveLength(1);
    // H6 regression: the verification email must be addressed to the NEW
    // secondary address, never the user's primary (payload.recipient overrides
    // users.email in the email channel adapter).
    expect(outbox[0].payload.recipient).toBe("second-me@example.com");

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

  it("someone else's token is rejected, distinctly from an unknown token (issue #392)", async () => {
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
    expect(res.json().error.details.wrongAccount).toBe(true);

    const bogus = await a.inject({
      method: "POST",
      url: "/api/me/secondary-email/verify",
      headers: asUser(thief),
      payload: { token: "not-a-real-token" },
    });
    expect(bogus.statusCode).toBe(400);
    expect(bogus.json().error.details).toBeUndefined();
  });

  it("preview endpoint reports account match without leaking the address to the wrong account (issue #392)", async () => {
    const a = await getApp();
    const owner = await createUser();
    await requestSecondary(a, owner, "preview-me@example.com");
    const token = await latestToken(owner);

    const ownPreview = await a.inject({
      method: "GET",
      url: `/api/me/secondary-email/verify?token=${token}`,
      headers: asUser(owner),
    });
    expect(ownPreview.statusCode).toBe(200);
    expect(ownPreview.json()).toEqual({
      matchesAccount: true,
      secondaryEmail: "preview-me@example.com",
      alreadyUsed: false,
      expired: false,
    });

    const other = await createUser();
    const otherPreview = await a.inject({
      method: "GET",
      url: `/api/me/secondary-email/verify?token=${token}`,
      headers: asUser(other),
    });
    expect(otherPreview.statusCode).toBe(200);
    expect(otherPreview.json()).toEqual({
      matchesAccount: false,
      secondaryEmail: null,
      alreadyUsed: false,
      expired: false,
    });

    const unknown = await a.inject({
      method: "GET",
      url: "/api/me/secondary-email/verify?token=not-a-real-token",
      headers: asUser(owner),
    });
    expect(unknown.statusCode).toBe(400);
  });

  it("removes a verified secondary email", async () => {
    const a = await getApp();
    const userId = await createUser({ email: "primary@example.com" });
    const { pool } = await import("../../src/db/pool.js");
    await requestSecondary(a, userId, "secondary@example.com");
    await a.inject({
      method: "POST",
      url: "/api/me/secondary-email/verify",
      headers: asUser(userId),
      payload: { token: await latestToken(userId) },
    });

    const removed = await a.inject({
      method: "DELETE",
      url: "/api/me/secondary-email",
      headers: asUser(userId),
    });
    expect(removed.statusCode).toBe(200);
    const user = await pool.query(
      `SELECT secondary_email, secondary_email_verified_at FROM users WHERE id = $1`,
      [userId],
    );
    expect(user.rows[0]).toEqual({ secondary_email: null, secondary_email_verified_at: null });
  });

  it("staff with user-write access can remove another account's secondary email", async () => {
    const a = await getApp();
    const target = await createUser();
    const unauthorized = await createUser();
    const editor = await createUserWithCapabilities([CAPABILITIES.USERS_WRITE]);
    const { pool } = await import("../../src/db/pool.js");
    await pool.query(
      `UPDATE users SET secondary_email = 'staff-remove@example.com', secondary_email_verified_at = now()
        WHERE id = $1`,
      [target],
    );
    expect(
      (
        await a.inject({
          method: "DELETE",
          url: `/api/users/${target}/secondary-email`,
          headers: asUser(unauthorized),
        })
      ).statusCode,
    ).toBe(403);
    const removed = await a.inject({
      method: "DELETE",
      url: `/api/users/${target}/secondary-email`,
      headers: asUser(editor),
    });
    expect(removed.statusCode).toBe(200);
    const audit = await pool.query(
      `SELECT actor_id FROM audit_log
        WHERE action = 'secondary_email_admin_removed' AND entity_id = $1`,
      [String(target)],
    );
    expect(audit.rows).toEqual([{ actor_id: editor }]);
  });

  it("allows only one concurrent verification winner for the same secondary address", async () => {
    const a = await getApp();
    const first = await createUser();
    const second = await createUser();
    await requestSecondary(a, first, "one-owner@example.com");
    await requestSecondary(a, second, "one-owner@example.com");
    const [firstToken, secondToken] = await Promise.all([latestToken(first), latestToken(second)]);
    const results = await Promise.all([
      a.inject({
        method: "POST",
        url: "/api/me/secondary-email/verify",
        headers: asUser(first),
        payload: { token: firstToken },
      }),
      a.inject({
        method: "POST",
        url: "/api/me/secondary-email/verify",
        headers: asUser(second),
        payload: { token: secondToken },
      }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
  });
});
