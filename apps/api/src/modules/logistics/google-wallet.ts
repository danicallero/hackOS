import { createSign, randomBytes } from "node:crypto";
import { config } from "../../config.js";
import { pool } from "../../db/pool.js";
import { NotFoundError, ServiceUnavailableError } from "../../lib/errors.js";
import {
  ensureGooglePassRecord,
  type GoogleObjectType,
  type Purpose,
  resolvePassIdentity,
} from "./wallet-passes.js";

/**
 * Google Wallet (H28). Event tickets use Google's EventTicketClass and
 * EventTicketObject resources, embedded inline in the signed Save to Google
 * Wallet JWT. Badges remain Generic passes. Ticket classes are created and
 * approved separately; issuing a ticket embeds only the object in the JWT.
 * OAuth is used by the worker for class updates and expiration.
 */

const WALLET_API_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const ORGANIZATION_NAME = config.APPLE_PASS_ORGANIZATION;

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

function eventTicketClassId(): string {
  return (
    config.GOOGLE_WALLET_EVENT_TICKET_CLASS_ID ??
    `${config.GOOGLE_WALLET_ISSUER_ID}.hackos_event_ticket`
  );
}

function localized(value: string) {
  return { defaultValue: { language: "en-US", value } };
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
    cardTitle: localized("hackOS"),
    header: localized(purpose === "ticket" ? "hackOS ticket" : "hackOS badge"),
    subheader: localized(fullName),
    hexBackgroundColor: "#1f2430",
    barcode: { type: "QR_CODE", value: barcodeValue },
  };
}

interface GoogleEventConfig {
  name: string | null;
  venue_name: string | null;
  venue_latitude: number | null;
  venue_longitude: number | null;
  event_starts_at: string | Date | null;
  event_ends_at: string | Date | null;
  hacking_starts_at: string | Date | null;
  hacking_ends_at: string | Date | null;
}

async function readEventConfig(): Promise<GoogleEventConfig> {
  const { rows } = await pool.query(
    `SELECT name, venue_name, venue_latitude, venue_longitude,
            event_starts_at, event_ends_at, hacking_starts_at, hacking_ends_at
       FROM event_config WHERE id = 1`,
  );
  return (
    rows[0] ?? {
      name: null,
      venue_name: null,
      venue_latitude: null,
      venue_longitude: null,
      event_starts_at: null,
      event_ends_at: null,
      hacking_starts_at: null,
      hacking_ends_at: null,
    }
  );
}

