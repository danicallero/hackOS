"use client";

import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { LinkedinLogoIcon } from "@phosphor-icons/react/dist/csr/LinkedinLogo";
import { ShareNetworkIcon } from "@phosphor-icons/react/dist/csr/ShareNetwork";
import { XLogoIcon } from "@phosphor-icons/react/dist/csr/XLogo";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { apiAssetUrl } from "@/lib/directory";
import { saveBlob } from "@/lib/download";
import { useLocale } from "@/lib/i18n";
import { initials } from "@/lib/initials";
import { toast } from "@/lib/toast";
import type { Language } from "@/lib/types";
import { cn } from "@/lib/utils";
import copyFragments from "./social-sharing.locales.json";

/**
 * Personalised "I'm going" share card. The PNG is drawn in the browser from
 * the attendee's own name and (optionally) photo plus the shipped brand
 * artwork under `/onboarding`; nothing is sent to an image service, no URL
 * carrying a token is shared, and every action (download, copy, share) needs
 * an explicit click. LinkedIn and X cannot receive an image from a link, so
 * their buttons only prefill the caption and the UI says to attach the file.
 */

export interface SocialSharingEvent {
  name: string;
  year: number | string;
  /** Shown only when the event provides it; never derived or invented. */
  dateLabel?: string;
  location?: string;
  /**
   * Public event page. Added to the caption and shown on the image as its
   * host. Only http(s) is accepted; query and fragment are dropped so no
   * token or tracking parameter can travel with it.
   */
  url?: string;
  /** Same-origin or CORS-enabled image; the bundled HackUDC wordmark is the fallback. */
  logo?: string;
}

export interface SocialSharingAttendee {
  displayName: string;
  roleLabel?: string;
  /** Authenticated photo route (`/api/users/:id/photo`) or a blob/data/http(s) URL. */
  photoUrl?: string | null;
}

export interface SocialSharingProps {
  event: SocialSharingEvent;
  attendee: SocialSharingAttendee;
  /** Renders Skip (before any action) / Continue (after one). */
  onContinue?: () => void;
  className?: string;
}

export type ShareFormat = "landscape" | "square" | "portrait" | "story";

/**
 * Logical sizes: 1200×630 is the 1.91:1 link card of LinkedIn and X, 1080² the
 * feed square, 1080×1350 the Instagram 4:5 portrait and 1080×1920 the 9:16
 * story.
 */
export const SHARE_SIZES: Record<ShareFormat, { width: number; height: number }> = {
  landscape: { width: 1200, height: 630 },
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
};
/** Output is drawn at 2× (e.g. 2400×1260 and 2160×3840). */
export const SHARE_SCALE = 2;

/** The Wallet pass palette: brand blue body, ink type, red labels, ink canvas (docs/DESIGN.md §2). */
const COLORS = {
  ink: "#030846",
  inkSoft: "rgba(3, 8, 70, 0.72)",
  blue: "#a3d5ff",
  cream: "#fafafa",
  red: "#bf2100",
  white: "#ffffff",
};
const MONO_FONT = `ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
const FALLBACK_SANS = "system-ui, -apple-system, Segoe UI, sans-serif";

/** The Apple Wallet pass strip (apps/api/assets/apple-wallet/strip@3x.png): lighthouse and HackUDC 2027 wordmark. */
const ASSETS = {
  strip: "/onboarding/pass-strip.png",
  /** The pass's organizer logo (apple-wallet/logo@2x.png), recoloured ink for the blue body. */
  organizer: "/onboarding/gpul-logo.png",
  /** Emilia, the seagull of the 404 page: perches on the pass. */
  seagull: "/onboarding/emilia.png",
};
/** Strip proportions; the band is this tall at any card width. */
const STRIP_RATIO = 294 / 1125;

type Copy = (typeof copyFragments)["es"];
type CopyKey = keyof Copy;

export function eventTitle(event: Pick<SocialSharingEvent, "name" | "year">): string {
  const year = String(event.year);
  return event.name.includes(year) ? event.name : `${event.name} ${year}`;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

/** The supplied date label plus the year, unless the label already carries it. */
export function dateWithYear(
  event: Pick<SocialSharingEvent, "year" | "dateLabel">,
): string | undefined {
  if (!event.dateLabel) return undefined;
  const year = String(event.year);
  return event.dateLabel.includes(year) ? event.dateLabel : `${event.dateLabel} ${year}`;
}

/** A public event URL without query or fragment, or null when it is not plain http(s). */
export function publicEventUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

/** Caption in the viewer's language; the date, place and link appear only when the event supplied them. */
export function buildCaption(
  language: Language,
  event: Pick<SocialSharingEvent, "name" | "year" | "dateLabel" | "location" | "url">,
): string {
  const details = [dateWithYear(event), event.location].filter(Boolean).join(" · ");
  const url = publicEventUrl(event.url);
  return fill(copyFragments[language].caption, {
    event: eventTitle(event),
    details: details ? ` ${details}.` : "",
    link: url ? `\n${url.href}` : "",
  });
}

/** Opens LinkedIn's composer with the text prefilled. Links cannot attach the image. */
export function linkedInShareUrl(caption: string): string {
  return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(caption)}`;
}

