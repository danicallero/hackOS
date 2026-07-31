import "./env.js";
import "./wallet-fixtures.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { asUser, buildTestApp, createUser, truncateAll } from "../helpers.js";
import { assignBadge, issueTicket } from "./fixtures.js";

/**
 * Scoped wallet tokens (issue #369). The credential handed out by the
 * acceptance-email confirm can fetch exactly one thing — the pass it was
 * minted for, for the user it names — and is not a session: it reads nothing
 * else, and a signed-in browser gets the TOKEN's pass, never its own.
 */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  app ??= await buildTestApp();
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

async function mintToken(userId: number, purpose: "ticket" | "badge" = "ticket"): Promise<string> {
  const { pool } = await import("../../src/db/pool.js");
  const { issueWalletAccessToken } = await import("../../src/modules/logistics/wallet-access.js");
  const client = await pool.connect();
  try {
    const grant = await issueWalletAccessToken(client, userId, purpose);
    return grant.token;
  } finally {
    client.release();
  }
}

describe("scoped wallet access (issue #369)", () => {
  it("serves the Apple ticket pass with no session at all", async () => {
    const uid = await createUser({ name: "Scoped" });
    await issueTicket(uid, "ticket-scoped-1");
    const token = await mintToken(uid);

    const res = await app.inject({
      method: "GET",
      url: `/api/wallet/scoped/apple/ticket.pkpass?token=${token}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/vnd.apple.pkpass");
    expect(res.headers["x-apple-pass-serial-number"]).toMatch(/^ticket-/);
    expect(res.rawPayload.subarray(0, 4).toString("hex")).toBe("504b0304");
  });

  it("serves the Google save URL with no session at all", async () => {
    const uid = await createUser({ name: "Scoped" });
    await issueTicket(uid, "ticket-scoped-google");
    const token = await mintToken(uid);

    const res = await app.inject({
      method: "GET",
      url: `/api/wallet/scoped/google/ticket?token=${token}`,
    });
    expect(res.statusCode).toBe(200);
    const jwt = res.json().saveUrl.slice("https://pay.google.com/gp/v/save/".length);
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    expect(claims.payload.genericObjects[0].barcode.value).toBe("ticket-scoped-google");
  });

  it("gives the token holder's pass even when someone else is signed in", async () => {
    const owner = await createUser({ name: "Owner" });
    const other = await createUser({ name: "Other" });
    await issueTicket(owner, "ticket-owner");
    await issueTicket(other, "ticket-other");
    const token = await mintToken(owner);

    const res = await app.inject({
      method: "GET",
      url: `/api/wallet/scoped/google/ticket?token=${token}`,
      headers: asUser(other),
    });
    expect(res.statusCode).toBe(200);
    const jwt = res.json().saveUrl.slice("https://pay.google.com/gp/v/save/".length);
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    expect(claims.payload.genericObjects[0].barcode.value).toBe("ticket-owner");
  });

  it("rejects an unknown, expired or wrong-purpose token", async () => {
    const uid = await createUser({ name: "Scoped" });
    await issueTicket(uid, "ticket-scoped-2");
    await assignBadge(uid, "badge-scoped-2");
    const ticketToken = await mintToken(uid);

    const unknown = await app.inject({
      method: "GET",
      url: "/api/wallet/scoped/google/ticket?token=nope",
    });
    expect(unknown.statusCode).toBe(401);

    // A ticket-scoped token cannot reach into the badge pass.
    const wrongPurpose = await app.inject({
      method: "GET",
      url: `/api/wallet/scoped/google/badge?token=${ticketToken}`,
    });
    expect(wrongPurpose.statusCode).toBe(401);

    const { pool } = await import("../../src/db/pool.js");
    await pool.query(`UPDATE wallet_access_tokens SET expires_at = now() - interval '1 minute'`);
    const expired = await app.inject({
      method: "GET",
      url: `/api/wallet/scoped/google/ticket?token=${ticketToken}`,
    });
    expect(expired.statusCode).toBe(401);
  });

  it("is not a session: the token opens nothing else", async () => {
    const uid = await createUser({ name: "Scoped" });
    await issueTicket(uid, "ticket-scoped-3");
    const token = await mintToken(uid);

    const me = await app.inject({ method: "GET", url: `/api/me?token=${token}` });
    expect(me.statusCode).toBe(401);

    const ticket = await app.inject({ method: "GET", url: `/api/me/ticket?token=${token}` });
    expect(ticket.statusCode).toBe(401);

    // …and it cannot stand in for a session on the authenticated wallet route.
    const authed = await app.inject({
      method: "GET",
      url: `/api/me/wallet/google/ticket?token=${token}`,
    });
    expect(authed.statusCode).toBe(401);
  });

  it("purges only long-expired tokens", async () => {
    const uid = await createUser({ name: "Scoped" });
    await issueTicket(uid, "ticket-scoped-4");
    const fresh = await mintToken(uid);
    const { pool } = await import("../../src/db/pool.js");
    const { purgeExpiredWalletAccessTokens } = await import(
      "../../src/modules/logistics/wallet-access.js"
    );
    await mintToken(uid);
    await pool.query(
      `UPDATE wallet_access_tokens SET expires_at = now() - interval '2 days' WHERE token <> $1`,
      [fresh],
    );

    expect(await purgeExpiredWalletAccessTokens()).toBe(1);
    const { rows } = await pool.query(`SELECT token FROM wallet_access_tokens`);
    expect(rows.map((r) => r.token)).toEqual([fresh]);
  });
});
