type RuntimeConfig = {
  apiUrl?: string;
  siteUrl?: string;
};

declare global {
  interface Window {
    __HACKOS_RUNTIME_CONFIG__?: RuntimeConfig;
  }
}

const normalizeOrigin = (value: string | undefined, fallback: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return /^https?:\/\//i.test(trimmed) ? trimmed.replace(/\/$/, "") : `https://${trimmed}`;
};

const runtimeConfig = typeof window === "undefined" ? undefined : window.__HACKOS_RUNTIME_CONFIG__;

/**
 * Public runtime config. The image is shared by staging and production; the
 * server injects each environment's origins before the client hydrates.
 * Local development still accepts the familiar NEXT_PUBLIC_* variables.
 */
export const API_URL =
  runtimeConfig?.apiUrl ??
  normalizeOrigin(
    process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? process.env.API_DOMAIN,
    "http://localhost:3000",
  );
