import type { MetadataRoute } from "next";

// Nothing here is meant to be crawled; X-Robots-Tag (next.config.ts) and the
// page metadata say the same for anything a crawler reaches anyway.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
