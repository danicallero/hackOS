import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { PublicScheduleItem } from "@/lib/logistics";

/** `GET /api/enterprises/:id/profile` (H44; challenges only once revealed, H45; activities by H59 visibility). */
export interface CompanyProfile {
  id: number;
  name: string;
  logoUrl: string | null;
  logoNegativeUrl: string | null;
  website: string | null;
  description: string | null;
  representatives: {
    userId: number;
    name: string;
    firstName: string;
    surname: string | null;
    avatarUrl: string | null;
  }[];
  challenges: { id: number; title: string; summary: string | null }[];
  activities: PublicScheduleItem[];
}

export function fetchCompanyProfile(id: number, signal?: AbortSignal): Promise<CompanyProfile> {
  return api.get<CompanyProfile>(`/api/enterprises/${id}/profile`, { signal }).then((profile) => ({
    ...profile,
    representatives: profile.representatives ?? [],
    challenges: profile.challenges ?? [],
    activities: profile.activities ?? [],
  }));
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Hero wash from the logo colour, fading to transparent over the page
 * background. Strength comes from `--hero-mix` so dark mode can soften it.
 */
export function heroGradient(logoColor: string | null | undefined): string {
  const base = logoColor && HEX.test(logoColor) ? logoColor : "#007aff";
  return `linear-gradient(to bottom, color-mix(in srgb, ${base} var(--hero-mix, 40%), transparent) 0%, transparent 100%)`;
}

const colorCache = new Map<string, string | null>();

/** Representative colour of a logo: mean of its saturated, opaque, mid-tone pixels; null when none or unreadable. */
function sampleLogoColor(img: HTMLImageElement): string | null {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    return null; // tainted canvas: the logo host sends no CORS headers
  }
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [pr, pg, pb, pa] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    const max = Math.max(pr, pg, pb);
    const min = Math.min(pr, pg, pb);
    if (pa < 200 || (max > 240 && min > 225) || max < 25 || max - min < 24) continue;
    r += pr;
    g += pg;
    b += pb;
    n++;
  }
  if (n === 0) return null;
  const hex = (v: number) =>
    Math.round(v / n)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

const inFlight = new Map<string, Promise<string | null>>();

function readLogoColor(url: string): Promise<string | null> {
  const pending = inFlight.get(url);
  if (pending) return pending;
  const promise = new Promise<string | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(sampleLogoColor(img));
    img.onerror = () => resolve(null);
    img.src = url;
  }).then((color) => {
    colorCache.set(url, color);
    inFlight.delete(url);
    return color;
  });
  inFlight.set(url, promise);
  return promise;
}

/**
 * Warm the colour cache when a logo is shown in a list, off the critical path,
 * so the company page opens already tinted. Deduped per URL.
 */
export function precomputeLogoColor(url: string | null | undefined): void {
  if (!url || colorCache.has(url) || inFlight.has(url) || typeof window === "undefined") return;
  const run = () => void readLogoColor(url);
  if ("requestIdleCallback" in window) window.requestIdleCallback(run);
  else setTimeout(run, 200);
}

/** Client-side hero colour of a logo URL, cached per URL; null until read or when unavailable (nothing is stored server-side). */
export function useLogoColor(url: string | null | undefined): string | null {
  const [color, setColor] = useState<string | null>(url ? (colorCache.get(url) ?? null) : null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    void (
      colorCache.has(url) ? Promise.resolve(colorCache.get(url) ?? null) : readLogoColor(url)
    ).then((next) => {
      if (!cancelled) setColor(next);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return color;
}