/** Opens X's composer with the text prefilled. Links cannot attach the image. */
export function xShareUrl(caption: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(caption)}`;
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function shareFileName(
  event: Pick<SocialSharingEvent, "name" | "year">,
  displayName: string,
  format: ShareFormat,
): string {
  return `${[slug(eventTitle(event)), slug(displayName), format].filter(Boolean).join("-")}.png`;
}

/* ---------------------------------------------------------------- assets */

type Drawable = CanvasImageSource & { width: number; height: number };

/** Frees a decoded ImageBitmap's pixels; plain `<img>` sources have nothing to release. */
function releaseImage(image: Drawable | null | undefined): void {
  if (image && "close" in image && typeof image.close === "function") image.close();
}

function loadStaticImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`image failed: ${src}`));
    image.src = src;
  });
}

function isAllowedImageUrl(url: string): boolean {
  return /^(https?:|blob:|data:image\/)/i.test(url) || url.startsWith("/");
}

/**
 * Reads an image through `fetch` into a blob, so the canvas is never tainted
 * and the private photo route is read with the session cookie. Throws for
 * unsupported schemes, non-2xx answers and undecodable bodies.
 */
export async function fetchImage(
  url: string,
  credentials: RequestCredentials,
  signal?: AbortSignal,
): Promise<Drawable> {
  if (!isAllowedImageUrl(url)) throw new Error("unsupported image url");
  const href = /^(blob:|data:)/i.test(url) ? url : apiAssetUrl(url);
  const response = await fetch(href, { credentials, signal });
  if (!response.ok) throw new Error(`image request failed (${response.status})`);
  const blob = await response.blob();
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob, { imageOrientation: "from-image" });
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await loadStaticImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Waits for the brand fonts; a failure keeps the fallback stack so the card still renders. */
async function loadFonts(): Promise<string> {
  const sans =
    (typeof document !== "undefined" && getComputedStyle(document.body).fontFamily) ||
    FALLBACK_SANS;
  try {
    await Promise.all([
      document.fonts.load(`500 24px ${sans}`),
      document.fonts.load(`600 24px ${sans}`),
    ]);
  } catch {
    // Missing fonts degrade to the fallback families in the stacks above.
  }
  return sans;
}

async function loadArt() {
  const seagull = await loadStaticImage(ASSETS.seagull).catch(() => null);
  return { seagull };
}

/** How the top band identifies the event: the pass strip, the event's own logo, or its name as text. */
export type CardBand =
  | { kind: "strip"; image: Drawable; organizer: Drawable | null }
  | { kind: "logo"; image: Drawable }
  | { kind: "text" };

async function loadBand(
  event: Pick<SocialSharingEvent, "name" | "logo">,
  signal: AbortSignal,
): Promise<{ band: CardBand; customLogo: Drawable | null }> {
  const custom = event.logo
    ? await fetchImage(event.logo, "same-origin", signal).catch(() => null)
    : null;
  if (custom) return { band: { kind: "logo", image: custom }, customLogo: custom };
  if (/hackudc/i.test(event.name)) {
    const [strip, organizer] = await Promise.all([
      loadStaticImage(ASSETS.strip).catch(() => null),
      loadStaticImage(ASSETS.organizer).catch(() => null),
    ]);
    if (strip) return { band: { kind: "strip", image: strip, organizer }, customLogo: null };
  }
  return { band: { kind: "text" }, customLogo: null };
}

/* --------------------------------------------------------------- drawing */

export interface DrawCardOptions {
  format: ShareFormat;
  eventName: string;
  /** "Voy a HackUDC 2027": top-left of the pass. */
  line: string;
  displayName: string;
  roleLabel?: string;
  /** Date and place exactly as the event supplied them; omitted when it supplied none. */
  /** Event date as supplied, with the year; shown in the pass header. */
  date?: string;
  labels: { name: string; role: string };
  photo: Drawable | null;
  band: CardBand;
  /** Public event host (e.g. "hackudc.com"), shown on the poster; omitted without an event link. */
  host?: string;
  /** Brand artwork around the pass; may be missing. */
  art: { seagull: Drawable | null };
  sansFont: string;
}

type Ctx = CanvasRenderingContext2D;

function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Largest font size (>= min) at which `text` fits `maxLines` lines in `maxWidth`. */
function fitText(
  ctx: Ctx,
  text: string,
  font: (size: number) => string,
  max: number,
  min: number,
  maxWidth: number,
  maxLines: number,
): { size: number; lines: string[] } {
  for (let size = max; size >= min; size -= 2) {
    ctx.font = font(size);
    const lines = wrap(ctx, text, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth)) {
      return { size, lines };
    }
  }
  ctx.font = font(min);
  const lines = wrap(ctx, text, maxWidth);
  const kept = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    let last = kept[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth)
      last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
  }
  return { size: min, lines: kept };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The photo tile sits where the Wallet pass puts its QR: a white rounded square. */
function drawPhotoTile(ctx: Ctx, o: DrawCardOptions, r: Rect) {
  const pad = 10;
  ctx.fillStyle = COLORS.white;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 18);
  ctx.fill();
  const inner = { x: r.x + pad, y: r.y + pad, w: r.w - pad * 2, h: r.h - pad * 2 };
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(inner.x, inner.y, inner.w, inner.h, 10);
  ctx.clip();
  if (o.photo) {
    const side = Math.min(o.photo.width, o.photo.height);
    const sx = (o.photo.width - side) / 2;
    const sy = (o.photo.height - side) / 2;
    ctx.drawImage(o.photo, sx, sy, side, side, inner.x, inner.y, inner.w, inner.h);
  } else {
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
    ctx.fillStyle = COLORS.cream;
    ctx.font = `600 ${Math.round(inner.h * 0.38)}px ${o.sansFont}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials(o.displayName), inner.x + inner.w / 2, inner.y + inner.h / 2);
  }
  ctx.restore();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** The event band: the pass strip, the event's own logo on cream, or its name as text. */
