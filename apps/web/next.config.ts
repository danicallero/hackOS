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
  async headers() {
    return [
      // #1083: certificate pages are never indexed, cached by crawlers or leaked through Referer.
      {
        source: "/verify/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
          { key: "Referrer-Policy", value: "no-referrer" },
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
