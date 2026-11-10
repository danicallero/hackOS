import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { chromium } from "playwright-core";

const apiUrl = process.env.VERIFY_API_URL;
const webUrl = process.env.VERIFY_WEB_URL;
const databaseUrl = process.env.TEST_DATABASE_URL;
const chromeExecutable =
  process.env.CHROME_EXECUTABLE ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

if (!apiUrl || !webUrl || !databaseUrl || !new URL(databaseUrl).pathname.endsWith("_test")) {
  throw new Error(
    "Set VERIFY_API_URL, VERIFY_WEB_URL and an isolated TEST_DATABASE_URL ending in _test",
  );
}

// H2: a real browser's native form navigation must retain an Origin header.
// Start the API with WEB_URL=VERIFY_WEB_URL and the web app at VERIFY_WEB_URL.
test("email verification click sends the site Origin and establishes a verified session", async () => {
  const email = `verify-browser-${randomUUID()}@example.test`;
  const signup = await fetch(`${apiUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: new URL(webUrl).origin },
    body: JSON.stringify({
      email,
      password: "BrowserVerify!234",
      name: "Browser",
      surname: "Test",
    }),
  });
  assert.equal(signup.status, 200);

  const database = new pg.Client({ connectionString: databaseUrl });
  await database.connect();
  let browser;
  try {
    const { rows } = await database.query(
      `SELECT o.payload->'vars'->>'verifyUrl' AS url
       FROM notification_outbox o JOIN users u ON u.id = o.user_id
       WHERE u.email = $1 AND o.payload->>'template' = 'auth.verify'
       ORDER BY o.id DESC LIMIT 1`,
      [email],
    );
    const link = rows[0]?.url;
    assert.ok(link, "sign-up must queue a verification link");
    assert.equal(new URL(link).origin, new URL(webUrl).origin);
    const bearer = new URLSearchParams(new URL(link).hash.slice(1)).get("token");
    assert.ok(bearer, "the emailed token must live in the fragment");
    assert.ok(!new URL(link).searchParams.has("token"));

    browser = await chromium.launch({ executablePath: chromeExecutable, headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const requestUrls = [];
    page.on("request", (request) => requestUrls.push(request.url()));
    await page.goto(link);
    await page.getByRole("button", { name: "Confirm email" }).waitFor();
    assert.ok(!page.url().includes(bearer), "hydration must clear the fragment before clicking");
    assert.ok(
      requestUrls.every((url) => !url.includes(bearer)),
      "GET requests must never carry the token",
    );
    const [request, response] = await Promise.all([
      page.waitForRequest((req) => req.url().endsWith("/api/auth/verify-email/confirm")),
      page.waitForResponse((res) => res.url().endsWith("/api/auth/verify-email/confirm")),
      page.getByRole("button", { name: "Confirm email" }).click(),
    ]);
    const origin = request.headers().origin;
    const referer = request.headers().referer;
    console.log(`verification POST Origin=${origin ?? "<missing>"} status=${response.status()}`);
    assert.equal(origin, new URL(webUrl).origin);
    assert.equal(referer, `${new URL(webUrl).origin}/`, "only the site origin may be referred");
    assert.ok(!request.url().includes(bearer), "the POST URL must never carry the token");
    assert.equal(response.status(), 302);
    await page.waitForURL(/\/verify-email\?verified=1/);
    const verification = await database.query("SELECT email_verified FROM users WHERE email = $1", [
      email,
    ]);
    assert.equal(verification.rows[0]?.email_verified, true);
    const cookies = await context.cookies(apiUrl);
    assert.ok(cookies.some((cookie) => cookie.name.includes("session_token")));
    if (process.env.VERIFY_SCREENSHOT_PATH) {
      await page.screenshot({ path: process.env.VERIFY_SCREENSHOT_PATH, fullPage: true });
    }
  } finally {
    await browser?.close();
    await database.end();
  }
});