function drawBand(ctx: Ctx, o: DrawCardOptions, r: Rect) {
  const { band } = o;
  if (band.kind === "strip") {
    // The strip's last pixel columns are a lighter edge; crop them out.
    const crop = band.image.width * 0.012;
    ctx.drawImage(band.image, 0, 0, band.image.width - crop, band.image.height, r.x, r.y, r.w, r.h);
    return;
  }
  ctx.fillStyle = COLORS.cream;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  if (band.kind === "logo") {
    const scale = Math.min((r.w - 80) / band.image.width, (r.h * 0.6) / band.image.height);
    const w = band.image.width * scale;
    const h = band.image.height * scale;
    ctx.drawImage(band.image, r.x + 40, r.y + (r.h - h) / 2, w, h);
    return;
  }
  const fit = fitText(ctx, o.eventName, (s) => `600 ${s}px ${o.sansFont}`, 64, 28, r.w - 80, 1);
  ctx.fillStyle = COLORS.ink;
  ctx.font = `600 ${fit.size}px ${o.sansFont}`;
  ctx.textBaseline = "middle";
  ctx.fillText(fit.lines[0], r.x + 40, r.y + r.h / 2);
  ctx.textBaseline = "alphabetic";
}

/** Red mono label over an ink value, as in the Wallet pass fields. */
function drawField(
  ctx: Ctx,
  o: DrawCardOptions,
  label: string,
  value: string,
  at: { x: number; y: number; w: number },
  size: number,
  maxLines: number,
): number {
  const labelSize = Math.max(11, Math.round(size * 0.5));
  ctx.fillStyle = COLORS.red;
  ctx.font = `500 ${labelSize}px ${MONO_FONT}`;
  ctx.fillText(label, at.x, at.y + labelSize);
  const fit = fitText(
    ctx,
    value,
    (s) => `500 ${s}px ${o.sansFont}`,
    size,
    Math.round(size * 0.6),
    at.w,
    maxLines,
  );
  ctx.fillStyle = COLORS.ink;
  ctx.font = `500 ${fit.size}px ${o.sansFont}`;
  let y = at.y + labelSize + 8;
  for (const line of fit.lines) {
    y += fit.size * 1.1;
    ctx.fillText(line, at.x, y);
  }
  return y - at.y;
}

