import type { MetadataRoute } from "next";
import { INDEXABLE_PUBLIC_PATHS } from "@/lib/public-paths";

// Only public information is crawlable (home plus INDEXABLE_PUBLIC_PATHS).
// Everything else says no here, in X-Robots-Tag (next.config.ts) and in its
// page metadata.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/$", ...INDEXABLE_PUBLIC_PATHS.map((path) => `/${path}`)],
      disallow: "/",
    },
  };
}
