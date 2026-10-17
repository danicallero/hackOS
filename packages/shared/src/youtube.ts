/** H16: normalize video links before embedding third-party content. */
export function youtubeEmbedUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const id =
      url.hostname === "youtu.be"
        ? url.pathname.slice(1)
        : ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)
          ? url.pathname === "/watch"
            ? url.searchParams.get("v")
            : /^\/(?:shorts|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[1]
          : null;
    return id && /^[A-Za-z0-9_-]{11}$/.test(id)
      ? `https://www.youtube-nocookie.com/embed/${id}`
      : null;
  } catch {
    return null;
  }
}