/**
 * The Wallet pass at its real proportions (838 x 1165): header with the
 * organizer logo and date, the strip, NAME and ROLE side by side, the photo
 * where the QR sits, the hackOS mark in the corner. Drawn with its top-left
 * at the origin; the caller positions and tilts it.
 */
function drawPass(ctx: Ctx, o: DrawCardOptions, w: number) {
  const h = w * (1165 / 838);
  const pad = w * 0.06;
  ctx.fillStyle = COLORS.blue;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, w * 0.04);
  ctx.fill();

  // Header: organizer logo left, supplied date/place right.
  const headerH = w * 0.19;
  if (o.band.kind === "strip" && o.band.organizer) {
    const logo = o.band.organizer;
    const lh = headerH * 0.56;
    ctx.drawImage(logo, pad, (headerH - lh) / 2 + w * 0.01, (logo.width / logo.height) * lh, lh);
  }
  if (o.date) {
    const right = fitText(ctx, o.date, (s) => `500 ${s}px ${MONO_FONT}`, w * 0.04, 10, w * 0.5, 1);
    ctx.font = `500 ${right.size}px ${MONO_FONT}`;
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = "right";
    ctx.fillText(right.lines[0], w - pad, headerH / 2 + right.size * 0.4);
    ctx.textAlign = "left";
  }

  // Strip.
  const bandH = Math.round(w * STRIP_RATIO);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, headerH, w, bandH);
  ctx.clip();
  drawBand(ctx, o, { x: 0, y: headerH, w, h: bandH });
  ctx.restore();

  // Fields: NAME and ROLE share a row; a missing role leaves the name the full width.
  const fieldsY = headerH + bandH + w * 0.05;
  const inner = w - pad * 2;
  const nameW = o.roleLabel ? inner * 0.58 : inner;
  drawField(ctx, o, o.labels.name, o.displayName, { x: pad, y: fieldsY, w: nameW }, w * 0.062, 2);
  if (o.roleLabel) {
    const roleX = pad + inner * 0.62;
    drawField(
      ctx,
      o,
      o.labels.role,
      o.roleLabel,
      { x: roleX, y: fieldsY, w: inner * 0.38 },
      w * 0.062,
      2,
    );
  }

  // Photo where the QR sits.
  const tile = w * 0.5;
  drawPhotoTile(ctx, o, { x: (w - tile) / 2, y: h - tile - w * 0.1, w: tile, h: tile });
}

