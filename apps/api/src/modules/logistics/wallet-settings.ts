import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  WALLET_ARTWORK_DIMENSIONS,
  type WalletArtworkScale,
  type WalletArtworkSlot,
  type WalletSettings,
} from "@hackos/shared/wallet-settings";
import sharp from "sharp";
import { config } from "../../config.js";
import { pool, type Queryable, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { getObject, putObject } from "../../lib/storage.js";
import { isSyntheticOperator } from "./review-fixture-scope.js";
import { bumpAllAppleWalletUpdateTags, listActiveWalletPassIds } from "./wallet-passes.js";
import { enqueueWalletSync } from "./wallet-sync.js";

export function artworkUrl(id: string, scale = 1): string {
  return `${config.BETTER_AUTH_URL}/api/wallet/artwork/${id}/${scale}.png`;
}
const BUNDLED_APPLE_ARTWORK = {
  appleIcon: { 1: "icon.png", 2: "icon@2x.png", 3: "icon@3x.png" },
  appleLogo: { 1: "logo.png", 2: "logo@2x.png" },
  appleStrip: { 1: "strip.png", 2: "strip@2x.png", 3: "strip@3x.png" },
} as const;
export type BundledAppleArtworkSlot = keyof typeof BUNDLED_APPLE_ARTWORK;
export function bundledAppleArtworkUrl(slot: BundledAppleArtworkSlot, scale: WalletArtworkScale) {
  return `${config.BETTER_AUTH_URL}/api/wallet/artwork/default/${slot}/${scale}.png`;
}
export async function readBundledAppleArtwork(
  slot: BundledAppleArtworkSlot,
  scale: WalletArtworkScale,
): Promise<Buffer> {
  const file = (BUNDLED_APPLE_ARTWORK[slot] as Partial<Record<WalletArtworkScale, string>>)[scale];
  if (!file) throw new NotFoundError("Artwork not found");
  return readFile(join(process.cwd(), "assets", "apple-wallet", file));
}
function defaultArtwork(): WalletSettings["artworkDefaults"] {
  const defaults: WalletSettings["artworkDefaults"] = {};
  for (const slot of Object.keys(BUNDLED_APPLE_ARTWORK) as BundledAppleArtworkSlot[]) {
    const variants: Partial<Record<WalletArtworkScale, string>> = {};
    for (const scale of [1, 2, 3] as const) {
      if (scale in BUNDLED_APPLE_ARTWORK[slot])
        variants[scale] = bundledAppleArtworkUrl(slot, scale);
    }
    defaults[slot] = { url: variants[1]!, variants };
  }
  for (const [slot, url] of [
    ["googleLogo", config.GOOGLE_WALLET_LOGO_URL],
    ["googleWideLogo", config.GOOGLE_WALLET_WIDE_LOGO_URL],
    ["googleHero", config.GOOGLE_WALLET_HERO_IMAGE_URL],
  ] as const) {
    if (url) defaults[slot] = { url, variants: { 1: url } };
  }
  return defaults;
}
export async function ensureWalletSettings(db: Queryable): Promise<void> {
  await db.query(`INSERT INTO wallet_settings(id) VALUES (1) ON CONFLICT DO NOTHING`);
}
function envJson(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
function sixDigitHex(value: string): string {
  return value.length === 4
    ? `#${[...value.slice(1)].map((digit) => digit + digit).join("")}`
    : value;
}
function deploymentDefaults(): Omit<WalletSettings, "artwork" | "artworkDefaults"> {
  return {
    backgroundColor: sixDigitHex(config.GOOGLE_WALLET_BACKGROUND_COLOR ?? "#a3d5ff"),
    foregroundColor: sixDigitHex(config.WALLET_FOREGROUND_COLOR),
    labelColor: sixDigitHex(config.WALLET_LABEL_COLOR),
    websiteUrl: config.WALLET_WEBSITE_URL,
    showDirections: config.WALLET_SHOW_DIRECTIONS === "true",
    showSchedule: config.WALLET_SHOW_SCHEDULE === "true",
    scheduleUrl: config.WALLET_SCHEDULE_URL ?? `${config.MOBILE_APP_SCHEME}:///schedule`,
    appleAppStoreId: config.APPLE_PASS_APP_STORE_ID ?? null,
    androidPackageName: config.WALLET_ANDROID_PACKAGE_NAME,
    androidStoreUrl: config.WALLET_ANDROID_STORE_URL,
    appleOptions: envJson(config.WALLET_APPLE_OPTIONS_JSON),
    googleClassOptions: envJson(config.WALLET_GOOGLE_CLASS_OPTIONS_JSON),
    googleObjectOptions: envJson(config.WALLET_GOOGLE_OBJECT_OPTIONS_JSON),
  };
}
export async function readWalletSettings(db: Queryable = pool): Promise<WalletSettings> {
  const { rows } = await db.query(`SELECT * FROM wallet_settings WHERE id = 1`);
  const row = rows[0];
  const defaults = deploymentDefaults();
  const artwork: WalletSettings["artwork"] = {};
  for (const [slot, id] of Object.entries(row?.artwork ?? {})) {
    if (typeof id === "string") {
      const variants: Partial<Record<WalletArtworkScale, string>> = { 1: artworkUrl(id) };
      if (slot.startsWith("apple")) {
        variants[2] = artworkUrl(id, 2);
        variants[3] = artworkUrl(id, 3);
      }
      artwork[slot as WalletArtworkSlot] = { id, url: artworkUrl(id), variants };
    }
  }
  return {
    backgroundColor: row?.background_color ?? defaults.backgroundColor,
    foregroundColor: row?.foreground_color ?? defaults.foregroundColor,
    labelColor: row?.label_color ?? defaults.labelColor,
    websiteUrl: row?.website_url ?? defaults.websiteUrl,
    showDirections: row?.show_directions ?? defaults.showDirections,
    showSchedule: row?.show_schedule ?? defaults.showSchedule,
    scheduleUrl: row?.schedule_url ?? defaults.scheduleUrl,
    appleAppStoreId:
      row?.apple_app_store_id == null ? defaults.appleAppStoreId : Number(row.apple_app_store_id),
    androidPackageName: row?.android_package_name ?? defaults.androidPackageName,
    androidStoreUrl: row?.android_store_url ?? defaults.androidStoreUrl,
    appleOptions: row?.apple_options ?? defaults.appleOptions,
    googleClassOptions: row?.google_class_options ?? defaults.googleClassOptions,
    googleObjectOptions: row?.google_object_options ?? defaults.googleObjectOptions,
    artwork,
    artworkDefaults: defaultArtwork(),
  };
}

async function assertRealOperator(actorId: number): Promise<void> {
  if (await isSyntheticOperator(pool, actorId))
    throw new BadRequestError("Review accounts cannot change event-wide Wallet settings");
}
export async function syncWalletSettings(): Promise<void> {
  const ids = await listActiveWalletPassIds();
  await enqueueWalletSync(ids, "refresh");
}
export async function saveWalletSettings(
  actorId: number,
  settings: Omit<WalletSettings, "artwork" | "artworkDefaults">,
): Promise<WalletSettings> {
  await assertRealOperator(actorId);
  const defaults = deploymentDefaults();
  const inherit = <T>(value: T, fallback: T): T | null =>
    JSON.stringify(value) === JSON.stringify(fallback) ? null : value;
  await withTransaction(async (client) => {
    await ensureWalletSettings(client);
    const { rows } = await client.query(`SELECT * FROM wallet_settings WHERE id = 1 FOR UPDATE`);
    await client.query(
      `UPDATE wallet_settings SET background_color=$1, foreground_color=$2, label_color=$3,
      website_url=$4, show_directions=$5, show_schedule=$6,
      schedule_url=$7,apple_app_store_id=$8,android_package_name=$9,android_store_url=$10,
      apple_options=$11,google_class_options=$12,google_object_options=$13 WHERE id=1`,
      [
        inherit(settings.backgroundColor, defaults.backgroundColor),
        inherit(settings.foregroundColor, defaults.foregroundColor),
        inherit(settings.labelColor, defaults.labelColor),
        inherit(settings.websiteUrl, defaults.websiteUrl),
        inherit(settings.showDirections, defaults.showDirections),
        inherit(settings.showSchedule, defaults.showSchedule),
        inherit(settings.scheduleUrl, defaults.scheduleUrl),
        inherit(settings.appleAppStoreId, defaults.appleAppStoreId),
        inherit(settings.androidPackageName, defaults.androidPackageName),
        inherit(settings.androidStoreUrl, defaults.androidStoreUrl),
        inherit(settings.appleOptions, defaults.appleOptions),
        inherit(settings.googleClassOptions, defaults.googleClassOptions),
        inherit(settings.googleObjectOptions, defaults.googleObjectOptions),
      ],
    );
    await audit(client, {
      actorId,
      entityType: "wallet_settings",
      entityId: 1,
      action: "updated",
      before: rows[0],
      after: settings,
    });
    await bumpAllAppleWalletUpdateTags(client);
  });
  await syncWalletSettings();
  return readWalletSettings();
}
export async function resetWalletSettings(actorId: number): Promise<WalletSettings> {
  await assertRealOperator(actorId);
  await withTransaction(async (client) => {
    await ensureWalletSettings(client);
    const { rows } = await client.query(`SELECT * FROM wallet_settings WHERE id=1 FOR UPDATE`);
    await client.query(`UPDATE wallet_settings SET
      background_color=NULL, foreground_color=NULL, label_color=NULL,
      website_url=NULL, show_directions=NULL, show_schedule=NULL,
      schedule_url=NULL, apple_app_store_id=NULL, android_package_name=NULL,
      android_store_url=NULL, apple_options=NULL, google_class_options=NULL,
      google_object_options=NULL WHERE id=1`);
    await audit(client, {
      actorId,
      entityType: "wallet_settings",
      entityId: 1,
      action: "reset_to_environment",
      before: rows[0],
    });
    await bumpAllAppleWalletUpdateTags(client);
  });
  await syncWalletSettings();
  return readWalletSettings();
}
export async function uploadWalletArtwork(
  actorId: number,
  slot: WalletArtworkSlot,
  input: Buffer | Partial<Record<WalletArtworkScale, Buffer>>,
): Promise<WalletSettings> {
  await assertRealOperator(actorId);
  const files = Buffer.isBuffer(input) ? { 1: input } : input;
  const id = randomUUID();
  const { width, height } = WALLET_ARTWORK_DIMENSIONS[slot];
  const scales = slot.startsWith("apple") ? ([1, 2, 3] as const) : ([1] as const);
  const sources = Object.entries(files)
    .map(([scale, bytes]) => ({ scale: Number(scale) as WalletArtworkScale, bytes }))
    .filter((item): item is { scale: WalletArtworkScale; bytes: Buffer } => !!item.bytes);
  if (!sources.length || (!slot.startsWith("apple") && sources.some((item) => item.scale !== 1)))
    throw new BadRequestError("Choose an image");
  const normalized: { scale: number; bytes: Buffer }[] = [];
  try {
    for (const source of sources) {
      const metadata = await sharp(source.bytes, { limitInputPixels: 20_000_000 }).metadata();
      if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1)
        throw new Error("Unsupported image");
    }
    const fallback = sources.reduce((best, source) => (source.scale > best.scale ? source : best));
    for (const scale of scales) {
      const bytes = files[scale] ?? fallback.bytes;
      normalized.push({
        scale,
        bytes: await sharp(bytes, { limitInputPixels: 20_000_000 })
          .rotate()
          .resize(width * scale, height * scale, {
            fit: slot.endsWith("Strip") || slot.endsWith("Hero") ? "cover" : "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png()
          .toBuffer(),
      });
    }
  } catch {
    throw new BadRequestError("Upload a PNG, JPEG, or WebP image under 5 MB and 20 megapixels");
  }
  for (const image of normalized)
    await putObject(`wallet/${id}/${image.scale}.png`, image.bytes, "image/png");
  await withTransaction(async (client) => {
    await ensureWalletSettings(client);
    await client.query(`SELECT id FROM wallet_settings WHERE id=1 FOR UPDATE`);
    await client.query(`INSERT INTO wallet_artwork(id, slot) VALUES ($1,$2)`, [id, slot]);
    await client.query(
      `UPDATE wallet_settings SET artwork=jsonb_set(artwork, ARRAY[$1]::text[], to_jsonb($2::text)) WHERE id=1`,
      [slot, id],
    );
    await audit(client, {
      actorId,
      entityType: "wallet_artwork",
      entityId: id,
      action: "uploaded",
      after: { slot, suppliedScales: sources.map((source) => source.scale) },
    });
    await bumpAllAppleWalletUpdateTags(client);
  });
  await syncWalletSettings();
  return readWalletSettings();
}
export async function resetWalletArtwork(
  actorId: number,
  slot: WalletArtworkSlot,
): Promise<WalletSettings> {
  await assertRealOperator(actorId);
  await withTransaction(async (client) => {
    await client.query(`UPDATE wallet_settings SET artwork=artwork-$1 WHERE id=1`, [slot]);
    await audit(client, {
      actorId,
      entityType: "wallet_settings",
      entityId: 1,
      action: "artwork_reset",
      after: { slot },
    });
    await bumpAllAppleWalletUpdateTags(client);
  });
  await syncWalletSettings();
  return readWalletSettings();
}
export async function readWalletArtwork(id: string, scale: number): Promise<Buffer> {
  const { rows } = await pool.query(`SELECT slot FROM wallet_artwork WHERE id=$1`, [id]);
  if (!rows[0] || (scale !== 1 && !rows[0].slot.startsWith("apple")))
    throw new NotFoundError("Artwork not found");
  const object = await getObject(`wallet/${id}/${scale}.png`);
  if (!object.Body) throw new NotFoundError("Artwork not found");
  return Buffer.from(await object.Body.transformToByteArray());
}
export function hexToRgb(hex: string): string {
  return `rgb(${[1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(",")})`;
}
export function safeWalletLink(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export function venueDirections(
  latitude: number | null,
  longitude: number | null,
  name: string | null,
  platform: "apple" | "google",
): string | null {
  const destination =
    latitude !== null && longitude !== null ? `${latitude},${longitude}` : name?.trim();
  if (!destination) return null;
  return platform === "apple"
    ? `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
