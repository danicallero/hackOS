# Environment variables per service (isolated containers)

This is the per-service breakdown for **Mode A** in
[`deploy/README.md`](../deploy/README.md): each of the six services below runs
as its own container on the shared private `instance` network
(`hackos-<name>-net`), reachable by the others only through that network, with
only `api` and `web` also joining the Traefik `edge` network. Datastores
publish no host ports.

Two different kinds of variable show up:

- **Container env** — lands in the process's environment inside the
  container (`printenv` would show it). This is what the app actually reads.
- **Compose-level** — only used to render the `docker-compose.yml` file
  itself (image tags, network names, Traefik labels, build args). The
  container never sees these directly, but the deploy breaks without them.

This is generated from the actual compose files
(`deploy/services/<service>/docker-compose.yml`) — if you add or rename a
variable there, update the matching table here in the same change (see the
documentation rule in `CLAUDE.md`).

If you're deploying on Dokploy, read
[**Centralizing values with Dokploy's Project/Environment variables**](#centralizing-values-with-dokploys-projectenvironment-variables)
at the bottom before copying secrets into six separate service screens.

## postgres

| Variable | Kind | Required | What it does |
|---|---|---|---|
| `POSTGRES_USER` | container | yes | The Postgres role Postgres itself creates on first boot, and the same value `api`/`worker`/`migrate` put in the user portion of `DATABASE_URL`. If these don't match, the API can't authenticate — there's no fallback or retry. |
| `POSTGRES_PASSWORD` | container | yes 🔒 | Password for that role. Same "must match `DATABASE_URL`" constraint as above; this is the single most consequential secret to keep in sync across services. |
| `POSTGRES_DB` | container | yes | The database Postgres creates on first boot and the API connects to. Only takes effect the *first* time the `pgdata` volume is initialized — changing it later doesn't rename an existing database. |
| `PG_MEM_LIMIT` | compose-level | no | Hard memory cap Docker enforces on the container (`deploy.resources.limits.memory`), default `1g`. Postgres gets OOM-killed and restarted if it exceeds this, not gracefully throttled — size it to your expected connection count and working set. |
| `INSTANCE_NETWORK` | compose-level | no | Name of the private bridge network this container joins, default `hackos-event2026-net`. Must be created on the host (`docker network create ...`) before this service can start — Dokploy doesn't create it for you. |

## valkey

| Variable | Kind | Required | What it does |
|---|---|---|---|
| `VALKEY_PASSWORD` | container | yes 🔒 | Passed to `valkey-server --requirepass`, so any client — including the healthcheck itself — must authenticate. Also embedded in `api`/`worker`'s `VALKEY_URL` (`redis://:<password>@valkey:6379`); a mismatch means BullMQ jobs and SSE fan-out silently stop working. |
| `VALKEY_MEM_LIMIT` | compose-level | no | Memory cap, default `512m`. Valkey here holds only ephemeral queue/SSE state (persistence is off — `--save ""` `--appendonly no`), so an OOM restart loses in-flight jobs but never durable data; Postgres is the source of truth. |
| `INSTANCE_NETWORK` | compose-level | no | Same private network as postgres — this is how `api`/`worker` reach `valkey:6379` by name. |

## minio

Two containers share this file: `minio` (the S3-compatible object server) and
`minio-init` (a one-shot sidecar that provisions the bucket, then exits).

| Variable | Kind | Required | What it does |
|---|---|---|---|
| `MINIO_ROOT_USER` | container (both) | yes | The MinIO admin account `minio-init` uses to create the bucket, and the value you'd hand the API as `S3_ACCESS_KEY` if you're using the root account directly instead of a scoped service account. |
| `MINIO_ROOT_PASSWORD` | container (both) | yes 🔒 | Password for that account; becomes `S3_SECRET_KEY` on `api`/`worker` under the same "use root or scope it down" choice. |
| `MINIO_BROWSER` | container (`minio`) | no | Toggles MinIO's own web console (`on`/`off`), default `off`. Leave it off — there's no Traefik route to it in this setup, so turning it on without also adding auth + a route just adds attack surface for no benefit. |
| `S3_BUCKET` | container (`minio-init`) | no | Bucket name `minio-init` creates and sets ACLs on (default `hackos`). Must be identical to `api`/`worker`'s `S3_BUCKET`, or the API will 404/error against a bucket that doesn't exist. |
| `MINIO_IMAGE` | compose-level | no | Image reference for the `minio` container. Defaults to `:latest`, which is fine for local dev but should be pinned to a concrete tag in production (see Security posture in `deploy/README.md`). |
| `MINIO_MC_IMAGE` | compose-level | no | Same pinning concern, for the `mc` CLI image `minio-init` runs to create the bucket and set its access policy. |
| `MINIO_MEM_LIMIT` | compose-level | no | Memory cap, default `1g`. |
| `INSTANCE_NETWORK` | compose-level | no | Same private network as postgres/valkey — `api`/`worker` reach it at `minio:9000`. |

## api

Runs two containers from the same image: a one-shot `migrate` (must complete
successfully before `api` starts — see the `depends_on: service_completed_successfully`
gate in the compose file) and the long-running `api` server. Both get
identical container env, because the migration script and the server share
the same `DATABASE_URL`/config-loading code path.

| Variable | Kind | Required | What it does |
|---|---|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | compose-level | yes | Interpolated into `DATABASE_URL` (`postgres://user:pass@postgres:5432/db`) before the container ever starts. Must be the exact values given to the `postgres` service — this repo has no runtime reconciliation between them. |
| `VALKEY_PASSWORD` | compose-level | yes 🔒 | Interpolated into `VALKEY_URL` the same way, for BullMQ and the SSE/sequence-counter layer. |
| `API_DOMAIN` | compose-level | yes | The public hostname this API answers on. Becomes both `BETTER_AUTH_URL` (so Better Auth issues cookies/links for the right origin) and the Traefik router's `Host()` rule. |
| `WEB_DOMAIN` | compose-level | yes | Becomes `WEB_URL` — the browser-facing origin auth emails (verification, password reset) link back to after the API finishes its part. Without it, those links point at the API itself instead of a real page. |
| `BETTER_AUTH_SECRET` | container | yes 🔒 | Signs and encrypts Better Auth sessions/tokens. Rotating it invalidates every existing session — everyone gets logged out — so treat it as a "break glass" secret, not something to rotate casually. |
| `CORS_ORIGINS` | container | no | Comma-separated browser origins allowed to make credentialed requests. In production this is the *only* CORS allowlist (no wildcard fallback, since credentials are always on); it must include `https://${WEB_DOMAIN}` or the web app's authenticated calls get blocked by the browser before they reach the API. |
| `MOBILE_APP_SCHEME` | container | no | Custom URL scheme of the Expo mobile app (default `hackos`), added to Better Auth's `trustedOrigins` for the `expo()` plugin (H4, H55). Only worth changing if `apps/mobile`'s `app.json` `scheme` is renamed from the default. |
| `LOG_LEVEL` | container | no | Pino log level (`info` by default). Turning it to `debug` in production is noisy but harmless; there's no separate audit-log toggle — sensitive-mutation auditing (H53) happens in Postgres regardless of this setting. |
| `DB_POOL_MAX` | container | no (default 20, 5 in tests) | Max size of this process's `pg` pool (H540). Per-process — api and worker each hold their own, and every replica of each multiplies it: `(api replicas × DB_POOL_MAX) + (worker replicas × DB_POOL_MAX)` must stay under Postgres's own `max_connections` (default 100), with headroom for `migrate`'s one-shot connections and admin/superuser use. Raise it for big-event load — see `docs/architecture.md` and `docs/big-event-readiness.md`. |
| `DB_IDLE_TIMEOUT_MS` | container | no (default 30000) | How long an idle pooled connection is kept before being closed. |
| `DB_CONNECTION_TIMEOUT_MS` | container | no (default 10000) | How long `pool.connect()` waits for a free connection before rejecting — bounds request latency under pool saturation instead of hanging. |
| `DB_STATEMENT_TIMEOUT_MS` | container | no (default 30000) | Postgres `statement_timeout`: aborts a runaway query instead of holding a connection (and a lock) forever. |
| `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` | container | no (default 30000) | Postgres `idle_in_transaction_session_timeout`: reclaims a connection stuck mid-transaction (a crashed handler between `BEGIN` and `COMMIT`/`ROLLBACK`). |
| `SSE_MAX_CONNECTIONS_GLOBAL` | container | no (default 2000) | **api only** (worker has no SSE). Total concurrent SSE connections this process accepts before rejecting new `subscribe()` calls with `429`. A generous safety net against a runaway reconnect loop, not a tight production cap. |
| `SSE_MAX_CONNECTIONS_PER_TOPIC` | container | no (default 500) | **api only**. Same budget, scoped to one topic (e.g. `queue`, `public-tv`). |
| `SSE_MAX_CONNECTIONS_PER_CLIENT` | container | no (default 20) | **api only**. Same budget, scoped to one client (`user:<id>` when authenticated, else caller IP). |
| `SSE_WRITE_TIMEOUT_MS` | container | no (default 5000) | **api only**. How long a backpressured SSE client (its socket buffer full, `write()` returned `false`) has to drain before it's disconnected — bounds memory growth from a slow/stalled client instead of buffering indefinitely. |
| `RATE_LIMIT_SCAN_MAX`, `RATE_LIMIT_SCAN_WINDOW_SECONDS` | container | no (default 120/60s) | Shared per-staff-user rate limit (#538) across check-in, check-in-user, rotate, remove and presence-scan. Tune upward for a big event's expected scan-throughput; see `docs/rate-limiting.md`. |
| `RATE_LIMIT_MEAL_BATCH_MAX`, `RATE_LIMIT_MEAL_BATCH_WINDOW_SECONDS` | container | no (default 60/60s) | Per-staff-user rate limit (#538) on `POST /api/activities/:id/meal-scans/batch`, counted per request (each batch carries up to 100 scans) so it doesn't break offline-device replay bursts. |
| `RATE_LIMIT_SNAPSHOT_MAX`, `RATE_LIMIT_SNAPSHOT_WINDOW_SECONDS` | container | no (default 20/60s) | Per-staff-user rate limit (#538) on `GET /api/scanner/snapshot`, the full-roster poll offline scanners use to refresh. |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | container | yes | Credentials the API signs S3 requests with (uploads, presigned downloads, sponsor logos). Either the MinIO root pair or a scoped service account with the same permissions. |
| `S3_BUCKET` | container | no | Bucket the API reads/writes (default `hackos`). Must match what `minio-init` provisioned. |
| `S3_PUBLIC_URL` | container | no | The **browser-reachable** base URL objects are served from. Without it, stored file/logo URLs default to the internal `http://minio:9000` host, which the browser can't resolve — logos silently fail to load even though the upload itself succeeded. Only the `enterprises/` prefix (sponsor logos) is ever public; application uploads stay private behind the API's presigned-download route. |
| `MAIL_PROVIDER` | container | no | Which outbound mail adapter to use: `smtp` \| `resend` \| `postal` (default `smtp`). This is a deploy-time choice, not a runtime DB setting — DELTA(H52) in `src/config.ts` explains why. Switching providers means changing this var and redeploying. |
| `MAIL_FROM_ADDRESS` | container | yes | The `From:` address on every outbound email (verification, reset, notifications). Most providers reject sends if this isn't a domain you've verified with them. |
| `MAIL_FROM_NAME` | container | no | Display name alongside the from-address (default `hackOS`). |
| `RESEND_API_KEY` / `POSTAL_URL` + `POSTAL_API_KEY` / `SMTP_HOST` + `SMTP_PORT` + `SMTP_USER` + `SMTP_PASS` | container | depends on `MAIL_PROVIDER` | Fill only the block matching your chosen provider; the others are ignored. Local dev's default (`smtp` against Mailpit) needs no credentials at all. |
| `MAIL_FOOTER_TEXT`, `MAIL_LAYOUT_*` (brand name, header text/subtext, logo URL, accent/bg/card/text/border colors, card radius, max width) | container | no | Cosmetic theming for the HTML email wrapper — lets you re-skin transactional emails per event without touching template code. Defaults mirror the web app's own zinc/neutral tokens (`apps/web/src/app/globals.css`) so email reads as the same product out of the box. `MAIL_LAYOUT_LOGO_URL` defaults to the hackOS brand mark served statically from `apps/web/public/email/brand-mark.png` at `WEB_URL` — override with your own browser-reachable PNG/JPEG (SVG isn't reliably supported by mail clients), or set it to `""` to fall back to the plain-text header. Every email also carries a hidden preheader (derived from the body) so inbox previews show something useful instead of boilerplate. |
| `APPLE_PASS_TYPE_IDENTIFIER`, `APPLE_TEAM_IDENTIFIER`, `APPLE_PASS_ORGANIZATION`, `APPLE_PASS_CERTIFICATE_PEM`, `APPLE_PASS_KEY_PEM`, `APPLE_PASS_KEY_PASSPHRASE`, `APPLE_WWDR_CERTIFICATE_PEM`, `APPLE_APNS_ENVIRONMENT`, `APPLE_PASS_APP_STORE_ID` | container | no, but all-or-nothing | Apple Wallet badge passes (H28). Leaving the whole block unset is fine — `/api/me/wallet/apple` just returns a clear `503`. Setting *some but not all* of the required ones fails loudly at boot instead of silently serving a broken `.pkpass`. See `deploy/README.md#wallet-passes-h28` for how to obtain each value. |
| `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_WALLET_PRIVATE_KEY_PEM` | container | no, but all-or-nothing | Same optional/all-or-nothing contract for Google Wallet. |
| `TRANSLATE_PROVIDER` | container | no (default `google`) | Which H50 auto-translate backend to use: `google` (Google Cloud Translation v2, needs `GOOGLE_TRANSLATE_API_KEY`) or `libretranslate` (self-hosted, needs `LIBRETRANSLATE_URL`). Whichever provider is missing its credentials reports unavailable — every translation surface (API and both frontends) keeps working with manual-only entry; the `/api/announcements/translate*` routes report unavailable / 503 instead of failing loudly. See `modules/notifications/translate/` for the isolated provider boundary. |
| `GOOGLE_TRANSLATE_API_KEY` | container | only if `TRANSLATE_PROVIDER=google` | Google Cloud Translation v2 API key. |
| `LIBRETRANSLATE_URL` / `LIBRETRANSLATE_API_KEY` | container | URL required if `TRANSLATE_PROVIDER=libretranslate`, key optional | Base URL of a self-hosted LibreTranslate instance (e.g. `https://translate.example.org`) and its API key, if the instance requires one. |
| `STACK_NAME` | compose-level | no (default) | Namespaces this instance's Traefik router names (`${STACK_NAME}-api`) so multiple hackOS instances can share one Traefik without router-name collisions. |
| `PROXY_NETWORK` | compose-level | no (default `dokploy-network`) | The Traefik-managed edge network `api` joins to receive public traffic. |
| `CERT_RESOLVER` | compose-level | no (default `letsencrypt`) | Which Traefik ACME resolver issues the TLS cert for `API_DOMAIN`. |
| `IMAGE_REPO`, `IMAGE_TAG` | compose-level | no | Which prebuilt image to pull; ignored entirely if Dokploy builds from source instead. Pin `IMAGE_TAG` to a released version in production — never `:latest`. |
| `API_MEM_LIMIT` | compose-level | no | Memory cap, default `512m`. |
| `INSTANCE_NETWORK` | compose-level | no | Private network joined to reach postgres/valkey/minio by name. |

## worker

Same image as `api`, running `node dist/worker.js` instead of `dist/server.js`
— no HTTP listener, no `edge` network membership, so it's reachable by nothing
and reaches out to nothing except the instance network and the open internet
(mail provider, Apple/Google push). Container env is the **api list above
minus** `CORS_ORIGINS` and `WEB_DOMAIN`/`WEB_URL` (the worker never serves a
browser or links back to the web app), plus:

| Variable | Kind | Required | What it does |
|---|---|---|---|
| `WORKERS_INLINE` | container | fixed `false` | Baked into the compose file, not user-configurable here. In dev this flag runs BullMQ workers inside the API process; in this deployment it's forced off because the worker container *is* the dedicated process — see `docs/background-workers.md`. |
| `WORKER_MEM_LIMIT` | compose-level | no | Memory cap, default `512m`. Bump this if you scale worker replicas for notification/queue throughput (dispatcher uses `SELECT ... FOR UPDATE SKIP LOCKED`, so replicas don't double-send). |
| `NOTIFICATION_OUTBOX_BATCH_SIZE` | container | no | Rows the outbox dispatcher claims per 5s tick, default `100` — each row dispatched and committed in its own transaction, so raising this doesn't grow the duplicate-send risk of a mid-batch crash. Only the `worker` container's value matters in production (it's the one running the dispatcher). See `docs/big-event-readiness.md`. |

Everything else — `DATABASE_URL`/`VALKEY_URL` inputs, `BETTER_AUTH_URL`,
`BETTER_AUTH_SECRET`, the S3 block, the mail block, both wallet blocks, the
`DB_*` pool/timeout block (H540) — is identical to `api` and **must use the
same values**: the worker is what actually sends the emails and pushes
wallet-pass updates that `api` only queues, and it holds its own `pg` pool
sized by the same `DB_POOL_MAX` math. The `SSE_*` vars are **not** applicable
here — the worker has no HTTP listener, so no SSE connections to budget.

## web

The only service with **no runtime container env at all** for hackOS-specific
config — `NEXT_PUBLIC_API_URL` is a Next.js public variable, so it has to be
baked into the JS bundle at **build time**, not read when the container
starts.

| Variable | Kind | Required | What it does |
|---|---|---|---|
| `API_DOMAIN` | build arg | yes | Becomes `NEXT_PUBLIC_API_URL=https://${API_DOMAIN}`, compiled directly into the client bundle. Changing it means rebuilding the image — restarting the existing container serves the old API URL forever. |
| `WEB_DOMAIN` | compose-level | yes | The `Host()` rule for this service's **own** Traefik router — deliberately separate from `API_DOMAIN`'s router, since the web app is never routed together with the api. |
| `STACK_NAME`, `PROXY_NETWORK`, `CERT_RESOLVER` | compose-level | no (defaults) | Same Traefik-naming role as on `api`. |
| `WEB_IMAGE_REPO`, `IMAGE_TAG` | compose-level | no | Pinned image tag for prebuilt-image deploys. |
| `WEB_MEM_LIMIT` | compose-level | no | Memory cap, default `256m`. |

Remember to add `https://${WEB_DOMAIN}` to the **api**'s `CORS_ORIGINS` —
`web` has no server-side config that wires this for you; it's a one-way
dependency the api side has to know about.

## Centralizing values with Dokploy's Project/Environment variables

Dokploy has three nested scopes for variables, and it's worth using the
built-in ones instead of pasting the same secret into six separate service
screens:

```
Project  (one hackOS instance, e.g. "hackos-event2026")
└── Environment  (e.g. "production" — usually the only one per instance)
    └── Service  (postgres, valkey, minio, api, worker, web)
```

- **Project variables** — set once on the Project, referenced from any
  service anywhere inside it with `${{project.VARIABLE_NAME}}`.
- **Environment variables** — set once on an Environment (a project can have
  several, e.g. staging/production), referenced with
  `${{environment.VARIABLE_NAME}}`.
- **Service variables** — a service's own box, referenced with
  `${{VARIABLE_NAME}}` (no prefix), and able to override anything from the
  scopes above.

**The important caveat: none of this is automatic.** Setting a value on the
Project or Environment tab does *not* inject it into every service's
container — Dokploy only resolves the `${{project....}}`/`${{environment....}}`
template if a service's own Environment Variables box actually contains that
reference. Each service still needs one line per variable it uses; what
changes is whether that line is a literal secret (duplicated N times, drifts
silently when rotated) or a thin reference to one real value (rotate once,
every service picks it up on next deploy).

Since hackOS already treats **one Dokploy project = one hackathon instance**
(see [Multiple instances](../deploy/README.md#multiple-instances)), and a
project of this size typically has a single Environment (e.g.
"production") inside it, **Environment variables are the natural home** for
everything in the "read by two or more services" tables above — it's the
correctly-scoped level (this instance) without assuming you'll never add a
second Environment to the same project later. Project-level works too if you
never expect more than one Environment; either is fine, just be consistent.

**Recipe:**

1. Generate secrets (`deploy/scripts/gen-secrets.sh`) and paste the resulting
   `KEY=value` pairs into the Dokploy **Environment**'s variables tab, plus
   the non-secret shared values from `deploy/.env.shared.example`.
2. For each service, copy the matching file straight into that service's own
   Environment Variables box in Dokploy — these are checked into the repo so
   there's nothing to write by hand or keep in sync manually:

   - [`deploy/services/postgres/dokploy.env.example`](../deploy/services/postgres/dokploy.env.example)
   - [`deploy/services/valkey/dokploy.env.example`](../deploy/services/valkey/dokploy.env.example)
   - [`deploy/services/minio/dokploy.env.example`](../deploy/services/minio/dokploy.env.example)
   - [`deploy/services/api/dokploy.env.example`](../deploy/services/api/dokploy.env.example)
   - [`deploy/services/worker/dokploy.env.example`](../deploy/services/worker/dokploy.env.example)
   - [`deploy/services/web/dokploy.env.example`](../deploy/services/web/dokploy.env.example)

   Each already lists exactly the variables that service's table above marks
   `compose-level` / `container`, as `${{environment.VAR}}` references; the
   optional/service-only ones are included commented-out so you can uncomment
   only what you actually need instead of hunting through this doc.
3. Leave the genuinely **service-only** vars (`PG_MEM_LIMIT`,
   `MINIO_BROWSER`, `API_MEM_LIMIT`, etc. — the commented-out lines in each
   file) as plain literals directly in that one service's box if you want to
   override a default. Routing a value nobody else reads through
   Project/Environment buys nothing.

This doesn't remove the "add a line per service" step — Dokploy has no
project-wide auto-injection — but it does mean rotating `POSTGRES_PASSWORD` or
`BETTER_AUTH_SECRET` is one edit in one place instead of hunting through six
service screens for every place the old value was pasted.

### Not using Dokploy? Nothing here changes the fallback path

The `${{environment.VAR}}` / `${{project.VAR}}` syntax lives **only** inside
Dokploy's own "Environment Variables" text box per service — it is Dokploy's
own template language, resolved by Dokploy's deploy runner before it ever
touches Docker. It never appears in `docker-compose.yml` itself, which reads
plain shell-style `${VAR}` exactly as it always has. That means:

- **On Dokploy**: paste a `dokploy.env.example` file into each service's box;
  Dokploy resolves the `${{environment.X}}` references into real values and
  writes a plain `KEY=value` `.env` for `docker compose` to substitute from.
- **Not on Dokploy** (plain `docker compose`, Mode B, or a non-Dokploy host):
  ignore the `dokploy.env.example` files entirely. Use a literal `.env` —
  `deploy/.env.shared.example` + `deploy/.env.instance.example` (Mode B), or a
  plain `.env` file per service for Mode A run by hand
  (`docker compose --env-file .env -f deploy/services/api/docker-compose.yml up -d`).
  The compose files themselves never branch on "is this Dokploy or not" —
  there's exactly one `${VAR}` substitution mechanism, and both paths just
  feed it a flat list of real values by different means.

In short: the fallback isn't something to build, it already exists, because
the two mechanisms were never coupled in the first place — only the *source*
of the values changes.

## Cross-checking against the compose files

If any of this drifts from reality, the compose files are the ground truth —
diff this doc against:

```sh
grep -n '\${' deploy/services/*/docker-compose.yml
```