/** Emilia perched on the pass's top edge. */
function drawSeagull(ctx: Ctx, o: DrawCardOptions, passW: number, height: number, along: number) {
  const gull = o.art.seagull;
  if (!gull) return;
  const w = (gull.width / gull.height) * height;
  ctx.drawImage(gull, passW * along, -height + 4, w, height);
}

/**
 * Vertical formats follow the landscape hierarchy (event line, name, role),
 * all left-aligned on one margin: the text block on top, the tilted pass
 * anchored to the right below it as the focal point, the host as the call to
 * action under it on the left. The column is centred inside the format's safe
 * band, so no format has dead space at one end. Story keeps the
 * top ~250 px and bottom ~340 px free of content (the bands Instagram overlays);
 * portrait and square keep a margin so the 3:4 profile-grid crop does not cut
 * anything (design notes in docs/onboarding-social-sharing.md).
 */
const STACK_LAYOUT = {
  portrait: {
    top: 84,
    bottom: 1290,
    kicker: 40,
    name: 104,
    role: 42,
    passMax: 640,
    gull: 130,
    host: 38,
  },
  story: {
    top: 262,
    bottom: 1600,
    kicker: 44,
    name: 112,
    role: 46,
    passMax: 640,
    gull: 140,
    host: 46,
  },
} as const;

interface PosterRow {
  text: string;
  font: string;
  color: string;
  lineHeight: number;
}

/** Event line, name (the hero) and role as measured rows, ready to draw at any alignment. */
function posterRows(
  ctx: Ctx,
  o: DrawCardOptions,
  maxWidth: number,
  sizes: { kicker: number; name: number; role: number },
  nameLines: number,
  kickerLines: number,
): PosterRow[] {
  const sans = (weight: number, size: number) => `${weight} ${size}px ${o.sansFont}`;
  const rows: PosterRow[] = [];
  const kicker = fitText(ctx, o.line, (s) => sans(700, s), sizes.kicker, 24, maxWidth, kickerLines);
  for (const text of kicker.lines) {
    rows.push({
      text,
      font: sans(700, kicker.size),
      color: COLORS.blue,
      lineHeight: kicker.size * 1.1,
    });
  }
  const name = fitText(
    ctx,
    o.displayName,
    (s) => sans(700, s),
    sizes.name,
    44,
    maxWidth,
    nameLines,
  );
  rows.push({ text: "", font: "", color: "", lineHeight: sizes.kicker * 0.6 });
  for (const text of name.lines) {
    rows.push({
      text,
      font: sans(700, name.size),
      color: COLORS.cream,
      lineHeight: name.size * 1.08,
    });
  }
  if (o.roleLabel) {
    const role = fitText(ctx, o.roleLabel, (s) => sans(500, s), sizes.role, 20, maxWidth, 1);
    rows.push({
      text: o.roleLabel === role.lines[0] ? role.lines[0] : role.lines[0],
      font: sans(500, role.size),
      color: COLORS.blue,
      lineHeight: role.size * 1.5,
    });
  }
  return rows;
}

function drawPosterRows(
  ctx: Ctx,
  rows: PosterRow[],
  x: number,
  top: number,
  align: "left" | "center",
) {
  let y = top;
  ctx.textAlign = align;
  for (const row of rows) {
    y += row.lineHeight;
    if (!row.text) continue;
    ctx.font = row.font;
    ctx.fillStyle = row.color;
    ctx.fillText(row.text, x, y);
  }
  ctx.textAlign = "left";
}

