/**
 * `Content-Disposition: attachment` for a download. Quotes, backslashes, path
 * separators and control characters are dropped from the filename so
 * interpolated ids or params cannot break out of the header; non-ASCII names
 * also get an RFC 5987 `filename*` so the original survives.
 */
export function contentDisposition(filename: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point.
  const cleaned = filename.replace(/[\u0000-\u001f\u007f"\\/;]/g, "").trim() || "download";
  // Non-ASCII characters become "_" in the legacy fallback parameter.
  const ascii = cleaned.replace(/[^\x20-\x7e]/g, "_");
  if (ascii === cleaned) return `attachment; filename="${cleaned}"`;
  const encoded = encodeURIComponent(cleaned).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
