"use client";

import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { LinkedinLogoIcon } from "@phosphor-icons/react/dist/csr/LinkedinLogo";
import { ShareNetworkIcon } from "@phosphor-icons/react/dist/csr/ShareNetwork";
import { XLogoIcon } from "@phosphor-icons/react/dist/csr/XLogo";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiAssetUrl } from "@/lib/directory";
import { saveBlob } from "@/lib/download";
import { useLocale } from "@/lib/i18n";
import { initials } from "@/lib/initials";
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

export type ShareFormat = "landscape" | "square";

/** Logical sizes: 1200×630 is the 1.91:1 link-card ratio of LinkedIn and X; 1080² is the feed square. */
export const SHARE_SIZES: Record<ShareFormat, { width: number; height: number }> = {
  landscape: { width: 1200, height: 630 },
  square: { width: 1080, height: 1080 },
};
/** Output is drawn at 2× (2400×1260 and 2160×2160). */
export const SHARE_SCALE = 2;

const COLORS = {
  ink: "#030846",
  red: "#bf2100",
  cream: "#fafafa",
  yellow: "#f5dc8f",
  skyTop: "#eef7ff",
  skyBottom: "#a3d5ff",
};
const DISPLAY_FONT = `"Rockwell", Georgia, "Times New Roman", serif`;
const FALLBACK_SANS = "system-ui, -apple-system, Segoe UI, sans-serif";

const ASSETS = {
  logo: "/onboarding/hackudc-2027-logo.png",
  gallery: "/onboarding/galeria.png",
  gull: "/onboarding/gaviota.png",
};

type Copy = (typeof copyFragments)["es"];
type CopyKey = keyof Copy;

export function eventTitle(event: Pick<SocialSharingEvent, "name" | "year">): string {
  const year = String(event.year);
  return event.name.includes(year) ? event.name : `${event.name} ${year}`;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

/** Caption in the viewer's language; the date and place appear only when the event supplied them. */
export function buildCaption(
  language: Language,
  event: Pick<SocialSharingEvent, "name" | "year" | "dateLabel" | "location">,
): string {
  const details = [event.dateLabel, event.location].filter(Boolean).join(" · ");
  return fill(copyFragments[language].caption, {
    event: eventTitle(event),
    details: details ? ` ${details}.` : "",
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
      document.fonts.load(`700 48px ${DISPLAY_FONT}`),
      document.fonts.load(`500 24px ${sans}`),
      document.fonts.load(`600 24px ${sans}`),
      document.fonts.load(`700 24px ${sans}`),
    ]);
  } catch {
    // Missing fonts degrade to the fallback families in the stacks above.
  }
  return sans;
}

interface CardAssets {
  logo: Drawable | null;
  gallery: Drawable | null;
  gull: Drawable | null;
}

async function loadCardAssets(eventLogo: string | undefined, signal: AbortSignal) {
  const optional = <T,>(promise: Promise<T>) => promise.catch(() => null);
  const custom = eventLogo ? await optional(fetchImage(eventLogo, "same-origin", signal)) : null;
  const [logo, gallery, gull] = await Promise.all([
    custom ?? optional(loadStaticImage(ASSETS.logo)),
    optional(loadStaticImage(ASSETS.gallery)),
    optional(loadStaticImage(ASSETS.gull)),
  ]);
  return {
    assets: { logo, gallery, gull } satisfies CardAssets,
    usesCustomLogo: Boolean(custom),
    /** Decoded per render, so the caller releases it once the card is drawn. */
    customLogo: custom,
  };
}

/* --------------------------------------------------------------- drawing */

