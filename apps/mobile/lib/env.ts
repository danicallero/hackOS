/**
 * Base URL of the hackOS API. Expo only exposes env vars prefixed
 * `EXPO_PUBLIC_` to client code (mirrors `apps/web`'s `NEXT_PUBLIC_API_URL`
 * convention). Production is the safe default for installed builds. The
 * hidden developer switch may replace this value at runtime; keep this as a
 * live binding rather than capturing it in a module-local constant.
 */
export const PRODUCTION_API_URL = "https://api.hackudc.com";
export const DEVELOPMENT_API_URL = "https://api.dani.md";

/** The active base URL. Changed only by the persisted developer endpoint mode. */
export let API_URL = PRODUCTION_API_URL;

export function setApiUrl(url: string): void {
  API_URL = url;
}

/** Public website where attendees register and review their application. */
export const EVENT_WEBSITE_URL =
  process.env.EXPO_PUBLIC_EVENT_WEBSITE_URL ?? "https://os.hackudc.com";

/** Compact, protocol-free form suitable for explanatory UI copy. */
export const EVENT_WEBSITE_DISPLAY = EVENT_WEBSITE_URL.replace(/^https?:\/\//, "").replace(
  /\/$/,
  "",
);
