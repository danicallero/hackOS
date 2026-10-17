/**
 * Template URL validation accepts a hostname without a protocol. Browsers,
 * however, interpret that form as an internal relative path, so add HTTPS
 * before rendering a submitted answer as a link.
 */
export function externalUrlHref(value: string): string | null {
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