export interface DrawCardOptions {
  format: ShareFormat;
  eventName: string;
  headline: string;
  displayName: string;
  roleLabel?: string;
  details?: string;
  photo: Drawable | null;
  assets: CardAssets;
  /** Draw the event name as text instead of the HackUDC wordmark. */
  textWordmark: boolean;
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

/** Largest font size (≥ min) at which `text` fits `maxLines` lines in `maxWidth`. */
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

function drawCover(ctx: Ctx, image: Drawable, cx: number, cy: number, radius: number) {
  const side = Math.min(image.width, image.height);
  const sx = (image.width - side) / 2;
  const sy = (image.height - side) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(image, sx, sy, side, side, cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();
}

function drawAvatar(ctx: Ctx, o: DrawCardOptions, cx: number, cy: number, radius: number) {
  ctx.save();
  ctx.shadowColor = "rgba(3, 8, 70, 0.22)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = COLORS.ink;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = COLORS.cream;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 7, 0, Math.PI * 2);
  ctx.fill();
  if (o.photo) {
    drawCover(ctx, o.photo, cx, cy, radius);
    return;
  }
  ctx.fillStyle = COLORS.ink;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.yellow;
  ctx.font = `700 ${Math.round(radius * 0.86)}px ${DISPLAY_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials(o.displayName), cx, cy + radius * 0.04);
  ctx.textAlign = "left";
}

function drawImageWidth(ctx: Ctx, image: Drawable, x: number, y: number, width: number) {
  ctx.drawImage(image, x, y, width, (image.height / image.width) * width);
}

/** Paints the whole card on `ctx` in logical units (the caller applies the 2× scale). */
export function drawShareCard(ctx: Ctx, o: DrawCardOptions): void {
  const { width, height } = SHARE_SIZES[o.format];
  const sans = (weight: number, size: number) => `${weight} ${size}px ${o.sansFont}`;
  const display = (size: number) => `700 ${size}px ${DISPLAY_FONT}`;
  const sky = ctx.createLinearGradient(0, 0, width * 0.35, height);
  sky.addColorStop(0, COLORS.skyTop);
  sky.addColorStop(1, COLORS.skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  const landscape = o.format === "landscape";
  const left = 72;
  const textWidth = landscape ? 500 : width - left * 2;
  const { assets } = o;

  // Artwork first so text and avatar sit on top.
  if (assets.gallery) {
    if (landscape) {
      const w = 640;
      const h = (assets.gallery.height / assets.gallery.width) * w;
      ctx.drawImage(assets.gallery, width - w + 40, height - h * 0.82, w, h);
    } else {
      drawImageWidth(ctx, assets.gallery, 50, height - 370, width - 100);
    }
  }
  if (assets.gull) {
    const w = landscape ? 130 : 170;
    drawImageWidth(ctx, assets.gull, landscape ? width - 190 : width - 250, landscape ? 36 : 56, w);
  }

  // Wordmark.
  let y = landscape ? 56 : 64;
  const logoHeight = landscape ? 56 : 72;
  if (assets.logo && !o.textWordmark) {
    const w = (assets.logo.width / assets.logo.height) * logoHeight;
    ctx.drawImage(
      assets.logo,
      left,
      y,
      Math.min(w, textWidth),
      (Math.min(w, textWidth) / w) * logoHeight,
    );
  } else {
    const fit = fitText(ctx, o.eventName, display, logoHeight, 28, textWidth, 1);
    ctx.fillStyle = COLORS.ink;
    ctx.font = display(fit.size);
    ctx.fillText(fit.lines[0], left, y + logoHeight * 0.8);
  }
  y += logoHeight + (landscape ? 44 : 52);

  // Headline.
  const headline = fitText(
    ctx,
    o.headline,
    display,
    landscape ? 60 : 92,
    landscape ? 36 : 56,
    textWidth,
    2,
  );
  ctx.fillStyle = COLORS.ink;
  ctx.font = display(headline.size);
  const lineHeight = headline.size * 1.1;
  for (const line of headline.lines) {
    y += lineHeight;
    ctx.fillText(line, left, y - headline.size * 0.1);
  }
  y += landscape ? 22 : 34;

  if (landscape) {
    ctx.fillStyle = COLORS.red;
    ctx.fillRect(left, y, 72, 5);
    y += 44;
    drawIdentity(ctx, o, sans, left, y, textWidth);
    drawAvatar(ctx, o, 880, 232, 112);
  } else {
    const radius = 140;
    const cy = y + radius + 18;
    drawAvatar(ctx, o, left + radius + 12, cy, radius);
    const textLeft = left + radius * 2 + 52;
    drawIdentity(ctx, o, sans, textLeft, cy - 84, width - textLeft - left);
  }
}

function drawIdentity(
  ctx: Ctx,
  o: DrawCardOptions,
  sans: (weight: number, size: number) => string,
  x: number,
  top: number,
  maxWidth: number,
): void {
  const landscape = o.format === "landscape";
  let y = top;
  const name = fitText(
    ctx,
    o.displayName,
    (s) => sans(700, s),
    landscape ? 40 : 48,
    24,
    maxWidth,
    2,
  );
  ctx.fillStyle = COLORS.ink;
  ctx.font = sans(700, name.size);
  for (const line of name.lines) {
    y += name.size * 1.15;
    ctx.fillText(line, x, y);
  }
  if (o.roleLabel) {
    const role = fitText(
      ctx,
      o.roleLabel,
      (s) => sans(500, s),
      landscape ? 24 : 28,
      16,
      maxWidth,
      1,
    );
    ctx.font = sans(500, role.size);
    ctx.fillStyle = "rgba(3, 8, 70, 0.8)";
    y += role.size * 1.5;
    ctx.fillText(role.lines[0], x, y);
  }
  if (o.details) {
    const detail = fitText(
      ctx,
      o.details,
      (s) => sans(600, s),
      landscape ? 22 : 26,
      14,
      maxWidth - 40,
      1,
    );
    ctx.font = sans(600, detail.size);
    const pillWidth = ctx.measureText(detail.lines[0]).width + 40;
    const pillHeight = detail.size + 22;
    y += 22;
    ctx.fillStyle = COLORS.ink;
    ctx.beginPath();
    ctx.roundRect(x, y, pillWidth, pillHeight, pillHeight / 2);
    ctx.fill();
    ctx.fillStyle = COLORS.cream;
    ctx.fillText(detail.lines[0], x + 20, y + pillHeight / 2 + detail.size * 0.34);
  }
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

export function SocialSharing({ event, attendee, onContinue, className }: SocialSharingProps) {
  const { language } = useLocale();
  const copy = copyFragments[language];
  const text = (key: CopyKey, values: Record<string, string> = {}) => fill(copy[key], values);
  const ids = useId();
  const [format, setFormat] = useState<ShareFormat>("landscape");
  const [edited, setEdited] = useState<string | null>(null);
  const [render, setRender] = useState<RenderState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<{ message: string; ok: boolean } | null>(null);
  const [acted, setActed] = useState(false);
  const [canShareFile, setCanShareFile] = useState(false);

  const title = eventTitle(event);
  const details = [event.dateLabel, event.location].filter(Boolean).join(" · ");
  const caption = edited ?? buildCaption(language, event);
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
        const [sansFont, loaded] = await Promise.all([
          loadFonts(),
          loadCardAssets(event.logo, controller.signal),
        ]);
        customLogo = loaded.customLogo;
        const { assets, usesCustomLogo } = loaded;
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
          headline: fill(copyFragments[language].cardHeadline, { event: title }),
          displayName: attendee.displayName,
          roleLabel: attendee.roleLabel,
          details: details || undefined,
          photo,
          assets,
          textWordmark: usesCustomLogo ? false : !/hackudc/i.test(event.name),
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
    details,
    event.name,
    event.logo,
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

  const announce = useCallback((message: string) => {
    setStatus({ message, ok: true });
    setActed(true);
  }, []);

  const download = () => {
    if (!blob) return;
    try {
      saveBlob(blob, fileName);
      announce(text("downloaded"));
    } catch {
      setStatus({ message: text("downloadFailed"), ok: false });
    }
  };

  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      announce(text("copied"));
    } catch {
      setStatus({ message: text("copyFailed"), ok: false });
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
        setStatus({ message: text("downloadFailed"), ok: false });
      }
    }
  };

  const square = format === "square";
  const formats: { value: ShareFormat; label: string }[] = [
    { value: "landscape", label: copy.formatLandscape },
    { value: "square", label: copy.formatSquare },
  ];

  return (
    <section aria-labelledby={`${ids}-title`} className={cn("space-y-6", className)}>
      <h2 id={`${ids}-title`} className="type-section-title">
        {copy.title}
      </h2>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0 space-y-3">
          <figure
            className={cn(
              "relative w-full overflow-hidden rounded-lg border bg-muted",
              square ? "mx-auto max-w-lg" : "",
            )}
            style={{ aspectRatio: square ? "1 / 1" : "1200 / 630" }}
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
              <div
                role="status"
                className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground"
              >
                <Spinner />
                {copy.generating}
              </div>
            )}
            {render.status === "error" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
                <p role="alert" className="text-sm text-destructive">
                  {copy.renderError}
                </p>
                <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                  {copy.retry}
                </Button>
              </div>
            )}
          </figure>
          {render.status === "ready" && render.photoFailed && (
            <p role="status" className="text-sm text-muted-foreground">
              {copy.photoFallback}
            </p>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <fieldset className="space-y-2">
            <legend className="type-label font-medium">{copy.format}</legend>
            <div className="flex gap-2">
              {formats.map(({ value, label }) => (
                <label
                  key={value}
                  className={cn(
                    "inline-flex h-[var(--control-height-default)] flex-1 cursor-pointer items-center justify-center rounded-button border px-4 text-sm font-semibold transition-colors",
                    "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                    format === value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted",
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
            </div>
          </fieldset>

          <div className="space-y-2">
            <label htmlFor={`${ids}-caption`} className="type-label font-medium">
              {copy.captionLabel}
            </label>
            <Textarea
              id={`${ids}-caption`}
              value={caption}
              rows={4}
              onChange={(e) => setEdited(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={download} disabled={!blob}>
              <DownloadSimpleIcon aria-hidden />
              {copy.download}
            </Button>
            <Button variant="outline" onClick={copyCaption}>
              <CopyIcon aria-hidden />
              {copy.copy}
            </Button>
            {canShareFile && (
              <Button variant="outline" onClick={nativeShare}>
                <ShareNetworkIcon aria-hidden />
                {copy.share}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a
                href={linkedInShareUrl(caption)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setActed(true)}
              >
                <LinkedinLogoIcon aria-hidden />
                {copy.linkedin}
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a
                href={xShareUrl(caption)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setActed(true)}
              >
                <XLogoIcon aria-hidden />
                {copy.x}
              </a>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{copy.attachNote}</p>
          <p role="status" aria-live="polite" className="flex min-h-5 items-center gap-1.5 text-sm">
            {status && (
              <>
                {status.ok && <CheckIcon aria-hidden className="size-4 text-success" />}
                <span className={status.ok ? undefined : "text-destructive"}>{status.message}</span>
              </>
            )}
          </p>
          {onContinue && (
            <div className="flex justify-end">
              <Button variant={acted ? "default" : "ghost"} onClick={onContinue}>
                {acted ? copy.continue : copy.skip}
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
