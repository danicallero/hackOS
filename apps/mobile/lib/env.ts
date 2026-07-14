/**
 * Base URL of the hackOS API. Expo only exposes env vars prefixed
 * `EXPO_PUBLIC_` to client code (mirrors `apps/web`'s `NEXT_PUBLIC_API_URL`
 * convention) — set it in `.env` or the EAS build profile. Production is the
 * safe default for installed builds; local development must opt into a local
 * URL explicitly.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://api.hackudc.com";

/** Public website where attendees register and review their application. */
export const EVENT_WEBSITE_URL =
  process.env.EXPO_PUBLIC_EVENT_WEBSITE_URL ?? "https://os.hackudc.com";

/** Compact, protocol-free form suitable for explanatory UI copy. */
export const EVENT_WEBSITE_DISPLAY = EVENT_WEBSITE_URL.replace(/^https?:\/\//, "").replace(
  /\/$/,
  "",
);
