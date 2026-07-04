import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { buildTestApp, truncateAll } from "../helpers.js";

/**
 * Better Auth integration (H1-H5): real sign-up/sign-in/sign-out against
 * Postgres through the mounted /api/auth/* handler — no mocks, verifying the
 * snake_case column mapping in src/modules/identity/auth.ts against
 * migration 0101 for real.
 */

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

const SIGNUP = {
  email: "ada@example.com",
  password: "correct-horse-9",
  name: "Ada",
  surname: "Lovelace",
  language: "es",
};

async function signUp(a: App, overrides: Partial<typeof SIGNUP> = {}) {
  return a.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { ...SIGNUP, ...overrides },
  });
}

async function signIn(a: App, email: string, password: string) {
  return a.inject({ method: "POST", url: "/api/auth/sign-in/email", payload: { email, password } });
}

function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const setCookie = res.headers["set-cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : [String(setCookie)];
  const session = cookies.find((c) => c.includes("session_token"));
  expect(session, "expected a session_token set-cookie").toBeTruthy();
  return (session as string).split(";")[0] as string;
}

describe("H1 sign-up", () => {
  it("creates the user in the EXISTING users table with mapped snake_case columns", async () => {
    const a = await getApp();
    const res = await signUp(a);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe(SIGNUP.email);

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [SIGNUP.email]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Ada");
    expect(rows[0].surname).toBe("Lovelace");
    expect(rows[0].language).toBe("es");
    expect(rows[0].email_verified).toBe(false);
    expect(typeof rows[0].id).toBe("number");

    // credential account row with the password hash
    const { rows: accounts } = await pool.query(
      `SELECT provider_id, password FROM accounts WHERE user_id = $1`,
      [rows[0].id],
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].provider_id).toBe("credential");
    expect(accounts[0].password).toBeTruthy();
    expect(accounts[0].password).not.toContain(SIGNUP.password);
  });

  it("queues the verification email into notification_outbox instead of sending (H1)", async () => {
    const a = await getApp();
    await signUp(a);
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT o.* FROM notification_outbox o JOIN users u ON u.id = o.user_id WHERE u.email = $1`,
      [SIGNUP.email],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe("email");
    expect(rows[0].category).toBe("auth");
    expect(rows[0].status).toBe("queued");
    expect(rows[0].payload.template).toBe("auth.verify");
    expect(rows[0].payload.vars.verifyUrl).toContain("/api/auth/verify-email?token=");
  });

  it("does not reveal whether an email already exists (H1)", async () => {
    const a = await getApp();
    const first = await signUp(a);
    expect(first.statusCode).toBe(200);
    const dup = await signUp(a, { name: "Impostor" });
    // enumeration-safe: identical shape and status, no error
    expect(dup.statusCode).toBe(200);
    expect(dup.json().user.email).toBe(SIGNUP.email);
    expect(dup.json().token).toBeNull();

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [
      SIGNUP.email,
    ]);
    expect(rows[0].n).toBe(1); // no second row created
  });
});

describe("H4 sign-in / sign-out", () => {
  it("logs in, resolves req.userId via the session cookie, and truly revokes on sign-out", async () => {
    const a = await getApp();
    await signUp(a);
    const login = await signIn(a, SIGNUP.email, SIGNUP.password);
    expect(login.statusCode).toBe(200);
    const cookie = sessionCookie(login);

    // CRITICAL wiring: /api/me resolves through setUserIdResolver -> Better Auth session
    const me = await a.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe(SIGNUP.email);

    // server-side session row exists
    const { pool } = await import("../../src/db/pool.js");
    const { rows: sessions } = await pool.query(
      `SELECT s.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1`,
      [SIGNUP.email],
    );
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    const out = await a.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { cookie },
      payload: {},
    });
    expect(out.statusCode).toBe(200);

    // the revoked session no longer authenticates — also gone server-side
    const meAfter = await a.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(meAfter.statusCode).toBe(401);
    const { rows: after } = await pool.query(
      `SELECT s.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1`,
      [SIGNUP.email],
    );
    expect(after).toHaveLength(0);
  });

  it("rejects a wrong password", async () => {
    const a = await getApp();
    await signUp(a);
    const bad = await signIn(a, SIGNUP.email, "wrong-password-1");
    expect(bad.statusCode).toBe(401);
  });
});

describe("H2 verify email", () => {
  async function extractVerifyToken(email: string): Promise<string> {
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT o.payload FROM notification_outbox o JOIN users u ON u.id = o.user_id
       WHERE u.email = $1 AND o.payload->>'template' = 'auth.verify'
       ORDER BY o.id DESC LIMIT 1`,
      [email],
    );
    const url = rows[0].payload.vars.verifyUrl as string;
    return new URL(url).searchParams.get("token") as string;
  }

  it("verifies via the emailed link and flips users.email_verified", async () => {
    const a = await getApp();
    await signUp(a);
    const token = await extractVerifyToken(SIGNUP.email);
    const res = await a.inject({ method: "GET", url: `/api/auth/verify-email?token=${token}` });
    expect(res.statusCode).toBe(200);

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(`SELECT email_verified FROM users WHERE email = $1`, [
      SIGNUP.email,
    ]);
    expect(rows[0].email_verified).toBe(true);
  });

  it("an already-used link answers 'already verified' instead of erroring (H2)", async () => {
    const a = await getApp();
    await signUp(a);
    const token = await extractVerifyToken(SIGNUP.email);
    await a.inject({ method: "GET", url: `/api/auth/verify-email?token=${token}` });
    const again = await a.inject({ method: "GET", url: `/api/auth/verify-email?token=${token}` });
    expect(again.statusCode).toBe(200);
    expect(again.json().status).toBe(true);
  });
});

