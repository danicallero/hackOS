import "./env.js";
import { hashPassword } from "better-auth/crypto";
import { describe, expect, it } from "vitest";
import { createApplication } from "../applications/fixtures.js";
import { createUser, ensureApplicationFormVersion, useTestApp } from "../helpers.js";

/**
 * Escalating reminders for unverified accounts and forgotten draft
 * applications (H1, H12, H52), and the "I didn't create this account" link
 * every verification reminder carries (H1, H54).
 */

const getApp = useTestApp();
const PASSWORD = "forgotten-signup-password";

async function db() {
  return (await import("../../src/db/pool.js")).pool;
}

async function runReminders() {
  const { runLifecycleRemindersOnce } = await import(
    "../../src/modules/notifications/lifecycle-reminders.js"
  );
  return runLifecycleRemindersOnce();
}

async function unverifiedUser(ageDays = 6): Promise<number> {
  const pool = await db();
  const userId = await createUser({ emailVerified: false });
  await pool.query(
    `UPDATE users SET created_at = now() - make_interval(days => $2) WHERE id = $1`,
    [userId, ageDays],
  );
  await pool.query(
    `INSERT INTO accounts (user_id, account_id, provider_id, password)
     VALUES ($1, $2, 'credential', $3)`,
    [userId, String(userId), await hashPassword(PASSWORD)],
  );
  return userId;
}

async function draftFor(
  userId: number,
  opts: {
    applicationId?: number;
    status?: string;
    ageDays?: number;
    allowResubmitAfterClose?: boolean;
  } = {},
): Promise<number> {
  const pool = await db();
  const applicationId = opts.applicationId ?? (await createApplication());
  const versionId = await ensureApplicationFormVersion(applicationId);
  const { rows } = await pool.query(
    `INSERT INTO application_responses
       (user_id, application_id, application_form_version_id, status, updated_at,
        allow_resubmit_after_close)
     VALUES ($1, $2, $3, $4, now() - make_interval(days => $5), $6) RETURNING id`,
    [
      userId,
      applicationId,
      versionId,
      opts.status ?? "draft",
      opts.ageDays ?? 6,
      opts.allowResubmitAfterClose ?? false,
    ],
  );
  return rows[0].id;
}

async function emails(userId: number) {
  const pool = await db();
  const { rows } = await pool.query(
    `SELECT category, payload FROM notification_outbox
      WHERE user_id = $1 AND channel = 'email' ORDER BY id`,
    [userId],
  );
  return rows as {
    category: string;
    payload: { template: string; vars: Record<string, string> };
  }[];
}

/** Pretends the last reminder went out five days ago. */
async function ageReminders(): Promise<void> {
  const pool = await db();
  await pool.query(`UPDATE users SET verification_reminded_at = now() - interval '5 days'
                     WHERE verification_reminded_at IS NOT NULL`);
  await pool.query(`UPDATE application_responses SET draft_reminded_at = now() - interval '5 days'
                     WHERE draft_reminded_at IS NOT NULL`);
}

describe("unverified-account reminders", () => {
  it("sends three escalating reminders five days apart, then stops", async () => {
    const userId = await unverifiedUser();

    for (const level of [1, 2, 3]) {
      await runReminders();
      const sent = await emails(userId);
      expect(sent).toHaveLength(level);
      expect(sent[level - 1]?.payload.template).toBe(`auth.verifyReminder${level}`);
      expect(sent[level - 1]?.category).toBe("auth");
      // An immediate second tick is a no-op: the next one is five days away.
      await runReminders();
      expect(await emails(userId)).toHaveLength(level);
      await ageReminders();
    }

    await runReminders();
    expect(await emails(userId)).toHaveLength(3);
  });

  it("links to verification and to deleting the account", async () => {
    const userId = await unverifiedUser();
    await runReminders();
    const [mail] = await emails(userId);
    expect(mail?.payload.vars.verifyUrl).toContain("#token=");
    expect(mail?.payload.vars.deleteUrl).toContain("/delete-account?token=");
  });

  it("waits five days after sign-up and skips verified accounts", async () => {
    const fresh = await unverifiedUser(4);
    const verified = await unverifiedUser();
    const pool = await db();
    await pool.query(`UPDATE users SET email_verified = true WHERE id = $1`, [verified]);
    expect(await runReminders()).toMatchObject({ unverified: 0 });
    expect(await emails(fresh)).toHaveLength(0);
    expect(await emails(verified)).toHaveLength(0);
  });

  it("never double-sends when two workers overlap", async () => {
    const userId = await unverifiedUser();
    await Promise.all([runReminders(), runReminders()]);
    expect(await emails(userId)).toHaveLength(1);
  });
});

describe("draft-application reminders", () => {
  it("sends three escalating reminders for a stale draft, then stops", async () => {
    const userId = await createUser();
    await draftFor(userId);

    for (const level of [1, 2, 3]) {
      await runReminders();
      const sent = await emails(userId);
      expect(sent).toHaveLength(level);
      expect(sent[level - 1]?.payload.template).toBe(`application.draftReminder${level}`);
      expect(sent[level - 1]?.category).toBe("application");
      await ageReminders();
    }

    await runReminders();
    expect(await emails(userId)).toHaveLength(3);
  });

  it("only nags about drafts that can still be submitted", async () => {
    const recent = await createUser();
    await draftFor(recent, { ageDays: 4 });
    const submitted = await createUser();
    await draftFor(submitted, { status: "review" });
    const closed = await createUser();
    await draftFor(closed, {
      applicationId: await createApplication({ close_at: "2020-01-01T00:00:00Z" }),
    });
    const reopened = await createUser();
    await draftFor(reopened, {
      applicationId: await createApplication({ close_at: "2020-01-01T00:00:00Z" }),
      allowResubmitAfterClose: true,
    });

    await runReminders();

    expect(await emails(recent)).toHaveLength(0);
    expect(await emails(submitted)).toHaveLength(0);
    expect(await emails(closed)).toHaveLength(0);
    expect(await emails(reopened)).toHaveLength(1);
  });

  it("leaves an unverified account to the verification series", async () => {
    const userId = await unverifiedUser();
    await draftFor(userId);
    await runReminders();
    const sent = await emails(userId);
    expect(sent.map((mail) => mail.payload.template)).toEqual(["auth.verifyReminder1"]);
  });
});

