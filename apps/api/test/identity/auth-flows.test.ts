import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { createApplication } from "../applications/fixtures.js";
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

async function signUp(a: App, overrides: Partial<typeof SIGNUP> & { callbackURL?: string } = {}) {
  return a.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { ...SIGNUP, ...overrides },
  });
}

async function signIn(a: App, email: string, password: string) {
  return a.inject({ method: "POST", url: "/api/auth/sign-in/email", payload: { email, password } });
}

async function latestVerificationToken(email: string): Promise<string> {
  const { pool } = await import("../../src/db/pool.js");
  const { rows } = await pool.query(
    `SELECT o.payload FROM notification_outbox o JOIN users u ON u.id = o.user_id
     WHERE u.email = $1 AND o.payload->>'template' = 'auth.verify'
     ORDER BY o.id DESC LIMIT 1`,
    [email],
  );
  return new URL(rows[0].payload.vars.verifyUrl as string).searchParams.get("token") as string;
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

describe("H1 verified-email transaction boundary", () => {
  it("allows unverified sign-in, reads and drafts, then unlocks submit after verification", async () => {
    const a = await getApp();
    const email = "unverified-boundary@example.com";
    await signUp(a, { email });
    const login = await signIn(a, email, SIGNUP.password);
    expect(login.statusCode).toBe(200);
    const cookie = sessionCookie(login);

    const me = await a.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().emailVerified).toBe(false);

    const { pool } = await import("../../src/db/pool.js");
    const { rows: users } = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
    const blockedByRoutePolicy = await a.inject({
      method: "POST",
      url: "/api/public/universities/propose",
      headers: { "x-test-user-id": String(users[0].id) },
      payload: { name: "Route policy should block this" },
    });
    expect(blockedByRoutePolicy.statusCode).toBe(403);
    expect(blockedByRoutePolicy.json().error.details.code).toBe("email_not_verified");

    const applicationId = await createApplication({
      type: "participant",
      ask_shirt_size: false,
      ask_food_intolerances: false,
    });
    const draft = await a.inject({
      method: "PUT",
      url: `/api/applications/${applicationId}/response`,
      headers: { cookie },
      payload: { responses: { motivation: "I am ready" } },
    });
    expect(draft.statusCode).toBe(200);

    const read = await a.inject({
      method: "GET",
      url: `/api/applications/${applicationId}/response`,
      headers: { cookie },
    });
    expect(read.statusCode).toBe(200);

    const blocked = await a.inject({
      method: "POST",
      url: `/api/applications/${applicationId}/response/submit`,
      headers: { cookie },
      payload: { food_intolerances: [] },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.details.code).toBe("email_not_verified");

    const verify = await a.inject({
      method: "GET",
      url: `/api/auth/verify-email?token=${await latestVerificationToken(email)}`,
    });
    expect(verify.statusCode).toBe(200);

    const afterVerification = await a.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie },
    });
    expect(afterVerification.json().emailVerified).toBe(true);

    const submitted = await a.inject({
      method: "POST",
      url: `/api/applications/${applicationId}/response/submit`,
      headers: { cookie },
      payload: { food_intolerances: [] },
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().response.status).toBe("review");
  });

  it("does not let an unverified account use an acceptance token as a transaction", async () => {
    const a = await getApp();
    const email = "unverified-token-boundary@example.com";
    await signUp(a, { email });
    const { pool } = await import("../../src/db/pool.js");
    const { rows: users } = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
    const userId = users[0].id as number;
    const applicationId = await createApplication({
      type: "participant",
      ask_shirt_size: false,
      ask_food_intolerances: false,
    });
    const applicationId2 = await createApplication({
      name: "Second participant form",
      type: "participant",
      ask_shirt_size: false,
      ask_food_intolerances: false,
    });

    async function createAcceptedToken(
      formId: number,
    ): Promise<{ token: string; responseId: number }> {
      const token = `confirmation-${crypto.randomUUID()}`;
      const { rows: tokenRows } = await pool.query(
        `INSERT INTO email_verification_tokens (token, type, email, user_id, expires_at)
         VALUES ($1, 'spot_confirmation', $2, $3, now() + interval '1 hour') RETURNING id`,
        [token, email, userId],
      );
      const { rows: responseRows } = await pool.query(
        `INSERT INTO application_responses
           (user_id, application_id, status, responses, decision_sent_at, confirmation_token_id)
         VALUES ($1, $2, 'accepted', '{}'::jsonb, now(), $3) RETURNING id`,
        [userId, formId, tokenRows[0].id],
      );
      return { token, responseId: responseRows[0].id as number };
    }

    const confirmation = await createAcceptedToken(applicationId);
    const blockedConfirm = await a.inject({
      method: "POST",
      url: "/api/applications/confirm",
      payload: { token: confirmation.token },
    });
    expect(blockedConfirm.statusCode).toBe(403);
    expect(blockedConfirm.json().error.details.code).toBe("email_not_verified");

    const blockedDeclineToken = await createAcceptedToken(applicationId2);
    const blockedDecline = await a.inject({
      method: "POST",
      url: "/api/applications/decline",
      payload: { token: blockedDeclineToken.token },
    });
    expect(blockedDecline.statusCode).toBe(403);
    expect(blockedDecline.json().error.details.code).toBe("email_not_verified");

    const { rows: unchanged } = await pool.query(
      `SELECT status FROM application_responses WHERE id = ANY($1::int[]) ORDER BY id`,
      [[confirmation.responseId, blockedDeclineToken.responseId]],
    );
    expect(unchanged.map((row: { status: string }) => row.status)).toEqual([
      "accepted",
      "accepted",
    ]);

    await a.inject({
      method: "GET",
      url: `/api/auth/verify-email?token=${await latestVerificationToken(email)}`,
    });
    const confirmed = await a.inject({
      method: "POST",
      url: "/api/applications/confirm",
      payload: { token: confirmation.token },
    });
    expect(confirmed.statusCode).toBe(200);
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
  it("accepts the mobile deep link and redirects the emailed token back into the app", async () => {
    const a = await getApp();
    await signUp(a);

    const request = await a.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: { email: SIGNUP.email, redirectTo: "hackos://reset-password" },
    });
    expect(request.statusCode).toBe(200);

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT o.payload FROM notification_outbox o JOIN users u ON u.id = o.user_id
       WHERE u.email = $1 AND o.payload->>'template' = 'auth.reset' ORDER BY o.id DESC LIMIT 1`,
      [SIGNUP.email],
    );
    const resetUrl = new URL(rows[0].payload.vars.resetUrl as string);
    expect(resetUrl.searchParams.get("callbackURL")).toBe("hackos://reset-password");

    const callback = await a.inject({
      method: "GET",
      url: `${resetUrl.pathname}${resetUrl.search}`,
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toMatch(/^hackos:\/\/reset-password\?token=/);
  });

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

describe("H188 return-path continuity", () => {
  it("carries a same-origin `next` from sign-up through to the emailed verify link", async () => {
    const a = await getApp();
    await signUp(a, {
      email: "next-signup@example.com",
      callbackURL: "/verify-email?verified=1&next=%2Fmy-applications%2F5",
    });

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT o.payload FROM notification_outbox o JOIN users u ON u.id = o.user_id
       WHERE u.email = $1 AND o.payload->>'template' = 'auth.verify' ORDER BY o.id DESC LIMIT 1`,
      ["next-signup@example.com"],
    );
    const verifyUrl = new URL(rows[0].payload.vars.verifyUrl as string);
    const callbackURL = verifyUrl.searchParams.get("callbackURL") as string;
    expect(callbackURL).toContain("/verify-email?verified=1&next=%2Fmy-applications%2F5");
  });

  it("rejects an absolute-URL `next` and falls back to the default destination (same-origin guard)", async () => {
    const a = await getApp();
    await signUp(a, {
      email: "evil-signup@example.com",
      callbackURL: "https://evil.example.com/steal",
    });

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT o.payload FROM notification_outbox o JOIN users u ON u.id = o.user_id
       WHERE u.email = $1 AND o.payload->>'template' = 'auth.verify' ORDER BY o.id DESC LIMIT 1`,
      ["evil-signup@example.com"],
    );
    const verifyUrl = new URL(rows[0].payload.vars.verifyUrl as string);
    const callbackURL = verifyUrl.searchParams.get("callbackURL") as string;
    expect(callbackURL).not.toContain("evil.example.com");
    expect(callbackURL).toContain("/verify-email?verified=1");
  });

  it("carries `next` through a resend-verification request too", async () => {
    const a = await getApp();
    await signUp(a, { email: "next-resend@example.com" });

    const resend = await a.inject({
      method: "POST",
      url: "/api/auth/resend-verification",
      payload: {
        email: "next-resend@example.com",
        callbackURL: "/verify-email?verified=1&next=%2Fmy-applications",
      },
    });
    expect(resend.statusCode).toBe(200);

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT o.payload FROM notification_outbox o JOIN users u ON u.id = o.user_id
       WHERE u.email = $1 AND o.payload->>'template' = 'auth.verify' ORDER BY o.id DESC LIMIT 1`,
      ["next-resend@example.com"],
    );
    const verifyUrl = new URL(rows[0].payload.vars.verifyUrl as string);
    expect(verifyUrl.searchParams.get("callbackURL")).toContain(
      "/verify-email?verified=1&next=%2Fmy-applications",
    );
  });

  it("distinguishes an expired token from an invalid one via the redirect's `error` code (H2)", async () => {
    const a = await getApp();
    const callbackURL = encodeURIComponent("/verify-email?verified=1");

    const invalid = await a.inject({
      method: "GET",
      url: `/api/auth/verify-email?token=not-a-real-token&callbackURL=${callbackURL}`,
    });
    expect(invalid.statusCode).toBe(302);
    const invalidLocation = new URL(invalid.headers.location as string, "http://x");
    expect(invalidLocation.searchParams.get("error")).toBe("INVALID_TOKEN");

    // A syntactically valid but expired JWT, signed the same way Better
    // Auth signs its own verification tokens (better-auth/crypto), with a
    // negative TTL so it's already expired.
    const { config } = await import("../../src/config.js");
    const { signJWT } = await import("better-auth/crypto");
    const expiredToken = await signJWT(
      { email: "nobody@example.com" },
      config.BETTER_AUTH_SECRET,
      -60,
    );

    const expired = await a.inject({
      method: "GET",
      url: `/api/auth/verify-email?token=${expiredToken}&callbackURL=${callbackURL}`,
    });
    expect(expired.statusCode).toBe(302);
    const expiredLocation = new URL(expired.headers.location as string, "http://x");
    expect(expiredLocation.searchParams.get("error")).toBe("TOKEN_EXPIRED");
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

describe("#538 distributed rate limiting on Better Auth paths", () => {
  it("caps /sign-in/email at 30/5min via the Valkey-backed customStorage, with retry-after", async () => {
    const a = await getApp();
    await signUp(a);

    let last: Awaited<ReturnType<typeof signIn>> | undefined;
    for (let i = 0; i < 31; i += 1) {
      // Wrong password on every attempt: exercises the limiter without ever
      // succeeding into a session, and the sign-in path throttles on IP
      // regardless of credential validity.
      last = await signIn(a, SIGNUP.email, "wrong-password-1");
    }
    expect(last?.statusCode).toBe(429);
    const retryAfter = Number(last?.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(300);
  });

  it("caps /request-password-reset at 10/hour, shared across two app instances via Valkey (#538 multi-replica)", async () => {
    // Two separate Fastify instances (independent in-memory Better Auth rate
    // limiters if it weren't for the shared Valkey customStorage) stand in
    // for two API replicas behind a load balancer.
    const replicaA = await buildTestApp();
    const replicaB = await buildTestApp();
    try {
      await signUp(replicaA);

      let last: Awaited<ReturnType<typeof replicaA.inject>> | undefined;
      for (let i = 0; i < 11; i += 1) {
        const target = i % 2 === 0 ? replicaA : replicaB;
        last = await target.inject({
          method: "POST",
          url: "/api/auth/request-password-reset",
          payload: { email: SIGNUP.email, redirectTo: "/reset-password" },
        });
      }
      // The 11th request lands on replicaA (i=10, even) but the limit is
      // shared across both instances, so it 429s even though replicaA alone
      // only saw 6 of the 11 requests.
      expect(last?.statusCode).toBe(429);
      expect(Number(last?.headers["retry-after"])).toBeGreaterThan(0);
    } finally {
      await replicaA.close();
      await replicaB.close();
    }
  });
});
