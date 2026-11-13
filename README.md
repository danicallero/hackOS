# hackOS

hackOS runs the parts of a hackathon that usually end up spread across forms,
spreadsheets, a check-in app and a judging tool. Applications, participant
records, projects, badges, meals, judging rooms, announcements and venue
screens all work from the same data.

The project started with a practical goal: replace four disconnected tools
without making event day depend on perfect Wi-Fi. It is built as a Fastify API,
a Next.js web app and an Expo mobile app, with Postgres as the source of truth
for all three.

## Where to go

| You want to | Read |
|---|---|
| Run it on your machine | [Run it locally](#run-it-locally) below |
| Change code (people and coding agents) | [`AGENTS.md`](AGENTS.md), then [`CLAUDE.md`](CLAUDE.md) |
| Know what the product must do | [`plan/historias-hackos.md`](plan/historias-hackos.md) (stories H1–H67) |
| Know the rules that can never break | [`plan/07-datos-relevantes-ers.md`](plan/07-datos-relevantes-ers.md) |
| Find the doc for a module, screen or system | [`docs/README.md`](docs/README.md) |
| See every API route | `/documentation` on a running API |
| Deploy or operate it | [`deploy/README.md`](deploy/README.md) |

If two documents disagree, the user stories win.

## What it covers

Before the event, hackOS handles account verification, configurable application
forms, review and acceptance, place confirmation, sponsor profiles, challenge
publishing, schedules and project submissions. An account whose email is
still unverified can sign in, browse its workspace and save preparation drafts,
but event transactions—such as submitting an application, confirming a place,
or changing event operations—require verification. Participants can follow
their own application and project without getting access to the staff side of
the system.

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
| [`apps/web`](apps/web)       | Participants, organisers, judges and sponsors | Applications, administration, projects, judging,        logistics dashboards, public schedule and TV screens |
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
- **Files and mail:** MinIO provides S3-compatible storage locally. Email uses
  SMTP (Amazon SES can provide the production relay); local mail is caught by
  Mailpit.
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
pnpm infra:up     # Postgres, Valkey, MinIO and Mailpit in Docker
pnpm migrate
pnpm dev          # API and web on the host
```

No environment file is needed for the first start. To change credentials or
ports, copy [`.env.example`](.env.example) to `apps/api/.env` and edit only
what you need.

| Service           | Address                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| Web app           | [http://localhost:3001](http://localhost:3001)                             |
| API               | [http://localhost:3000](http://localhost:3000)                             |
| API documentation | [http://localhost:3000/documentation](http://localhost:3000/documentation) |
| Mailpit inbox     | [http://localhost:8025](http://localhost:8025)                             |
| MinIO console     | [http://localhost:9001](http://localhost:9001)                             |

### Create the first administrator

`system:superadmin` holds every capability and can only be managed from the
command line, never through the HTTP API (H8). Run these with `DATABASE_URL`
pointing at the target database:

```sh
pnpm --filter @hackos/api superadmin:create \
  --email admin@example.com --password 'choose-a-local-password' \
  --name Local --surname Admin                                      # new account
pnpm --filter @hackos/api superadmin:grant --email admin@example.com   # existing account
pnpm --filter @hackos/api superadmin:list
pnpm --filter @hackos/api superadmin:revoke --email admin@example.com
```

Creating or granting refuses to add a second superadmin unless you pass
`--allow-existing-admin`, and revoking refuses to remove the last one. Every
change is written to the audit log. On a deployed host use
`/opt/hackos/services.sh <environment> superadmin`
([`deploy/README.md`](deploy/README.md)); the design rationale is in
[`docs/audits/access-control-audit-plan.md`](docs/audits/access-control-audit-plan.md).

### Demo data

Against a disposable local database:

```sh
pnpm --filter @hackos/api seed        # bootstrap admin role and user
pnpm --filter @hackos/api seed:mock   # realistic people, companies, applications, projects, tickets
```

Details are in [`docs/ui-testing.md`](docs/ui-testing.md).

### Start the mobile app

`pnpm dev` starts the API and web app only. Run Expo separately:

```sh
cd apps/mobile
EXPO_PUBLIC_API_URL=http://localhost:3000 pnpm start
```

Then press `w`, `i` or `a` for web, iOS or Android. A phone cannot reach your
computer through `localhost`; use the computer's LAN address. The camera, push
notifications, encrypted scanner storage and Wallet passes need a development
build or a real device. The complete setup is in
[`docs/mobile-release.md`](docs/mobile-release.md).

## Everyday commands

```sh
pnpm dev                              # API :3000 and web :3001
pnpm dev:api                          # API only
pnpm dev:web                          # web only
pnpm build                            # build every workspace
pnpm typecheck                        # API, web and mobile

pnpm lint                             # Biome plus the copy, story-ID and size guards
pnpm --filter @hackos/api test        # API integration tests (needs pnpm infra:up)
pnpm --filter @hackos/api test:serial test/<file>.test.ts   # one API test file
pnpm --filter @hackos/web test        # web unit tests
pnpm --filter @hackos/mobile test     # mobile Jest tests
pnpm --filter @hackos/shared test     # shared contracts
pnpm test:ui:install                  # install Playwright browsers once
pnpm test:ui                          # Playwright + fast native screen tests
pnpm test:ui:native                   # Detox on a simulator or device

pnpm migrate                          # apply pending SQL migrations
pnpm schema:dump                      # regenerate the schema ERD
pnpm schema:check                     # compare a migrated DB with the checked-in ERD
pnpm infra:down                       # stop local infrastructure
```

API tests run against real Postgres, Valkey, MinIO and Mailpit, in four shards
with their own databases. How the runner works, and how to point it at
isolated services, is in [`docs/testing.md`](docs/testing.md). Load tests and
the pre-event qualification run are in
[`docs/big-event-readiness.md`](docs/big-event-readiness.md).

## Contributing

- Read [`AGENTS.md`](AGENTS.md) first. It says what else to read for the area
  you are touching, and applies to people and coding agents alike.
- [`CLAUDE.md`](CLAUDE.md) lists the conventions every change follows:
  capability-based permissions, audited mutations in the same transaction,
  idempotent and row-locked state transitions, raw parameterised SQL,
  es/gl/en copy, and which doc to update with which code.
- Reference the story (`H29`) or the issue (`#934`) in every commit and PR.
- Open every pull request as a draft against `staging` (development) or
  `main` (production). Drafts run lint, contract tests and typecheck; marking
  a PR ready runs the full test matrix.
- A change that alters a screen ships screenshots in a PR comment
  ([`docs/ui-testing.md`](docs/ui-testing.md)).

## Repository guide

```text
apps/api/             Fastify routes, domain services, workers and migrations
apps/web/             Next.js app, public site, operator workspaces and TVs
apps/mobile/          Expo app, native integrations and offline scanner data
packages/shared/      capability, event and cross-client contracts
e2e/                  Playwright and Detox flows
plan/                 normative user stories and hard invariants
docs/                 how the current code works, one doc per topic
deploy/               canonical Docker Compose runtime and host runbook
.claude/              agent skills and lessons learned from corrections
```

The backend is split by domain under `apps/api/src/modules`; the map of what
each module owns is in [`docs/api-reference.md`](docs/api-reference.md). Web
conventions and the component library are in
[`apps/web/README.md`](apps/web/README.md), the mobile app in
[`docs/mobile.md`](docs/mobile.md), and the design rules for every surface in
[`docs/DESIGN.md`](docs/DESIGN.md).

## Deployment

Staging and production are separate Compose projects built from the same
images: staging on an ARM64 host, production in a Linux/x86_64 LXC. Merging
into `staging` or `main` builds only the affected API or web image; staging
then deploys automatically and production is rolled out by an operator.
Postgres, Valkey and MinIO stay on private networks, and migrations run under
an advisory lock before the API starts.

[`deploy/README.md`](deploy/README.md) is the runbook (CI/CD paths, secrets,
health gates, rollback) and [`docs/env-vars.md`](docs/env-vars.md) the
per-service environment checklist. Checks that still need real devices before
a mobile release are tracked in
[`docs/mobile-store-release.md`](docs/mobile-store-release.md#before-release).

## License

[AGPL-3.0-only](LICENSE.md).