/** Paints the whole card on `ctx` in logical units (the caller applies the 2x scale). */
export function drawShareCard(ctx: Ctx, o: DrawCardOptions): void {
  const { width, height } = SHARE_SIZES[o.format];
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const sans = (weight: number, size: number) => `${weight} ${size}px ${o.sansFont}`;
  const drawHost = (
    x: number,
    y: number,
    size: number,
    maxWidth: number,
    align: "left" | "center",
  ) => {
    if (!o.host) return;
    const host = fitText(ctx, o.host, (s) => sans(600, s), size, 18, maxWidth, 1);
    ctx.fillStyle = COLORS.blue;
    ctx.font = sans(600, host.size);
    ctx.textAlign = align;
    ctx.fillText(host.lines[0], x, y);
    ctx.textAlign = "left";
  };

  if (o.format === "landscape" || o.format === "square") {
    // Side by side: text column left, tilted pass right.
    const wide = o.format === "landscape";
    const margin = wide ? 72 : 64;
    const passW = wide ? 352 : 440;
    const passH = passW * (1165 / 838);
    const gull = wide ? 115 : 130;
    const textW = wide ? 658 : width - margin - passW - 64 - 40;
    const rows = posterRows(
      ctx,
      o,
      textW,
      wide ? { kicker: 36, name: 84, role: 36 } : { kicker: 34, name: 92, role: 38 },
      wide ? 2 : 3,
      2,
    );
    const textH = rows.reduce((sum, r) => sum + r.lineHeight, 0);
    drawPosterRows(ctx, rows, margin, wide ? 128 : (height - textH) / 2 - 24, "left");
    ctx.save();
    ctx.translate(
      width - 64 - passW / 2 - (wide ? 14 : 0),
      (wide ? 125 : (height - passH) / 2 + gull / 2) + passH / 2,
    );
    ctx.rotate(3 * (Math.PI / 180));
    ctx.translate(-passW / 2, -passH / 2);
    drawPass(ctx, o, passW);
    drawSeagull(ctx, o, passW, gull, 0.62);
    ctx.restore();
    drawHost(margin, height - (wide ? 56 : 64), 30, textW, "left");
    return;
  }

  const layout = STACK_LAYOUT[o.format];
  const margin = 72;
  const textW = width - margin * 2;
  const rows = posterRows(ctx, o, textW, layout, o.format === "story" ? 2 : 1, 1);
  const textH = rows.reduce((sum, r) => sum + r.lineHeight, 0);
  const hostBlock = o.host ? layout.host * 2.4 : 20;
  const region = layout.bottom - layout.top;
  const fitPass = (gap: number) =>
    Math.min(layout.passMax, (region - textH - gap - hostBlock) / (1165 / 838));
  // The seagull stands on the pass's top-right; short text lets the pass rise
  // beside it, a text line that reaches that corner needs the full clearance.
  let widest = 0;
  for (const row of rows) {
    if (!row.text) continue;
    ctx.font = row.font;
    widest = Math.max(widest, ctx.measureText(row.text).width);
  }
  let gap = layout.gull * 0.3;
  let passW = fitPass(gap);
  if (margin + widest > width - margin - passW * 0.28) {
    gap = layout.gull + 8;
    passW = fitPass(gap);
  }
  const passH = passW * (1165 / 838);
  const content = textH + gap + passH + hostBlock;
  const top = layout.top + (region - content) / 2;

  drawPosterRows(ctx, rows, margin, top, "left");
  const passTop = top + textH + gap;
  ctx.save();
  ctx.translate(width - margin - passW / 2, passTop + passH / 2);
  ctx.rotate(-2 * (Math.PI / 180));
  ctx.translate(-passW / 2, -passH / 2);
  drawPass(ctx, o, passW);
  drawSeagull(ctx, o, passW, layout.gull, 0.8);
  ctx.restore();
  drawHost(margin, passTop + passH + layout.host * 1.7, layout.host, textW, "left");
}

export function createShareCanvas(format: ShareFormat): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const { width, height } = SHARE_SIZES[format];
  canvas.width = width * SHARE_SCALE;
  canvas.height = height * SHARE_SCALE;
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas export failed"))),
      "image/png",
    );
  });
}

/** Renders `options` to a PNG blob at 2× resolution. */
export async function renderShareImage(options: DrawCardOptions): Promise<Blob> {
  const canvas = createShareCanvas(options.format);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.scale(SHARE_SCALE, SHARE_SCALE);
  drawShareCard(ctx, options);
  return canvasToBlob(canvas);
}

/* ------------------------------------------------------------- component */

type RenderState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; blob: Blob; url: string; photoFailed: boolean };

