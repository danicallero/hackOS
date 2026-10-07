import { createSign, randomBytes } from "node:crypto";
import {
  type PassFieldLabels,
  type PassFieldVisibility,
  resolvePassFieldLabels,
  resolvePassFieldVisibility,
} from "@hackos/shared/wallet-pass-labels";
import {
  WALLET_ACTION_LABELS,
  type WalletAlert,
  type WalletSettings,
} from "@hackos/shared/wallet-settings";
import { config } from "../../config.js";
import { pool } from "../../db/pool.js";
import { NotFoundError, ServiceUnavailableError } from "../../lib/errors.js";
import { getHighestVisibleRoleName } from "../identity/role.js";
import {
  ensureGooglePassRecord,
  type GoogleObjectType,
  type Purpose,
  resolvePassIdentity,
} from "./wallet-passes.js";
import { readWalletSettings, safeWalletLink, venueDirections } from "./wallet-settings.js";

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
  const suffix = config.NODE_ENV === "production" ? "" : "_staging";
  return `${config.GOOGLE_WALLET_ISSUER_ID}.hackos_${purpose}${suffix}`;
}

function eventTicketClassId(): string {
  const suffix = config.NODE_ENV === "production" ? "" : "_staging";
  return (
    config.GOOGLE_WALLET_EVENT_TICKET_CLASS_ID ??
    `${config.GOOGLE_WALLET_ISSUER_ID}.hackos_event_ticket${suffix}`
  );
}

function localized(value: string) {
  return { defaultValue: { language: "en-US", value } };
}

function walletImage(uri: string | undefined, description: string) {
  const value = uri?.trim();
  return value ? { sourceUri: { uri: value, description } } : undefined;
}

function templateItem(fieldPath: string) {
  return { firstValue: { fields: [{ fieldPath }] } };
}

function customTextModules(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}
function mergeTextModules<T extends { id: string }>(
  base: T[],
  extra: unknown,
): Record<string, unknown>[] {
  const modules: Record<string, unknown>[] = [...base];
  for (const item of customTextModules(extra)) {
    const index = modules.findIndex((module) => module.id === item.id);
    if (index >= 0) modules[index] = { ...modules[index], ...item };
    else modules.push(item);
  }
  return modules;
}

function genericClass(purpose: Purpose) {
  return { id: classId(purpose) };
}

interface GoogleEventConfig {
  name: string | null;
  pass_back_fields: { label: string; value: string }[];
  pass_field_labels: PassFieldLabels;
  pass_field_visibility: PassFieldVisibility;
  settings: WalletSettings;
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
    `SELECT name, pass_back_fields, pass_field_labels, pass_field_visibility, venue_name, venue_latitude, venue_longitude,
            event_starts_at, event_ends_at, hacking_starts_at, hacking_ends_at
       FROM event_config WHERE id = 1`,
  );
  return {
    ...(rows[0] ?? {
      name: null,
      pass_back_fields: [],
      pass_field_labels: {},
      pass_field_visibility: {},
      venue_name: null,
      venue_latitude: null,
      venue_longitude: null,
      event_starts_at: null,
      event_ends_at: null,
      hacking_starts_at: null,
      hacking_ends_at: null,
    }),
    settings: await readWalletSettings(),
  };
}

