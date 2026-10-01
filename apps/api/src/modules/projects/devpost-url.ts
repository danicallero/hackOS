/** H16/#854: resolve only Devpost redirects, never a participant-supplied host. */
export function normalizeDevpostUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !/^(?:[a-z0-9-]+\.)?devpost\.com$/i.test(url.hostname) ||
      !/^\/(software|submissions)\/[^/]+\/?$/i.test(url.pathname)
    )
      return null;
    const host =
      url.hostname.toLowerCase() === "www.devpost.com" ? "devpost.com" : url.hostname.toLowerCase();
    return `https://${host}${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return null;
  }
}

export async function resolveDevpostUrl(
  value: string | null,
  signal = AbortSignal.timeout(4000),
): Promise<string | null> {
  let current = normalizeDevpostUrl(value);
  if (!current) return null;
  if (
    new URL(current).hostname === "devpost.com" &&
    new URL(current).pathname.startsWith("/software/")
  )
    return current;
  try {
    for (let hop = 0; hop < 5; hop++) {
      const response = await fetch(current, { redirect: "manual", signal });
      await response.body?.cancel();
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return null;
        current = normalizeDevpostUrl(new URL(location, current).href);
        if (!current) return null;
        if (new URL(current).pathname.startsWith("/software/")) return current;
      } else return response.ok ? current : null;
    }
  } catch {
    /* An unavailable Devpost must not prevent an import. */
  }
  return null;
}

/** Resolve outside database transactions; bounded concurrency also covers older imports. */
export async function resolveDevpostUrls(values: Array<string | null>) {
  const pending = [...new Set(values.filter((value): value is string => value !== null))];
  const resolved = new Map<string, string | null>();
  const signal = AbortSignal.timeout(5000);
  await Promise.all(
    Array.from({ length: Math.min(8, pending.length) }, async () => {
      for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
        resolved.set(value, signal.aborted ? null : await resolveDevpostUrl(value, signal));
      }
    }),
  );
  return resolved;
}