describe("H5 password reset", () => {
  it("same response whether the email exists or not, and the reset email is queued", async () => {
    const a = await getApp();
    await signUp(a);

    const real = await a.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: { email: SIGNUP.email },
    });
    const fake = await a.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: { email: "nobody@example.com" },
    });
    expect(real.statusCode).toBe(200);
    expect(fake.statusCode).toBe(200);
    expect(real.json()).toEqual(fake.json());

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT o.payload FROM notification_outbox o JOIN users u ON u.id = o.user_id
       WHERE u.email = $1 AND o.payload->>'template' = 'auth.reset'`,
      [SIGNUP.email],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.vars.resetUrl).toContain("/api/auth/reset-password/");
  });

  it("resetting the password revokes ALL existing sessions (H5)", async () => {
    const a = await getApp();
    await signUp(a);
    const s1 = sessionCookie(await signIn(a, SIGNUP.email, SIGNUP.password));
    const s2 = sessionCookie(await signIn(a, SIGNUP.email, SIGNUP.password));

    await a.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: { email: SIGNUP.email },
    });
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT o.payload FROM notification_outbox o JOIN users u ON u.id = o.user_id
       WHERE u.email = $1 AND o.payload->>'template' = 'auth.reset' ORDER BY o.id DESC LIMIT 1`,
      [SIGNUP.email],
    );
    const resetUrl = rows[0].payload.vars.resetUrl as string;
    const token = new URL(resetUrl).pathname.split("/").pop() as string;

    const reset = await a.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { token, newPassword: "brand-new-pass-1" },
    });
    expect(reset.statusCode).toBe(200);

    for (const cookie of [s1, s2]) {
      const me = await a.inject({ method: "GET", url: "/api/me", headers: { cookie } });
      expect(me.statusCode).toBe(401);
    }

    // old password dead, new one works
    expect((await signIn(a, SIGNUP.email, SIGNUP.password)).statusCode).toBe(401);
    expect((await signIn(a, SIGNUP.email, "brand-new-pass-1")).statusCode).toBe(200);
  });
});

describe("H3 resend verification rate limit", () => {
  it("enforces 60s cooldown then 3/hour via Valkey with retry-after (H3)", async () => {
    const a = await getApp();
    await signUp(a);

    const first = await a.inject({
      method: "POST",
      url: "/api/auth/resend-verification",
      payload: { email: SIGNUP.email },
    });
    expect(first.statusCode).toBe(200);

    // immediately again -> 60s cooldown hits
    const second = await a.inject({
      method: "POST",
      url: "/api/auth/resend-verification",
      payload: { email: SIGNUP.email },
    });
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe("too_many_requests");
    const retryAfter = Number(second.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);

    // simulate cooldown expiry twice more, then the hourly cap trips
    const { valkey } = await import("../../src/lib/valkey.js");
    for (let i = 0; i < 2; i += 1) {
      await valkey.del(`identity:verify-resend:cooldown:${SIGNUP.email}`);
      const ok = await a.inject({
        method: "POST",
        url: "/api/auth/resend-verification",
        payload: { email: SIGNUP.email },
      });
      expect(ok.statusCode).toBe(200);
    }
    await valkey.del(`identity:verify-resend:cooldown:${SIGNUP.email}`);
    const fourth = await a.inject({
      method: "POST",
      url: "/api/auth/resend-verification",
      payload: { email: SIGNUP.email },
    });
    expect(fourth.statusCode).toBe(429);
    expect(Number(fourth.headers["retry-after"])).toBeGreaterThan(60);
  });
});
