# hackOS API image. Build from the repo ROOT:
#   docker build -f apps/api/Dockerfile -t hackos-api .
#
# One image, three run modes (override `command` in compose):
#   node dist/server.js    HTTP API           (default CMD)
#   node dist/worker.js    BullMQ worker       (no HTTP listener)
#   node dist/migrate.js   one-shot migrations (advisory-locked; exits 0)

FROM node:22-alpine AS base
RUN corepack enable pnpm
WORKDIR /repo

# ── build: install all deps, compile to dist/, then produce a self-contained
#    prod bundle via `pnpm deploy` (real node_modules, no workspace symlinks) ─
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile --filter @hackos/api...
# Copy source (only what's needed for build — skip test/ and config files)
COPY apps/api/src ./apps/api/src
COPY apps/api/scripts ./apps/api/scripts
COPY apps/api/tsup.config.ts ./apps/api/
# Build with just tsup (skip tsc typecheck to save memory on constrained hosts)
RUN pnpm --filter @hackos/api exec tsup
# Copies the built package + only its production deps into /app, resolving
# workspace deps to a flat, real node_modules that survives without the store.
RUN pnpm --filter @hackos/api deploy --prod --legacy /app

# ── deploy: minimal runtime, non-root ─────────────────────────────────────
FROM base AS deploy
ENV NODE_ENV=production
# tini gives us a real init (signal forwarding + zombie reaping) so SIGTERM
# from the orchestrator reaches Node and triggers graceful shutdown.
RUN apk add --no-cache tini
COPY --from=build /app /app
WORKDIR /app

# Drop root. node:alpine ships an unprivileged `node` user (uid 1000).
USER node

EXPOSE 3000

# Liveness: the API's own /healthz pings Postgres + Valkey. Orchestrators
# (Dokploy/Traefik) use this to gate traffic and restarts.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
