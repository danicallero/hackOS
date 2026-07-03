# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable pnpm
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile --filter @hackos/api...
COPY apps/api ./apps/api
RUN pnpm --filter @hackos/api build

FROM base AS deploy
ENV NODE_ENV=production
COPY --from=build /repo /repo
RUN pnpm prune --prod
WORKDIR /repo/apps/api

# Migrations run at container start, guarded by an advisory lock, so N
# replicas can boot concurrently. Worker containers override CMD with
# `node dist/worker.js`.
EXPOSE 3000
CMD ["sh", "-c", "node dist/migrate.js && node dist/server.js"]
