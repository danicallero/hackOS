/** H49: canonical copy and origin shared by the public page metadata and social card. */
const DEFAULT_SITE_URL = "http://localhost:3001";

const normalizeOrigin = (value: string | undefined, fallback: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return /^https?:\/\//i.test(trimmed) ? trimmed.replace(/\/$/, "") : `https://${trimmed}`;
};

export const getSiteUrl = (fallback = DEFAULT_SITE_URL) =>
  normalizeOrigin(
    process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? process.env.WEB_DOMAIN,
    fallback,
  );

export const SITE_URL = getSiteUrl();

export const SITE_TITLE = "hackOS — Hackathon management";

export const SITE_DESCRIPTION =
  "Run applications, projects, schedules, judging, and event communications in one place.";

export const SOCIAL_IMAGE_PATH = "/opengraph-image";

export const BRAND_IMAGE_PATH = "/icon.png";
