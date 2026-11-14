import { logoTouchesEdge, pickDominantColor } from "@hackos/shared/image-color";
import { useTheme } from "next-themes";
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
 * Hero wash from the logo colour, fading to transparent over the page
 * background. Strength comes from `--hero-mix` so dark mode can soften it.
 */
export function heroGradient(logoColor: string | null | undefined): string {
  const base = logoColor && HEX.test(logoColor) ? logoColor : "#007aff";
  return `linear-gradient(to bottom, color-mix(in srgb, ${base} var(--hero-mix, 40%), transparent) 0%, transparent 100%)`;
}

/** What a logo's pixels say (H44): its representative colour and whether its artwork reaches its edges. */
interface LogoAnalysis {
  color: string | null;
  bleed: boolean;
}

const UNREADABLE: LogoAnalysis = { color: null, bleed: false };
const analysisCache = new Map<string, LogoAnalysis>();

/** Reads a 32px copy; unreadable (no colour, no bleed) when the canvas is tainted. */
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
    return { color: pickDominantColor(pixels), bleed: logoTouchesEdge(pixels, size, size) };
  } catch {
    return UNREADABLE; // tainted canvas: the logo host sends no CORS headers
  }
}

const inFlight = new Map<string, Promise<LogoAnalysis>>();

function readLogo(url: string, credentials = false): Promise<LogoAnalysis> {
  const pending = inFlight.get(url);
  if (pending) return pending;
  const promise = new Promise<LogoAnalysis>((resolve) => {
    const img = new Image();
    img.crossOrigin = credentials ? "use-credentials" : "anonymous";
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
 * company page opens already tinted. Deduped per URL.
 */
export function precomputeLogoColor(url: string | null | undefined): void {
  if (!url || analysisCache.has(url) || inFlight.has(url) || typeof window === "undefined") return;
  const run = () => void readLogo(url);
  if ("requestIdleCallback" in window) window.requestIdleCallback(run);
  else setTimeout(run, 200);
}

/** Cached analysis of an image URL; undefined until read. */
function useLogoAnalysis(url: string | null | undefined, credentials = false) {
  const [analysis, setAnalysis] = useState<{ url: string; value: LogoAnalysis } | null>(() => {
    const cached = url ? analysisCache.get(url) : undefined;
    return url && cached ? { url, value: cached } : null;
  });
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const cached = analysisCache.get(url);
    void (cached ? Promise.resolve(cached) : readLogo(url, credentials)).then((value) => {
      if (!cancelled)
        setAnalysis((current) => (current?.value === value ? current : { url, value }));
    });
    return () => {
      cancelled = true;
    };
  }, [url, credentials]);
  return analysis && analysis.url === url ? analysis.value : undefined;
}

/** Client-side hero colour of an image URL, cached per URL (`credentials` for authenticated API assets); null until read or when unavailable (nothing is stored server-side). */
export function useLogoColor(
  url: string | null | undefined,
  options?: { credentials?: boolean },
): string | null {
  return useLogoAnalysis(url, options?.credentials ?? false)?.color ?? null;
}

/** True once a logo is known to run into its own edges, so its tile adds the margin (H44). */
export function useLogoBleed(url: string | null | undefined): boolean {
  return useLogoAnalysis(url)?.bleed ?? false;
}

/**
 * A company's colour (H44), inferred from the logo the viewer actually sees:
 * the negative artwork in dark mode. A negative that lost the brand colours
 * (white or mono) has none, so the positive logo's colour is used instead.
 */
export function useCompanyLogoColor(logo: {
  logoUrl: string | null | undefined;
  logoNegativeUrl?: string | null;
}): string | null {
  const { resolvedTheme } = useTheme();
  const negative =
    resolvedTheme === "dark" && logo.logoNegativeUrl && logo.logoNegativeUrl !== logo.logoUrl
      ? logo.logoNegativeUrl
      : null;
  const shown = useLogoAnalysis(negative);
  const positive = useLogoAnalysis(logo.logoUrl);
  if (negative) return shown === undefined ? null : (shown.color ?? positive?.color ?? null);
  return positive?.color ?? null;
}
