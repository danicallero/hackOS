# hackOS web image. Build from the repo ROOT:
#   docker build -f apps/web/Dockerfile -t hackos-web \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com .
#
# The web frontend is a STANDALONE Next.js server. It is deployed as its own
# service behind its OWN Traefik router (deploy/services/web) — it is never
# served by, or routed together with, the API.
#
# NEXT_PUBLIC_API_URL is inlined into the client bundle at build time, so it
# must be supplied as a build arg. Each instance/domain builds its own image
# (matches the "one stack per instance" deploy model in deploy/README.md).

FROM node:22-alpine AS base
# Pre-install pnpm to avoid corepack's lazy download on every build
RUN corepack enable && corepack install --global pnpm@10.19.0 && pnpm --version
WORKDIR /repo

# ── deps + build ───────────────────────────────────────────────────────────
FROM base AS build
# Increase Node memory limit for the Pi's constrained RAM during Next build
ENV NODE_OPTIONS="--max-old-space-size=2048"
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/web/package.json ./apps/web/
RUN --mount=type=cache,id=pnpm-store-web,target=/root/.local/share/pnpm/store/v10 \
    pnpm install --no-frozen-lockfile --filter @hackos/web...
# Copy only what's needed for the build — skip tests, .next cache, etc.
COPY apps/web/next.config.ts apps/web/tsconfig.json apps/web/postcss.config.mjs apps/web/eslint.config.mjs apps/web/components.json ./apps/web/
COPY apps/web/src ./apps/web/src
COPY apps/web/public ./apps/web/public

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1
# --no-lint skips the ESLint pass (saves memory; lint is CI-only).
# Cache .next/cache across builds so Next's compilation step is incremental.
RUN --mount=type=cache,id=next-cache,target=/repo/apps/web/.next/cache \
    pnpm --filter @hackos/web exec next build --no-lint

# ── minimal runtime, non-root ──────────────────────────────────────────────
FROM base AS deploy
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
RUN apk add --no-cache tini

# Next's standalone output ships a trimmed server + node_modules. Copy it plus
# the static assets and public dir into their expected locations.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

# Start script that picks the correct server.js path produced by Next's
# standalone output. If missing, it prints directory listings to aid debugging.
RUN cat > /usr/local/bin/start-server.sh <<'SH'
#!/bin/sh
set -e
# Prefer absolute paths under /repo (WORKDIR) to avoid surprises
if [ -f /repo/server.js ]; then
  exec node /repo/server.js
elif [ -f /repo/apps/web/server.js ]; then
  exec node /repo/apps/web/server.js
elif [ -f server.js ]; then
  exec node server.js
else
  echo "server.js not found, listing /repo:" >&2
  ls -al /repo || true
  echo "listing /repo/apps/web:" >&2
  ls -al /repo/apps/web || true
  exit 1
fi
SH
RUN chmod +x /usr/local/bin/start-server.sh

USER node
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/ || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/start-server.sh"]