/**
 * The share step: one preview, Download as the primary action, the networks
 * behind a Share menu. Structure follows the Wallet pass on the profile
 * (bounded surface, official artwork, quiet secondary actions).
 */
export function SocialSharing({ event, attendee, onContinue, className }: SocialSharingProps) {
  const { language } = useLocale();
  const copy = copyFragments[language];
  const text = (key: CopyKey, values: Record<string, string> = {}) => fill(copy[key], values);
  const ids = useId();
  const [format, setFormat] = useState<ShareFormat>("landscape");
  const [render, setRender] = useState<RenderState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [acted, setActed] = useState(false);
  const [canShareFile, setCanShareFile] = useState(false);

  const title = eventTitle(event);
  const date = dateWithYear(event);
  const caption = buildCaption(language, event);
  const fileName = shareFileName(event, attendee.displayName, format);

  // The decoded photo survives format switches; only a changed source reloads
  // it. This ref owns exactly one bitmap: it is closed when replaced, when the
  // photo goes away, and on unmount. A fetch that finishes after its run was
  // aborted closes its own bitmap instead of caching it.
  const photoCache = useRef<{ url: string; image: Drawable } | null>(null);
  const releasePhoto = useCallback(() => {
    releaseImage(photoCache.current?.image);
    photoCache.current = null;
  }, []);
  useEffect(() => releasePhoto, [releasePhoto]);

  useEffect(() => {
    void attempt;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setRender({ status: "loading" });
    (async () => {
      if (photoCache.current && photoCache.current.url !== attendee.photoUrl) releasePhoto();
      let customLogo: Drawable | null = null;
      try {
        const [sansFont, loaded, art] = await Promise.all([
          loadFonts(),
          loadBand({ name: event.name, logo: event.logo }, controller.signal),
          loadArt(),
        ]);
        customLogo = loaded.customLogo;
        let photo: Drawable | null = null;
        let photoFailed = false;
        if (attendee.photoUrl && photoCache.current?.url === attendee.photoUrl) {
          photo = photoCache.current.image;
        } else if (attendee.photoUrl) {
          try {
            const fetched = await fetchImage(attendee.photoUrl, "include", controller.signal);
            if (controller.signal.aborted) {
              releaseImage(fetched);
            } else {
              releasePhoto();
              photo = fetched;
              photoCache.current = { url: attendee.photoUrl, image: fetched };
            }
          } catch {
            // A failed photo is retried on the next render, never cached.
            photoFailed = !controller.signal.aborted;
          }
        }
        if (controller.signal.aborted) return;
        const blob = await renderShareImage({
          format,
          eventName: title,
          line: fill(copyFragments[language].cardLine, { event: title }),
          labels: {
            name: copyFragments[language].labelName,
            role: copyFragments[language].labelRole,
          },
          displayName: attendee.displayName,
          roleLabel: attendee.roleLabel,
          date,
          photo,
          band: loaded.band,
          host:
            [publicEventUrl(event.url)?.host, event.location].filter(Boolean).join(" · ") ||
            undefined,
          art,
          sansFont,
        });
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setRender({ status: "ready", blob, url: objectUrl, photoFailed });
      } finally {
        releaseImage(customLogo);
      }
    })().catch(() => {
      if (!controller.signal.aborted) setRender({ status: "error" });
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    format,
    language,
    attempt,
    title,
    date,
    event.location,
    event.name,
    event.logo,
    event.url,
    attendee.displayName,
    attendee.roleLabel,
    attendee.photoUrl,
    releasePhoto,
  ]);

  const blob = render.status === "ready" ? render.blob : null;
  useEffect(() => {
    if (!blob || typeof navigator === "undefined" || !navigator.canShare) {
      setCanShareFile(false);
      return;
    }
    const file = new File([blob], fileName, { type: "image/png" });
    setCanShareFile(navigator.canShare({ files: [file] }));
  }, [blob, fileName]);

  const download = () => {
    if (!blob) return;
    try {
      saveBlob(blob, fileName);
      setActed(true);
      toast.success(copy.downloaded, { compactTitle: copy.download });
    } catch {
      toast.error(copy.downloadFailed, copy.download);
    }
  };

  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setActed(true);
      toast.success(copy.copied, { compactTitle: copy.copy });
    } catch {
      toast.error(copy.copyFailed, copy.copy);
    }
  };

  const nativeShare = async () => {
    if (!blob) return;
    try {
      await navigator.share({
        files: [new File([blob], fileName, { type: "image/png" })],
        text: caption,
      });
      setActed(true);
    } catch (error) {
      // Dismissing the system sheet is not an error.
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error(copy.downloadFailed, copy.share);
      }
    }
  };

  const size = SHARE_SIZES[format];
  const formats: { value: ShareFormat; label: string }[] = [
    { value: "landscape", label: copy.formatLandscape },
    { value: "square", label: copy.formatSquare },
    { value: "portrait", label: copy.formatPortrait },
    { value: "story", label: copy.formatStory },
  ];

  return (
    <section
      aria-labelledby={`${ids}-title`}
      className={cn("mx-auto w-full max-w-xl space-y-4", className)}
    >
      <h2 id={`${ids}-title`} className="type-section-title">
        {copy.title}
      </h2>

      <figure
        className={cn(
          "mx-auto w-full overflow-hidden rounded-surface border",
          format === "square" && "max-w-sm",
          format === "portrait" && "max-w-xs",
          format === "story" && "max-w-60",
        )}
        style={{ aspectRatio: `${size.width} / ${size.height}` }}
        aria-busy={render.status === "loading"}
      >
        {render.status === "ready" && (
          // biome-ignore lint/performance/noImgElement: a generated blob URL, not an optimisable asset.
          <img
            src={render.url}
            alt={text("previewAlt", { event: title, name: attendee.displayName })}
            className="size-full object-contain"
          />
        )}
        {render.status === "loading" && (
          <Skeleton role="status" aria-label={copy.generating} className="size-full rounded-none" />
        )}
        {render.status === "error" && (
          <div className="flex size-full flex-col items-center justify-center gap-3 p-4 text-center">
            <p role="alert" className="text-destructive text-sm">
              {copy.renderError}
            </p>
            <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
              {copy.retry}
            </Button>
          </div>
        )}
      </figure>

      {render.status === "ready" && render.photoFailed && (
        <p role="status" className="type-meta">
          {copy.photoFallback}
        </p>
      )}

      <fieldset className="flex flex-wrap justify-center gap-1">
        <legend className="sr-only">{copy.format}</legend>
        {formats.map(({ value, label }) => (
          <label
            key={value}
            className={cn(
              "type-label inline-flex h-[var(--control-height-compact)] cursor-pointer items-center rounded-button px-3 transition-colors",
              "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
              format === value
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            <input
              type="radio"
              name={`${ids}-format`}
              value={value}
              checked={format === value}
              onChange={() => setFormat(value)}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        {onContinue && (
          <Button variant={acted ? "default" : "ghost"} onClick={onContinue} className="sm:mr-auto">
            {acted ? copy.continue : copy.skip}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={!blob}>
              <ShareNetworkIcon aria-hidden />
              {copy.shareMenu}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal text-pretty">
              {copy.attachNote}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a
                href={linkedInShareUrl(caption)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setActed(true)}
              >
                <LinkedinLogoIcon aria-hidden />
                {copy.linkedin}
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a
                href={xShareUrl(caption)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setActed(true)}
              >
                <XLogoIcon aria-hidden />
                {copy.x}
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copyCaption()}>
              <CopyIcon aria-hidden />
              {copy.copy}
            </DropdownMenuItem>
            {canShareFile && (
              <DropdownMenuItem onSelect={() => void nativeShare()}>
                <ShareNetworkIcon aria-hidden />
                {copy.share}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant={acted ? "outline" : "default"} onClick={download} disabled={!blob}>
          <DownloadSimpleIcon aria-hidden />
          {copy.download}
        </Button>
      </div>
    </section>
  );
}
