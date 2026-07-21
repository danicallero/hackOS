# hackOS

hackOS is the hackathon management platform we built to replace four
disconnected legacy tools (applications, check-in, judging, TV displays) with
one system. It's a Fastify API, a Next.js frontend, and a shared package for
the two conventions that have to stay identical across both: permission
capabilities and realtime event names.

If you're looking for *what the system is supposed to do*, that lives in
[`plan/historias-hackos.md`](plan/historias-hackos.md) — the user stories
(H1–H55) are the functional source of truth, not this file. This README gets
you running locally and orients you to the rest of the docs.

## Stack

- **API** — Fastify 5, TypeScript, raw SQL against Postgres (`pg`, no ORM),
  BullMQ + Valkey for background ticks, Better Auth for sessions, SSE for
  realtime, MinIO (S3-compatible) for file storage.
- **Web** — Next.js 16 (App Router), React 19, Tailwind v4, shadcn/ui.
- **Mobile** — Expo Router (React Native), Better Auth's Expo plugin +
  `expo-secure-store` for session continuity (H4, H55).
- **Shared** — `packages/shared` holds the capability catalogue and the SSE
  event contract. All apps import from here; none hardcodes these strings.

```
apps/api        Fastify API + BullMQ workers
apps/web        Next.js frontend
apps/mobile     Expo Router mobile app
packages/shared capability catalogue, SSE event names
plan/           user stories & architecture decisions (read-only, normative)
docs/           how the current code implements the stories
deploy/         Dokploy / docker compose deployment
```

## Running it locally

You need Docker, Node 22+, and pnpm 10.

```sh
pnpm install
pnpm infra:up      # postgres:5433, valkey:6379, minio:9000/9001, mailpit:8025
pnpm migrate       # apply db migrations
pnpm dev           # api on :3000, web on :3001
```

`apps/api` reads its config from environment variables validated by
`src/config.ts` (zod); the defaults already match `docker-compose.yml`, so an
empty `.env` works for local dev. Copy `.env.example` if you need to override
anything.

Useful scripts:

```sh
pnpm --filter @hackos/api test   # vitest, wipes + remigrates hackos_test, runs serially
pnpm --filter @hackos/web test   # vitest, colocated unit tests
pnpm --filter @hackos/mobile test  # jest
pnpm lint                        # biome + copy/localization + page-size checks, whole repo
pnpm check:copy                  # just the copy/localization check (scripts/check-copy.mjs)
pnpm check:pages                 # just the page-size ratchet (scripts/check-page-size.mjs)
pnpm --filter @hackos/api superadmin:create   # bootstrap the first admin
```

Mailpit (`localhost:8025`) catches every outbound email in dev — nothing
actually gets sent. MinIO console is at `localhost:9001`.

For a quick mobile start against the local API:

```sh
cd apps/mobile
EXPO_PUBLIC_API_URL=http://localhost:3000 pnpm start   # then press w/i/a for web/iOS/Android
```

See [`docs/mobile.md`](docs/mobile.md) for what's built so far and what's
deferred to device verification. The complete local-build, prebuild, EAS,
signing, certificates, artwork, and App Store/Play Store runbook is
[`docs/mobile-release.md`](docs/mobile-release.md).

## API docs

The API documents itself: every route carries a Zod schema that Fastify turns
into an OpenAPI document at request time, served at `/documentation` when the
API is running (Swagger UI). There's no separate spec to keep in sync by
hand — if a route's schema is wrong, the docs are wrong, and vice versa.
Adding a route means giving it a real `summary`/`description` in its schema,
not leaving the auto-generated placeholder (see `apps/api/src/app.ts` for how
tags and auth requirements are derived, and `CLAUDE.md` for the rule).




