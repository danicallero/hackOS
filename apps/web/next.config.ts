import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Self-contained server bundle for a lean production Docker image
  // (apps/web/Dockerfile). The web app is its OWN deployable service behind
  // its OWN Traefik router — it is never served by the API.
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
  // @hackos/shared ships raw TypeScript (exports point at src/*.ts); let Next
  // compile it as part of the app build.
  transpilePackages: ["@hackos/shared"],
  // The monorepo root is two levels up; needed so `standalone` traces
  // workspace deps (@hackos/shared) correctly.
  outputFileTracingRoot: path.join(dirname, "../../"),
};

export default nextConfig;
