import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { INDEXABLE_PUBLIC_PATHS } from "./src/lib/public-paths";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Self-contained server bundle for a lean production Docker image
  // (apps/web/Dockerfile). The web app is its own deployable service behind
  // Caddy — it is never served by the API.
  output: "standalone",
  // @hackos/shared ships raw TypeScript (exports point at src/*.ts); let Next
  // compile it as part of the app build.
  transpilePackages: ["@hackos/shared"],
  // Route changes are React transitions; <ViewTransition> in (app)/template.tsx
  // crossfades the content region (docs/DESIGN.md §2 "Route transitions").
  experimental: { viewTransition: true },
  async rewrites() {
    // #935 Android App Links: generated from deployment env, see the route.
    return [{ source: "/.well-known/assetlinks.json", destination: "/android-assetlinks.json" }];
  },
  async redirects() {
    // The public schedule used to live at its own route; it is now /timetable for everyone.
    return [{ source: "/horario", destination: "/timetable", permanent: true }];
  },
  async headers() {
    return [
      // Nothing is indexed except the public pages listed in lib/public-paths.ts; icons, logos
      // and generated images included.
      {
        source: `/:path((?!${INDEXABLE_PUBLIC_PATHS.map((path) => path.replaceAll(".", "\\.")).join("|")}).+)`,
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
        ],
      },
      // #1083: certificate pages also never leak the code through Referer.
      {
        source: "/verify/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/applications/:action(confirm|decline)",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        source: "/verify-email",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
    ];
  },
  // The monorepo root is two levels up; needed so `standalone` traces
  // workspace deps (@hackos/shared) correctly.
  outputFileTracingRoot: path.join(dirname, "../../"),
};

export default nextConfig;
