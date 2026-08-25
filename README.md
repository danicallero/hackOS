# hackOS

hackOS runs the parts of a hackathon that usually end up spread across forms,
spreadsheets, a check-in app and a judging tool. Applications, participant
records, projects, badges, meals, judging rooms, announcements and venue
screens all work from the same data.

The project started with a practical goal: replace four disconnected tools
without making event day depend on perfect Wi-Fi. It is built as a Fastify API,
a Next.js web app and an Expo mobile app, with Postgres as the source of truth
for all three.

The product is defined by the 55 user stories in
[`plan/historias-hackos.md`](plan/historias-hackos.md). This README is the short
tour and the quickest way to get a development environment running.

## What it covers

Before the event, hackOS handles account verification, configurable application
forms, review and acceptance, place confirmation, sponsor profiles, challenge
publishing, schedules and Devpost imports. Participants can follow their own
application and project without getting access to the staff side of the system.

At the venue, staff can accredit arrivals, assign or replace badges, record
entries and exits, serve meals and scan attendance at activities. The mobile
scanner keeps an encrypted local roster and a durable queue of pending scans,
so a bad connection does not turn the door or meal line into a spreadsheet.
The API still gives the final acknowledgement for every operation.

Judging has its own explicit workflow: a team can be waiting, called, in the
room, presenting or complete. Shared queues prevent the same team from being
called into two rooms at once. Judges score together, operators can recover
from no-shows and room pauses, participants see their position and estimated
time, and the venue screens update over server-sent events.

There is also an inbox and notification preference system, scheduled
announcements, Apple and Google Wallet support, operational CSV exports, data
export/deletion workflows and a queryable audit trail.

## The three apps


| App                          | Who it is for                                 | Main jobs                                                                                                   |
| ---------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`apps/web`](apps/web)       | Participants, organisers, judges and sponsors | Applications, administration, project import, judging, logistics dashboards, public schedule and TV screens |
| [`apps/mobile`](apps/mobile) | Participants and on-site operators            | Schedule, queue status, passes, notifications, queue operations and offline-capable scanners                |
| [`apps/api`](apps/api)       | Both clients and external consumers           | Authentication, domain rules, OpenAPI, background work, realtime streams and storage access                 |


Navigation is additive. Everyone keeps their personal area, while workspaces
and mobile tabs appear from the account's effective capabilities. A participant
who is also judging does not need to switch roles, and a permission change can
change the mobile navigation without a new build.

Public pages do not require an account. They expose the published schedule,
challenges, sponsors and TV display, while operational streams and private
project data stay behind authentication and contextual access checks.

## How it is put together

- **API:** Fastify 5, TypeScript, Better Auth and Zod-backed route schemas.
Those schemas generate the live OpenAPI documentation at `/documentation`.
- **Web:** Next.js 16 App Router, React 19, Tailwind CSS v4 and shadcn/ui.
- **Mobile:** Expo Router, React Native, Secure Store, SQLite, Expo
Notifications and native Wallet integrations.
- **Database:** Postgres 17 with parameterised raw SQL and versioned SQL
migrations. There is no ORM.
- **Background work and realtime:** BullMQ ticks and SSE fan-out use Valkey.
Durable work, retries and dead-letter state remain in Postgres, so Valkey can
be treated as ephemeral.
- **Files and mail:** MinIO provides S3-compatible storage locally. Email can
go through SMTP, Resend or Postal; local mail is caught by Mailpit.
- **Shared contracts:** [`packages/shared`](packages/shared) owns capability
names, realtime event names and cross-client UI test identifiers.

The API and worker use the same image in production. The API serves HTTP and
SSE; the worker wakes up periodically to drain durable database-backed work
such as email delivery, scheduled publishing, confirmation expiry and queue
top-up. In development those workers run inside the API process.

For the fuller system diagram and the reasoning behind these choices, read
[`docs/architecture.md`](docs/architecture.md).

## Run it locally

You need Docker, Node 22 or newer, and pnpm 10.

```sh
pnpm install
pnpm infra:up
pnpm migrate
pnpm dev
```

`pnpm infra:up` starts Postgres, Valkey, MinIO and Mailpit. The API and web app
then run on the host with development defaults, so no environment file is
required for the first start.

Once everything is up:


