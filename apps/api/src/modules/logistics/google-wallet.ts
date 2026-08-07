import { createSign, randomBytes } from "node:crypto";
import { config } from "../../config.js";
import { pool } from "../../db/pool.js";
import { NotFoundError, ServiceUnavailableError } from "../../lib/errors.js";
import { ensurePassRecord, type Purpose, resolvePassIdentity } from "./wallet-passes.js";

/**
 * Google Wallet (H28). Uses the "Generic" pass type — unlike Event Ticket
 * classes it needs no Google review/allowlisting — with the class AND
 * object embedded inline in the "Save to Google Wallet" JWT, so issuing a
 * pass needs zero REST calls (no service-account OAuth round trip). The
 * REST API + OAuth are only needed to push a state change on rotation.
 */

const WALLET_API_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";

function requireConfigured(): void {
  if (!config.googleWalletConfigured) {
    throw new ServiceUnavailableError(
      "Google Wallet is not configured (GOOGLE_WALLET_ISSUER_ID / GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL / GOOGLE_WALLET_PRIVATE_KEY_PEM)",
    );
  }
}

function decodePrivateKey(): string {
  return Buffer.from(config.GOOGLE_WALLET_PRIVATE_KEY_PEM!, "base64").toString("utf8");
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function signJwt(claims: Record<string, unknown>): string {
  const header = { alg: "RS256", typ: "JWT" };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(decodePrivateKey());
  return `${signingInput}.${base64url(signature)}`;
}

function classId(purpose: Purpose): string {
  return `${config.GOOGLE_WALLET_ISSUER_ID}.hackos_${purpose}`;
}

function genericClass(purpose: Purpose) {
  return { id: classId(purpose) };
}

function genericObject(
  objectId: string,
  purpose: Purpose,
  fullName: string,
  barcodeValue: string,
  state: "ACTIVE" | "EXPIRED" = "ACTIVE",
) {
  return {
    id: objectId,
    classId: classId(purpose),
    state,
    cardTitle: { defaultValue: { language: "en", value: "hackOS" } },
    header: {
      defaultValue: {
        language: "en",
        value: purpose === "ticket" ? "hackOS ticket" : "hackOS badge",
      },
    },
    subheader: { defaultValue: { language: "en", value: fullName } },
    hexBackgroundColor: "#1f2430",
    barcode: { type: "QR_CODE", value: barcodeValue },
  };
}

async function passContent(
  userId: number,
  purpose: Purpose,
): Promise<{ fullName: string; barcode: string }> {
  const { rows } = await pool.query(
    `SELECT u.name, u.surname, u.badge_id, t.token
       FROM users u
       LEFT JOIN tickets t ON t.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  );
  const u = rows[0];
  if (!u) throw new NotFoundError("User not found");
  return resolvePassIdentity(u, userId, purpose);
}

/**
 * Ensures a `wallet_passes` row (platform=google) and returns a "Save to
 * Google Wallet" link. Google upserts the class/object from the JWT payload
 * on save, so re-issuing after a rotation (fresh objectId, fresh row) just
 * works without deleting anything server-side.
 */
export async function buildGoogleSaveUrl(userId: number, purpose: Purpose): Promise<string> {
  requireConfigured();

  const objectId = `${config.GOOGLE_WALLET_ISSUER_ID}.${purpose}_${userId}_${randomBytes(6).toString("hex")}`;
  const pass = await ensurePassRecord(userId, purpose, "google", { googleObjectId: objectId });
  const { fullName, barcode } = await passContent(userId, purpose);

  const jwt = signJwt({
    iss: config.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    payload: {
      genericClasses: [genericClass(purpose)],
      genericObjects: [
        genericObject(pass.google_object_id ?? objectId, purpose, fullName, barcode),
      ],
    },
  });
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) return cachedToken.token;

  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt({
    iss: config.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL,
    scope: OAUTH_SCOPE,
    aud: OAUTH_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google OAuth token request failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.token;
}

/** Marks a Google Wallet object expired (H28: rotation invalidates the old pass). */
export async function expireGoogleObject(objectId: string): Promise<void> {
  requireConfigured();
  const token = await getAccessToken();
  const res = await fetch(`${WALLET_API_BASE}/genericObject/${objectId}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ state: "EXPIRED" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Wallet object update failed: ${res.status} ${body}`);
  }
}
