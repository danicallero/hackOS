import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  WalletArtworkScale,
  WalletArtworkSlot,
  WalletSettings,
} from "@hackos/shared/wallet-settings";
import { config } from "../../config.js";
import { pool, type Queryable } from "../../db/pool.js";
import { NotFoundError } from "../../lib/errors.js";
import { getObject } from "../../lib/storage.js";

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
export function deploymentDefaults(): Omit<WalletSettings, "artwork" | "artworkDefaults"> {
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
