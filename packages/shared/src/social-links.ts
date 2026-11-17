/**
 * #934, #935: networks whose link is a fixed address plus a handle, so the
 * profile editors (web and mobile) show the address and only the handle is typed.
 */
export const SOCIAL_HANDLE_PREFIX: Partial<Record<string, string>> = {
  linkedin: "linkedin.com/in/",
  x: "x.com/",
  instagram: "instagram.com/",
};

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The handle part of a stored link; a pasted full address is reduced the same way. */
export function handleOf(url: string, prefix: string): string {
  const lead = "^(https?://)?(www\\.)?";
  const value = url.trim();
  const full = value.replace(new RegExp(`${lead}${escapeRe(prefix)}`, "i"), "");
  if (full !== value) return full;
  return value.replace(new RegExp(`${lead}${escapeRe(prefix.split("/")[0] ?? "")}/?`, "i"), "");
}

/** The stored link for a typed (or pasted) handle; empty when there is no handle. */
export function urlForHandle(input: string, prefix: string): string {
  const handle = handleOf(input, prefix);
  return handle ? `https://${prefix}${handle}` : "";
}
