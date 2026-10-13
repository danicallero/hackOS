/**
 * Base URL of the hackOS API. Expo only exposes env vars prefixed
 * `EXPO_PUBLIC_` to client code (mirrors `apps/web`'s `NEXT_PUBLIC_API_URL`
 * convention). Production is the safe default for installed builds. The
 * hidden developer switch may replace this value at runtime; keep this as a
 * live binding rather than capturing it in a module-local constant.
 */
export const PRODUCTION_API_URL = "https://api.hackudc.com";
/**
 * Explicit Expo env override for local/preview development servers. Release
 * builds bake the production URL into `EXPO_PUBLIC_API_URL` (EAS production
 * environment); that is not an override, or it would force development mode
 * onto production and leave the switch unable to reach staging (#935).
 */
export function localApiUrlOverride(value: string | undefined): string | null {
  const url = value?.trim().replace(/\/+$/, "");
  return url && url !== PRODUCTION_API_URL ? url : null;
}
export const LOCAL_API_URL_OVERRIDE = localApiUrlOverride(process.env.EXPO_PUBLIC_API_URL);
export const DEVELOPMENT_API_URL = LOCAL_API_URL_OVERRIDE ?? "https://api.dani.md";

/** The active base URL. Changed only by the persisted developer endpoint mode. */
export let API_URL = PRODUCTION_API_URL;

const apiUrlListeners = new Set<() => void>();
export function onApiUrlChange(listener: () => void): () => void {
  apiUrlListeners.add(listener);
  return () => {
    apiUrlListeners.delete(listener);
  };
}
export function setApiUrl(url: string): void {
  if (API_URL === url) return;
  API_URL = url;
  for (const listener of apiUrlListeners) listener();
}

/** Public website where attendees register and review their application. */
export const EVENT_WEBSITE_URL =
  process.env.EXPO_PUBLIC_EVENT_WEBSITE_URL ?? "https://os.hackudc.com";

/** Compact, protocol-free form suitable for explanatory UI copy. */
export const EVENT_WEBSITE_DISPLAY = EVENT_WEBSITE_URL.replace(/^https?:\/\//, "").replace(
  /\/$/,
  "",
);

/**
 * Where the blocking update screen sends the user (#999). iOS needs the numeric
 * App Store ID (`EXPO_PUBLIC_IOS_APP_STORE_ID`, same value as `ascAppId`);
 * without it the event website is the fallback.
 */
export function storeUrl(platform: string, iosAppId = process.env.EXPO_PUBLIC_IOS_APP_STORE_ID) {
  if (platform === "android") return "market://details?id=com.hackudc.os";
  return iosAppId && /^\d+$/.test(iosAppId)
    ? `itms-apps://apps.apple.com/app/id${iosAppId}`
    : EVENT_WEBSITE_URL;
}
