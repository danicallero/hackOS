/** Path component of a request URL (no query string). */
export function pathOf(url: string): string {
  return url.split("?", 1)[0] ?? url;
}

/** Infrastructure probe endpoints that bypass admission, maintenance and version gates. */
export const PROBE_PATHS = ["/healthz", "/readyz", "/metrics"] as const;

export function isProbePath(path: string): boolean {
  return (PROBE_PATHS as readonly string[]).includes(path);
}

/** `path` equals `prefix` or sits beneath it (`/api/me` matches `/api/me/x`, not `/api/mex`). */
export function pathMatchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}
