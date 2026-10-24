import type { MetadataRoute } from "next";

// Only public information is crawlable: home, schedule, legal pages, the public
// gallery and llms.txt. Everything else says no here, in X-Robots-Tag
// (next.config.ts) and in its page metadata. Keep the three lists in step.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/$", "/horario", "/privacy", "/terms", "/gallery", "/llms.txt"],
      disallow: "/",
    },
  };
}
