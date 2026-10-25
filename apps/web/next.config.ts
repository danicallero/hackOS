import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Self-contained server bundle for a lean production Docker image
  // (apps/web/Dockerfile). The web app is its own deployable service behind
  // Caddy — it is never served by the API.
  output: "standalone",
  // @hackos/shared ships raw TypeScript (exports point at src/*.ts); let Next
  // compile it as part of the app build.
  transpilePackages: ["@hackos/shared"],
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
      // Nothing is indexed except the public pages listed in app/robots.ts; icons, logos
      // and generated images included.
      {
        source: "/:path((?!timetable|privacy|terms|gallery|llms\\.txt).+)",
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