describe("rendered reminder emails", () => {
  it("renders every level in every language with its links", async () => {
    const { renderEmailTemplate } = await import("../../src/modules/notifications/templates.js");
    const vars = {
      name: "Ada",
      applicationName: "Participants",
      applicationUrl: "https://hackos.test/my-applications/1",
      verifyUrl: "https://hackos.test/verify-email?token=v",
      deleteUrl: "https://hackos.test/delete-account?token=d",
    };
    for (const language of ["en", "es", "gl"] as const) {
      for (const level of [1, 2, 3]) {
        const draft = renderEmailTemplate(
          { template: `application.draftReminder${level}`, vars },
          language,
        );
        expect(draft.subject).toContain("Participants");
        expect(draft.html).toContain(vars.applicationUrl);
        const verify = renderEmailTemplate(
          { template: `auth.verifyReminder${level}`, vars },
          language,
        );
        expect(verify.html).toContain(vars.verifyUrl);
        expect(verify.html).toContain(vars.deleteUrl);
        expect(verify.text).not.toContain("{{");
      }
    }
  });
});

describe("unverified-account removal link", () => {
  async function removalToken(userId: number): Promise<string> {
    await runReminders();
    const [mail] = await emails(userId);
    return new URL(mail?.payload.vars.deleteUrl ?? "").searchParams.get("token") ?? "";
  }

  it("shows the account, then deletes it with the right password and no PIN", async () => {
    const app = await getApp();
    const pool = await db();
    const userId = await unverifiedUser();
    const token = await removalToken(userId);

    const preview = await app.inject({
      method: "GET",
      url: `/api/unverified-account-removal?token=${token}`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().email).toMatch(/@test\.local$/);

    const wrong = await app.inject({
      method: "POST",
      url: "/api/unverified-account-removal",
      payload: { token, password: "not-the-password" },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.details.code).toBe("removal_reauthentication_invalid");
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [userId])).rowCount).toBe(1);

    const ok = await app.inject({
      method: "POST",
      url: "/api/unverified-account-removal",
      payload: { token, password: PASSWORD },
    });
    expect(ok.statusCode).toBe(200);
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [userId])).rowCount).toBe(0);

    const replay = await app.inject({
      method: "POST",
      url: "/api/unverified-account-removal",
      payload: { token, password: PASSWORD },
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error.details.code).toBe("removal_link_invalid");
  });

  it("deletes an account that has no password without asking for one", async () => {
    const app = await getApp();
    const pool = await db();
    const userId = await unverifiedUser();
    await pool.query(`DELETE FROM accounts WHERE user_id = $1`, [userId]);
    const token = await removalToken(userId);

    const preview = await app.inject({
      method: "GET",
      url: `/api/unverified-account-removal?token=${token}`,
    });
    expect(preview.json().passwordRequired).toBe(false);

    const ok = await app.inject({
      method: "POST",
      url: "/api/unverified-account-removal",
      payload: { token },
    });
    expect(ok.statusCode).toBe(200);
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [userId])).rowCount).toBe(0);
  });

  it("still requires the password when the account has one", async () => {
    const app = await getApp();
    const userId = await unverifiedUser();
    const token = await removalToken(userId);
    const response = await app.inject({
      method: "POST",
      url: "/api/unverified-account-removal",
      payload: { token },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.code).toBe("removal_reauthentication_required");
  });

  it("refuses an account whose email has since been verified", async () => {
    const app = await getApp();
    const pool = await db();
    const userId = await unverifiedUser();
    const token = await removalToken(userId);
    await pool.query(`UPDATE users SET email_verified = true WHERE id = $1`, [userId]);

    for (const [method, url, payload] of [
      ["GET", `/api/unverified-account-removal?token=${token}`, undefined],
      ["POST", "/api/unverified-account-removal", { token, password: PASSWORD }],
    ] as const) {
      const response = await app.inject({ method, url, payload });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.details.code).toBe("account_already_verified");
    }
    expect((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [userId])).rowCount).toBe(1);
  });

  it("rejects unknown and expired tokens", async () => {
    const app = await getApp();
    const pool = await db();
    const userId = await unverifiedUser();
    const token = await removalToken(userId);
    await pool.query(
      `UPDATE email_verification_tokens SET expires_at = now() - interval '1 minute'
        WHERE token = $1`,
      [token],
    );
    for (const candidate of [token, "x".repeat(43)]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/unverified-account-removal?token=${candidate}`,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.details.code).toBe("removal_link_invalid");
    }
  });

  it("limits password guesses per account", async () => {
    const app = await getApp();
    const userId = await unverifiedUser();
    const token = await removalToken(userId);
    let last = 0;
    for (let attempt = 0; attempt < 11; attempt++) {
      const response = await app.inject({
        method: "POST",
        url: "/api/unverified-account-removal",
        payload: { token, password: `guess-${attempt}` },
      });
      last = response.statusCode;
    }
    expect(last).toBe(429);
  });
});