function isoDate(value: string | Date | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function eventDateTime(event: GoogleEventConfig) {
  const doorsOpen = isoDate(event.event_starts_at);
  const start = isoDate(event.event_starts_at ?? event.hacking_starts_at);
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
  const logo = walletImage(
    event.settings.artwork.googleLogo?.url ?? config.GOOGLE_WALLET_LOGO_URL,
    "GPUL logo",
  );
  const heroImage = walletImage(
    event.settings.artwork.googleHero?.url ?? config.GOOGLE_WALLET_HERO_IMAGE_URL,
    `${eventName} artwork`,
  );
  const wideLogo = walletImage(
    event.settings.artwork.googleWideLogo?.url ?? config.GOOGLE_WALLET_WIDE_LOGO_URL,
    `${eventName} wide logo`,
  );
  const hasLocation =
    event.venue_latitude !== null &&
    event.venue_longitude !== null &&
    Number.isFinite(event.venue_latitude) &&
    Number.isFinite(event.venue_longitude);

  const visible = resolvePassFieldVisibility(event.pass_field_visibility);
  const paths = Object.entries(visible)
    .filter(([, shown]) => shown)
    .map(([key]) => `object.textModulesData['${key}']`);
  const cardRowTemplateInfos = [];
  for (let i = 0; i < paths.length; i += 2)
    cardRowTemplateInfos.push(
      paths[i + 1]
        ? { twoItems: { startItem: templateItem(paths[i]!), endItem: templateItem(paths[i + 1]!) } }
        : { oneItem: { item: templateItem(paths[i]!) } },
    );
  // Google rejects a card template with more than three rows. Remaining
  // visible fields still appear in the details template below.
  cardRowTemplateInfos.length = Math.min(cardRowTemplateInfos.length, 3);
  const detailsItemInfos = [
    ...(dateTime.start ? [{ item: templateItem("class.dateTime.start") }] : []),
    ...(dateTime.end ? [{ item: templateItem("class.dateTime.end") }] : []),
    ...(venueName ? [{ item: templateItem("class.venue.name") }] : []),
    ...paths.map((path) => ({ item: templateItem(path) })),
    ...googleBackModules(event).map((module) => ({
      item: templateItem(`class.textModulesData['${module.id}']`),
    })),
    ...customTextModules(event.settings.googleClassOptions.textModulesData)
      .filter((module) => typeof module.id === "string" && /^[A-Za-z0-9_-]+$/.test(module.id))
      .map((module) => ({ item: templateItem(`class.textModulesData['${module.id}']`) })),
    ...googleLinks(event, "en").map((link) => ({
      item: templateItem(`object.linksModuleData.uris['${link.id}']`),
    })),
    { item: templateItem("object.ticketNumber") },
  ];

  return {
    id: eventTicketClassId(),
    eventName: localized(eventName),
    eventId: eventTicketClassId(),
    issuerName: ORGANIZATION_NAME,
    reviewStatus: "UNDER_REVIEW",
    hexBackgroundColor: event.settings.backgroundColor,
    countryCode: "ES",
    linksModuleData: { uris: [] },
    appLinkData: googleAppLink(event.settings),
    dateTime: Object.keys(dateTime).length > 0 ? dateTime : null,
    // EventVenue is what the built-in Wallet template reads for the title and
    // detail sections. The event settings currently store a venue name (not a
    // postal address), so use that value as the required address fallback
    // until a separate postal-address field is introduced.
    venue: venueName ? { name: localized(venueName), address: localized(venueName) } : null,
    logo: logo ?? null,
    heroImage: heroImage ?? null,
    wideLogo: wideLogo ?? null,
    classTemplateInfo: {
      cardTemplateOverride: { cardRowTemplateInfos },
      detailsTemplateOverride: { detailsItemInfos },
    },
    // Google currently marks this legacy field as deprecated, but it remains
    // part of EventTicketClass and is the only location shape represented by
    // hackOS's existing venue model (name + coordinates).
    locations: hasLocation
      ? [{ latitude: event.venue_latitude, longitude: event.venue_longitude }]
      : [],
    ...event.settings.googleClassOptions,
    localizedIssuerName:
      event.settings.googleClassOptions.localizedIssuerName ??
      localized(
        typeof event.settings.googleClassOptions.issuerName === "string"
          ? event.settings.googleClassOptions.issuerName
          : ORGANIZATION_NAME,
      ),
    textModulesData: mergeTextModules(
      googleBackModules(event),
      event.settings.googleClassOptions.textModulesData,
    ),
  };
}

interface GooglePassContent {
  fullName: string;
  barcode: string;
  event: GoogleEventConfig;
  role: string;
  university: string | null;
  email: string;
  language: string;
}
function googleBackModules(event: GoogleEventConfig) {
  const labels = resolvePassFieldLabels(event.pass_field_labels);
  const fields = [
    { label: labels.event, value: event.name?.trim() || ORGANIZATION_NAME },
    ...(event.venue_name ? [{ label: labels.location, value: event.venue_name }] : []),
    ...event.pass_back_fields.filter((field) => !safeWalletLink(field.value)),
    { label: labels.organizedBy, value: ORGANIZATION_NAME },
  ];
  // H28: Google displays at most ten text modules per class/object. Keep every
  // configured field; group overflow into the final details block.
  const modules = fields
    .slice(0, 9)
    .map((field, i) => ({ id: `back_${i}`, header: field.label, body: field.value }));
  if (fields.length > 9)
    modules.push({
      id: "back_more",
      header: fields[9]!.label,
      body: fields
        .slice(9)
        .map((field) => `${field.label}: ${field.value}`)
        .join("\n\n"),
    });
  return modules;
}
function googleLinks(event: GoogleEventConfig, language: string) {
  const labels =
    WALLET_ACTION_LABELS[language as keyof typeof WALLET_ACTION_LABELS] ?? WALLET_ACTION_LABELS.en;
  const directions = event.settings.showDirections
    ? venueDirections(event.venue_latitude, event.venue_longitude, event.venue_name, "google")
    : null;
  return [
    ...(directions ? [{ id: "directions", uri: directions, description: labels.directions }] : []),
    { id: "website", uri: event.settings.websiteUrl, description: labels.website },
    { id: "android_app", uri: event.settings.androidStoreUrl, description: "Google Play" },
    ...(event.settings.showSchedule
      ? [{ id: "schedule", uri: event.settings.scheduleUrl, description: labels.schedule }]
      : []),
    ...event.pass_back_fields.flatMap((field, i) => {
      const uri = safeWalletLink(field.value);
      return uri ? [{ id: `custom_${i}`, uri, description: field.label }] : [];
    }),
  ];
}
function googleAppLink(settings: WalletSettings) {
  return {
    androidAppLinkInfo: { appTarget: { packageName: settings.androidPackageName } },
    webAppLinkInfo: {
      appTarget: { targetUri: { uri: settings.websiteUrl, description: "Open hackOS" } },
    },
    displayText: localized("Open hackOS"),
  };
}
function personalModules(content: GooglePassContent, purpose: Purpose) {
  const labels = resolvePassFieldLabels(content.event.pass_field_labels);
  const visible = resolvePassFieldVisibility(content.event.pass_field_visibility);
  const values = {
    participant: content.fullName,
    role: content.role,
    passType: purpose === "ticket" ? labels.ticketValue : labels.badgeValue,
    university: content.university,
    email: content.email,
  };
  return Object.entries(values).flatMap(([key, value]) =>
    visible[key as keyof typeof visible] && value
      ? [{ id: key, header: labels[key as keyof typeof labels], body: value }]
      : [],
  );
}
function eventTicketObject(
  objectId: string,
  pass: { serial_number: string },
  content: GooglePassContent,
) {
  const visible = resolvePassFieldVisibility(content.event.pass_field_visibility);
  const labels = resolvePassFieldLabels(content.event.pass_field_labels);
  return {
    id: objectId,
    classId: eventTicketClassId(),
    state: "ACTIVE",
    ...(visible.participant && content.fullName ? { ticketHolderName: content.fullName } : {}),
    ticketNumber: pass.serial_number,
    ...(visible.passType && labels.ticketValue.trim()
      ? { ticketType: localized(labels.ticketValue) }
      : {}),
    hexBackgroundColor: content.event.settings.backgroundColor,
    linksModuleData: { uris: googleLinks(content.event, content.language) },
    barcode: { type: "QR_CODE", value: content.barcode },
    validTimeInterval: validTimeInterval(content.event).validTimeInterval ?? null,
    appLinkData: googleAppLink(content.event.settings),
    imageModulesData: content.event.settings.artwork.googleDetail
      ? [
          {
            id: "detail_image",
            mainImage: walletImage(
              content.event.settings.artwork.googleDetail.url,
              "Event details",
            ),
          },
        ]
      : [],
    ...content.event.settings.googleObjectOptions,
    textModulesData: mergeTextModules(
      personalModules(content, "ticket"),
      content.event.settings.googleObjectOptions.textModulesData,
    ),
  };
}
function genericObject(objectId: string, purpose: Purpose, content: GooglePassContent) {
  const labels = resolvePassFieldLabels(content.event.pass_field_labels);
  return {
    id: objectId,
    classId: classId(purpose),
    state: "ACTIVE",
    cardTitle: localized(content.event.name?.trim() || ORGANIZATION_NAME),
    header: localized(purpose === "ticket" ? labels.ticketValue : labels.badgeValue),
    hexBackgroundColor: content.event.settings.backgroundColor,
    linksModuleData: { uris: googleLinks(content.event, content.language) },
    logo:
      walletImage(
        content.event.settings.artwork.googleLogo?.url ?? config.GOOGLE_WALLET_LOGO_URL,
        "Logo",
      ) ?? null,
    heroImage:
      walletImage(
        content.event.settings.artwork.googleHero?.url ?? config.GOOGLE_WALLET_HERO_IMAGE_URL,
        "Event artwork",
      ) ?? null,
    barcode: { type: "QR_CODE", value: content.barcode },
    appLinkData: googleAppLink(content.event.settings),
    imageModulesData: content.event.settings.artwork.googleDetail
      ? [
          {
            id: "detail_image",
            mainImage: walletImage(
              content.event.settings.artwork.googleDetail.url,
              "Event details",
            ),
          },
        ]
      : [],
    ...content.event.settings.googleObjectOptions,
    textModulesData: mergeTextModules(
      personalModules(content, purpose),
      content.event.settings.googleObjectOptions.textModulesData,
    ),
  };
}
async function passContent(userId: number, purpose: Purpose): Promise<GooglePassContent> {
  const { rows } = await pool.query(
    `SELECT u.name, u.surname, u.badge_id, un.name AS university, u.email, u.language, t.token
    FROM users u LEFT JOIN tickets t ON t.user_id=u.id LEFT JOIN universities un ON un.id=u.university_id WHERE u.id=$1 AND u.account_state='active' AND u.anonymized_at IS NULL`,
    [userId],
  );
  const user = rows[0];
  if (!user) throw new NotFoundError("User not found");
  return {
    ...resolvePassIdentity(user, userId, purpose),
    university: user.university,
    email: user.email,
    language: user.language,
    role: (await getHighestVisibleRoleName(pool, userId)) ?? "Unassigned",
    event: await readEventConfig(),
  };
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
  const content = await passContent(userId, purpose);

  // H28: materialize full content through REST, then sign an ID-only JWT so
  // custom fields/artwork cannot exceed Google's recommended URL length.
  await refreshGooglePassObject(pass, content);
  const payload =
    purpose === "ticket"
      ? { eventTicketObjects: [{ id: pass.google_object_id ?? objectId }] }
      : { genericObjects: [{ id: pass.google_object_id ?? objectId }] };

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
  const { reviewStatus: _reviewStatus, ...body } = eventTicketClass(await readEventConfig());
  const url = `${WALLET_API_BASE}/eventTicketClass/${eventTicketClassId()}`;
  const request = (payload: unknown) =>
    fetch(url, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  let res = await request(body);
  if (res.status === 404) return;
  if (!res.ok) {
    const responseBody = await res.text().catch(() => "");
    if (
      res.status === 400 &&
      /invalid review status/i.test(responseBody) &&
      /approved/i.test(responseBody)
    ) {
      res = await request({ ...body, reviewStatus: "UNDER_REVIEW" });
      if (res.ok) return;
      const retryBody = await res.text().catch(() => "");
      throw new Error(`Google Wallet event ticket class update failed: ${res.status} ${retryBody}`);
    }
    throw new Error(
      `Google Wallet event ticket class update failed: ${res.status} ${responseBody}`,
    );
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

export async function refreshGooglePassObject(
  pass: {
    google_object_id: string | null;
    google_object_type: GoogleObjectType | null;
    user_id: number;
    purpose: Purpose;
    serial_number: string;
  },
  content?: GooglePassContent,
): Promise<void> {
  requireConfigured();
  if (!pass.google_object_id) return;
  const data = content ?? (await passContent(pass.user_id, pass.purpose));
  if (pass.google_object_type === "event_ticket") {
    // The approved class belongs to this deployment; refresh before issuance.
    if (content) await refreshGoogleEventTicketClass();
    await upsertGoogleResource(
      "eventTicketObject",
      pass.google_object_id,
      eventTicketObject(pass.google_object_id, pass, data),
    );
  } else {
    await upsertGoogleResource("genericClass", classId(pass.purpose), {
      ...genericClass(pass.purpose),
      ...data.event.settings.googleClassOptions,
      textModulesData: mergeTextModules(
        googleBackModules(data.event),
        data.event.settings.googleClassOptions.textModulesData,
      ),
    });
    await upsertGoogleResource(
      "genericObject",
      pass.google_object_id,
      genericObject(pass.google_object_id, pass.purpose, data),
    );
  }
}
async function upsertGoogleResource(resource: string, id: string, body: unknown): Promise<void> {
  const token = await getAccessToken();
  const options = {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  };
  let response = await fetch(`${WALLET_API_BASE}/${resource}/${encodeURIComponent(id)}`, {
    ...options,
    method: "PATCH",
  });
  if (response.status === 404) {
    // Null clears a field on PATCH, but optional nulls are omitted when a new
    // object is inserted. Keep the same content source for both requests.
    const insertBody = Object.fromEntries(
      Object.entries(body as Record<string, unknown>).filter(([, value]) => value !== null),
    );
    response = await fetch(`${WALLET_API_BASE}/${resource}`, {
      ...options,
      method: "POST",
      body: JSON.stringify(insertBody),
    });
  }
  if (!response.ok)
    throw new Error(
      `Google Wallet ${resource} update failed: ${response.status} ${await response.text()}`,
    );
}
export async function sendGoogleWalletAlert(
  objectId: string,
  objectType: GoogleObjectType,
  messageId: string,
  alert: WalletAlert[keyof WalletAlert],
): Promise<void> {
  requireConfigured();
  const token = await getAccessToken();
  const resource = objectType === "event_ticket" ? "eventTicketObject" : "genericObject";
  const url = `${WALLET_API_BASE}/${resource}/${encodeURIComponent(objectId)}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  // H28: a retry after an interrupted response must not duplicate an alert.
  const current = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!current.ok) throw new Error(`Google Wallet alert lookup failed: ${current.status}`);
  const saved = (await current.json()) as { messages?: { id?: string }[] };
  if (saved.messages?.some((message) => message.id === messageId)) return;
  const response = await fetch(`${url}/addMessage`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      message: {
        id: messageId,
        header: alert.title,
        body: alert.body,
        messageType: "TEXT_AND_NOTIFY",
      },
    }),
  });
  if (!response.ok)
    throw new Error(`Google Wallet alert failed: ${response.status} ${await response.text()}`);
}
