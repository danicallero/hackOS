/**
 * Shared same-origin return-path guard (H1-H5, H9-H10): the only destinations
 * signup, login, verify-email, password recovery, and claim-account are ever
 * allowed to redirect to after finishing their own flow. A relative path
 * starting with a single `/` is same-origin by construction; anything else
 * (an absolute URL, or a protocol-relative `//host` which browsers resolve as
 * absolute) could send a user off-site and is rejected in favor of the
 * fallback (H188: return destinations must be same-origin guarded).
 */
export function safeReturnPath(
  candidate: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (candidate?.startsWith("/") && !candidate.startsWith("//")) return candidate;
  return fallback;
}

/** Appends `?next=<encoded>` to `href` when `next` is a safe same-origin path. */
export function withReturnPath(href: string, next: string | null | undefined): string {
  if (!next?.startsWith("/") || next.startsWith("//")) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}next=${encodeURIComponent(next)}`;
}
