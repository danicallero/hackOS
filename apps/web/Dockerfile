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
RUN corepack enable pnpm
WORKDIR /repo

# ── deps + build ───────────────────────────────────────────────────────────
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/web/package.json ./apps/web/
RUN pnpm install --no-frozen-lockfile --filter @hackos/web...
COPY apps/web ./apps/web

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @hackos/web build

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

USER node
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/ || exit 1

# Start script that picks the correct server.js path produced by Next's
# standalone output. If missing, it prints directory listings to aid debugging.
RUN cat > /usr/local/bin/start-server.sh <<'SH'\n#!/bin/sh\nset -e\n# Prefer absolute paths under /repo (WORKDIR) to avoid surprises\nif [ -f /repo/server.js ]; then\n  exec node /repo/server.js\nelif [ -f /repo/apps/web/server.js ]; then\n  exec node /repo/apps/web/server.js\nelif [ -f server.js ]; then\n  exec node server.js\nelse\n  echo "server.js not found, listing /repo:" >&2\n  ls -al /repo || true\n  echo "listing /repo/apps/web:" >&2\n  ls -al /repo/apps/web || true\n  exit 1\nfi\nSH
RUN chmod +x /usr/local/bin/start-server.sh

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/start-server.sh"]