| Service           | Address                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| Web app           | [http://localhost:3001](http://localhost:3001)                             |
| API               | [http://localhost:3000](http://localhost:3000)                             |
| API documentation | [http://localhost:3000/documentation](http://localhost:3000/documentation) |
| Mailpit inbox     | [http://localhost:8025](http://localhost:8025)                             |
| MinIO console     | [http://localhost:9001](http://localhost:9001)                             |


If you need different local credentials or ports, copy [`.env.example`](.env.example)
to `apps/api/.env` and change only the values you need.

### Create the first administrator

The bootstrap command creates a verified account and grants it the `*`
capability through the normal permission-group model:

```sh
pnpm --filter @hackos/api superadmin:create \
  --email admin@example.com \
  --password 'choose-a-local-password' \
  --name Local \
  --surname Admin
```

It refuses to create a second superadmin unless
`--allow-existing-admin` is passed deliberately.

### Start the mobile app

The root `pnpm dev` command starts the API and web app only. Run Expo separately:

```sh
cd apps/mobile
EXPO_PUBLIC_API_URL=http://localhost:3000 pnpm start
```

Then press `w`, `i` or `a` for web, iOS or Android. A phone cannot reach your
computer through `localhost`; use the computer's LAN address instead. Native
features such as the camera, push notifications, encrypted scanner storage and
Wallet passes need a development build or real device, not just Expo's web
target. The complete setup is in
[`docs/mobile-release.md`](docs/mobile-release.md).

## Everyday commands

```sh
pnpm dev                              # API :3000 and web :3001
pnpm dev:api                          # API only
pnpm dev:web                          # web only
pnpm build                            # build every workspace with a build script
pnpm typecheck                        # API, web and mobile TypeScript checks

pnpm lint                             # Biome, copy/i18n and page-size checks
pnpm --filter @hackos/api test        # API integration tests
pnpm --filter @hackos/web typecheck   # web TypeScript check
pnpm --filter @hackos/web test        # web unit tests
pnpm --filter @hackos/mobile typecheck
pnpm --filter @hackos/mobile test     # mobile Jest tests

# Representative event-day load (H22-H42, H46, #544)
pnpm --filter @hackos/api event-day:load -- --mode smoke

# Disposable pre-event qualification on the actual host (exact release image)
RELEASE_IMAGE=ghcr.io/example/hackos-api@sha256:<64-hex-release-digest> \
  QUALIFICATION_ARTIFACT_DIR="$PWD/artifacts/event-day-qualification" \
  ./deploy/qualification/run.sh

pnpm test:ui                          # Playwright + fast native screen tests
pnpm test:ui:install                  # install Playwright browsers once
pnpm test:ui:native                   # Detox on a simulator/device

pnpm migrate                          # apply pending SQL migrations
pnpm schema:dump                      # regenerate the current-schema DBML ERD
pnpm infra:down                       # stop local infrastructure
```

API tests use real Postgres and Valkey. The test harness resets and migrates
`hackos_test`, and the suite runs serially to keep state-dependent integration
tests deterministic.

Pull requests and pushes to `main` run the same checks in GitHub Actions. Lint,
the selective `typecheck` check, and the API, web and mobile unit suites are
separate required checks. Workspace checks run only when their area changes;
shared packages, dependency/toolchain changes, and workflow changes run all
affected gates. The API job provides fresh Postgres, Valkey and Mailpit service
containers plus health-checked MinIO, then provisions the test bucket; local
API runs still use `pnpm infra:up` and the commands above.

## Repository guide

```text
apps/api/             Fastify routes, domain services, workers and migrations
apps/web/             Next.js app, public site, operator workspaces and TVs
apps/mobile/          Expo app, native integrations and offline scanner data
packages/shared/      capability, event and cross-client test contracts
e2e/                  Playwright and Detox flows
plan/                 normative user stories and hard invariants
docs/                 current architecture and implementation notes
deploy/               Docker Compose and Dokploy deployment files
```

The backend is split by domain under `apps/api/src/modules`: identity,
applications, projects, challenges, sponsors, event configuration, logistics,
queue and judging, notifications, and exports. Each module owns its routes and
services; background processors are registered from the same module.

The web app has a stable personal area plus capability-gated workspaces for
applications, projects, live judging, logistics, programme, sponsors,
communications, event setup, and access/audit. The mobile app uses the same
capability catalogue to choose between participant tabs, queue operations and
scanner tools.

## Rules that matter here

A few conventions are part of the architecture rather than style preferences:

- Authorisation checks concrete capabilities, never the display role.
- Sensitive mutations write their audit entry in the same transaction as the
domain change.
- Critical transitions are idempotent and lock the relevant Postgres rows, so
concurrent requests have one winner.
- Every queue action produces one history row and one realtime broadcast.
- User-facing copy is kept in Spanish, Galician and English.
- Capability and event strings come from `@hackos/shared`; clients and the API
do not invent their own copies.

Read [`CLAUDE.md`](CLAUDE.md) before changing code. It is the concise list of
non-negotiable conventions and tells you which documentation must change with
each part of the system. If two documents disagree, the user stories in
[`plan/historias-hackos.md`](plan/historias-hackos.md) win; the hard concurrency
and state rules are in
[`plan/07-datos-relevantes-ers.md`](plan/07-datos-relevantes-ers.md).

Useful next reads:

- [`docs/README.md`](docs/README.md) — documentation index
- [`apps/web/README.md`](apps/web/README.md) — frontend conventions and shared components
- [`docs/mobile.md`](docs/mobile.md) — mobile implementation and device-QA status
- [`docs/background-workers.md`](docs/background-workers.md) — tick workers, retries and event boundaries
- [`docs/navigation.md`](docs/navigation.md) — capability-to-workspace and tab mapping
- [`docs/ui-testing.md`](docs/ui-testing.md) — browser, native and screenshot testing

## Deployment

Production is designed as one isolated stack per event. The API, worker and web
services can be deployed independently; Postgres, Valkey and MinIO stay on a
private network, while Traefik exposes only the API and web routes. A one-shot
migration command runs before the API starts and uses a Postgres advisory lock
to make concurrent deploys safe.

[`deploy/README.md`](deploy/README.md) documents both the recommended
per-service Dokploy setup and a single Compose stack, including secrets,
domains, mail providers, Wallet credentials, backups and multi-event hosting.
Use [`docs/env-vars.md`](docs/env-vars.md) as the per-service environment
variable checklist.

The mobile implementation and automated tests are in place. Offline recovery,
APNs/FCM delivery, camera behaviour, encrypted SQLite and Wallet flows still
need to be checked on real devices before release. The remaining checks are
tracked in [`docs/mobile.md`](docs/mobile.md#whats-left).
