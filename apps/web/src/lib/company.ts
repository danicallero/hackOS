import { logoTouchesEdge } from "@hackos/shared/image-color";
import { useEffect, useState } from "react";
import type { Ambient } from "@/components/common/ambient-backdrop";
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
  /** H44: per-language description; prefer it over `description` (see companyDescription). */
  descriptionTranslations?: Record<string, string>;
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

/** A company's description in the viewer's language, else its fallback text (H44). */
export function companyDescription(
  company: { description: string | null; descriptionTranslations?: Record<string, string> },
  language: string,
): string | null {
  return company.descriptionTranslations?.[language] || company.description || null;
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
 * Hero wash from the logo color, fading to transparent over the page
 * background. Strength comes from `--hero-mix` so dark mode can soften it.
 */
export function heroGradient(logoColor: string | null | undefined): string {
  const base = logoColor && HEX.test(logoColor) ? logoColor : "#007aff";
  return `linear-gradient(to bottom, color-mix(in srgb, ${base} var(--hero-mix, 40%), transparent) 0%, transparent 100%)`;
}

/** What a logo's pixels say (H44): whether its artwork reaches its edges. */
interface LogoAnalysis {
  bleed: boolean;
}

const UNREADABLE: LogoAnalysis = { bleed: false };
const analysisCache = new Map<string, LogoAnalysis>();

/** Reads a 32px copy; unreadable (no bleed) when the canvas is tainted. */
function sampleLogo(img: HTMLImageElement): LogoAnalysis {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return UNREADABLE;
  ctx.drawImage(img, 0, 0, size, size);
  try {
    const pixels = ctx.getImageData(0, 0, size, size).data;
    return { bleed: logoTouchesEdge(pixels, size, size) };
  } catch {
    return UNREADABLE; // tainted canvas: the logo host sends no CORS headers
  }
}

const inFlight = new Map<string, Promise<LogoAnalysis>>();

function readLogo(url: string): Promise<LogoAnalysis> {
  const pending = inFlight.get(url);
  if (pending) return pending;
  const promise = new Promise<LogoAnalysis>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(sampleLogo(img));
    img.onerror = () => resolve(UNREADABLE);
    img.src = url;
  }).then((analysis) => {
    analysisCache.set(url, analysis);
    inFlight.delete(url);
    return analysis;
  });
  inFlight.set(url, promise);
  return promise;
}

/**
 * Warm the cache when a logo is shown in a list, off the critical path, so the
 * company page opens with its logo tile already sized. Deduped per URL.
 */
export function precomputeLogoColor(url: string | null | undefined): void {
  if (!url || analysisCache.has(url) || inFlight.has(url) || typeof window === "undefined") return;
  const run = () => void readLogo(url);
  if ("requestIdleCallback" in window) window.requestIdleCallback(run);
  else setTimeout(run, 200);
}

/** Cached analysis of an image URL; undefined until read. */
function useLogoAnalysis(url: string | null | undefined) {
  const [analysis, setAnalysis] = useState<{ url: string; value: LogoAnalysis } | null>(() => {
    const cached = url ? analysisCache.get(url) : undefined;
    return url && cached ? { url, value: cached } : null;
  });
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const cached = analysisCache.get(url);
    void (cached ? Promise.resolve(cached) : readLogo(url)).then((value) => {
      if (!cancelled)
        setAnalysis((current) => (current?.value === value ? current : { url, value }));
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return analysis && analysis.url === url ? analysis.value : undefined;
}

/** True once a logo is known to run into its own edges, so its tile adds the margin (H44). */
export function useLogoBleed(url: string | null | undefined): boolean {
  return useLogoAnalysis(url)?.bleed ?? false;
}

/**
 * The blurred-logo backdrop of a company's hero (H44, H48): the logo the tile
 * shows, the negative in dark mode. Same URLs as `SponsorLogo`, so the
 * backdrop reuses its requests. Shared by the company and challenge pages.
 */
export function companyAmbient(logo: {
  logoUrl: string | null | undefined;
  logoNegativeUrl?: string | null;
}): Ambient | undefined {
  const light = logo.logoUrl;
  if (!light) return undefined;
  const dark = logo.logoNegativeUrl ?? light;
  return { urls: [...new Set([light, dark])], active: light, activeDark: dark };
}