function isoDate(value: string | Date | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function eventDateTime(event: GoogleEventConfig) {
  const doorsOpen = isoDate(event.event_starts_at);
  const start = isoDate(event.hacking_starts_at ?? event.event_starts_at);
  const end = isoDate(event.event_ends_at ?? event.hacking_ends_at);
  const startMs = start ? Date.parse(start) : null;
  const endMs = end ? Date.parse(end) : null;

  return {
    ...(doorsOpen ? { doorsOpen } : {}),
    ...(start ? { start } : {}),
    ...(start && end && startMs !== null && endMs !== null && endMs > startMs ? { end } : {}),
  };
}

function validTimeInterval(event: GoogleEventConfig) {
  const start = isoDate(event.event_starts_at ?? event.hacking_starts_at);
  const end = isoDate(event.event_ends_at ?? event.hacking_ends_at);
  const startMs = start ? Date.parse(start) : null;
  const endMs = end ? Date.parse(end) : null;
  if (!start || !end || startMs === null || endMs === null || endMs <= startMs) return {};
  return { validTimeInterval: { start: { date: start }, end: { date: end } } };
}

function eventTicketClass(event: GoogleEventConfig) {
  const eventName = event.name?.trim() || ORGANIZATION_NAME;
  const venueName = event.venue_name?.trim();
  const dateTime = eventDateTime(event);
  const hasLocation =
    event.venue_latitude !== null &&
    event.venue_longitude !== null &&
    Number.isFinite(event.venue_latitude) &&
    Number.isFinite(event.venue_longitude);

  return {
    id: eventTicketClassId(),
    eventName: localized(eventName),
    eventId: eventTicketClassId(),
    issuerName: ORGANIZATION_NAME,
    localizedIssuerName: localized(ORGANIZATION_NAME),
    reviewStatus: "UNDER_REVIEW",
    hexBackgroundColor: "#1f2430",
    ...(Object.keys(dateTime).length > 0 ? { dateTime } : {}),
    ...(venueName
      ? {
          textModulesData: [{ id: "venue", header: "Venue", body: venueName }],
        }
      : {}),
    // Google currently marks this legacy field as deprecated, but it remains
    // part of EventTicketClass and is the only location shape represented by
    // hackOS's existing venue model (name + coordinates).
    ...(hasLocation
      ? {
          locations: [{ latitude: event.venue_latitude, longitude: event.venue_longitude }],
        }
      : {}),
  };
}

function eventTicketObject(
  objectId: string,
  pass: { serial_number: string },
  fullName: string,
  barcodeValue: string,
  event: GoogleEventConfig,
) {
  return {
    id: objectId,
    classId: eventTicketClassId(),
    state: "ACTIVE",
    ticketHolderName: fullName,
    ticketNumber: pass.serial_number,
    ticketType: localized("Event ticket"),
    hexBackgroundColor: "#1f2430",
    barcode: { type: "QR_CODE", value: barcodeValue },
    ...validTimeInterval(event),
  };
}

async function passContent(
  userId: number,
  purpose: Purpose,
): Promise<{ fullName: string; barcode: string; event: GoogleEventConfig }> {
  const { rows } = await pool.query(
    `SELECT u.name, u.surname, u.badge_id, t.token
       FROM users u
       LEFT JOIN tickets t ON t.user_id = u.id
      WHERE u.id = $1 AND u.account_state = 'active' AND u.anonymized_at IS NULL`,
    [userId],
  );
  const u = rows[0];
  if (!u) throw new NotFoundError("User not found");
  return { ...resolvePassIdentity(u, userId, purpose), event: await readEventConfig() };
}

/**
 * Ensures a `wallet_passes` row (platform=google) and returns a "Save to
 * Google Wallet" link. The approved Event Ticket class is referenced by ID;
 * the per-user object is carried by the signed JWT.
 */
export async function buildGoogleSaveUrl(userId: number, purpose: Purpose): Promise<string> {
  requireConfigured();

  const googleObjectType: GoogleObjectType = purpose === "ticket" ? "event_ticket" : "generic";
  const objectId = `${config.GOOGLE_WALLET_ISSUER_ID}.${purpose}_${randomBytes(16).toString("hex")}`;
  const { pass, retiredPassIds } = await ensureGooglePassRecord(
    userId,
    purpose,
    objectId,
    googleObjectType,
  );
  if (retiredPassIds.length > 0) {
    const { enqueueWalletSync } = await import("./wallet-sync.js");
    await enqueueWalletSync(retiredPassIds);
  }
  const { fullName, barcode, event } = await passContent(userId, purpose);

  const payload =
    purpose === "ticket"
      ? {
          // The Event Ticket class is created and approved in the Pay &
          // Wallet Console (or patched through the REST API). Referencing an
          // existing class keeps the save JWT compact and avoids asking
          // Google to create a class with an incorrect/legacy ID.
          eventTicketObjects: [
            eventTicketObject(pass.google_object_id ?? objectId, pass, fullName, barcode, event),
          ],
        }
      : {
          genericClasses: [genericClass(purpose)],
          genericObjects: [
            genericObject(pass.google_object_id ?? objectId, purpose, fullName, barcode),
          ],
        };

  const jwt = signJwt({
    iss: config.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    origins: [new URL(config.WEB_URL).origin],
    payload,
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

/**
 * Updates the shared EventTicketClass. Google propagates class changes to all
 * saved EventTicketObjects, so one PATCH is enough for an event-wide edit.
 * A class may not exist yet when a user only generated a link but did not save
 * it; that 404 is harmless and is intentionally treated as a no-op.
 */
export async function refreshGoogleEventTicketClass(): Promise<void> {
  requireConfigured();
  const token = await getAccessToken();
  const res = await fetch(`${WALLET_API_BASE}/eventTicketClass/${eventTicketClassId()}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(eventTicketClass(await readEventConfig())),
  });
  if (res.status === 404) return;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Wallet event ticket class update failed: ${res.status} ${body}`);
  }
}

/** Marks a Google Wallet object expired (H28: rotation invalidates the old pass). */
export async function expireGoogleObject(
  objectId: string,
  objectType: GoogleObjectType = "generic",
): Promise<void> {
  requireConfigured();
  const token = await getAccessToken();
  const resource = objectType === "event_ticket" ? "eventTicketObject" : "genericObject";
  const res = await fetch(`${WALLET_API_BASE}/${resource}/${encodeURIComponent(objectId)}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ state: "EXPIRED" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Wallet object update failed: ${res.status} ${body}`);
  }
}
