# Environment variables for the canonical Compose stack

This document describes [`deploy/docker-compose.yml`](../deploy/docker-compose.yml),
which runs inside the GPULux `hackos` LXC. The LXC keeps the filled env file at
`/root/hackos/.env` with mode `0600`. GitHub Actions never reads, decrypts or
prints that file.

Two kinds of variables appear below:

- **Container env** reaches a process inside a container.
- **Compose-level** renders the stack, image references, ports or resource
  limits. It is not automatically passed to the application process.

The environment file(s) are assembled out of band from
[`.env.shared.example`](../deploy/.env.shared.example) and
[`.env.instance.example`](../deploy/.env.instance.example). Use separate
`.env.production` and `.env.staging` files when both environments share the
LXC; otherwise the deploy script can use the existing common `.env`. Production
and staging must use separate database, cache, object-storage and auth secrets.

## postgres

| Variable | Kind | Required | What it does |
|---|---|---|---|
| `POSTGRES_USER` | container | yes | Database role created on first boot and used by the application URL. |
| `POSTGRES_PASSWORD` | container | yes | Password for `POSTGRES_USER`; it must match the value interpolated into `DATABASE_URL`. |
| `POSTGRES_DB` | container | yes | Database created on first boot and used by the application. |
| `PG_MEM_LIMIT` | Compose-level | no | Memory limit, default `1g`. |

Postgres has no host port. Its data is in the Compose `pgdata` volume on the
LXC and it is reachable only over the internal `private` network.

## valkey

| Variable | Kind | Required | What it does |
|---|---|---|---|
| `VALKEY_PASSWORD` | container | yes | Password for `valkey-server --requirepass` and the API/worker `VALKEY_URL`. |
| `VALKEY_MEM_LIMIT` | Compose-level | no | Memory limit, default `512m`. |

Valkey is intentionally ephemeral (`--save "" --appendonly no`) and has no
host port.

## minio

| Variable | Kind | Required | What it does |
|---|---|---|---|
| `MINIO_ROOT_USER` | container | yes | MinIO administrator used by `minio-init`. |
| `MINIO_ROOT_PASSWORD` | container | yes | Password for the MinIO administrator. |
| `MINIO_BROWSER` | container | no | MinIO console switch, default `off`; do not expose it without an authenticated proxy route. |
| `S3_BUCKET` | container | no | Bucket provisioned by `minio-init`, default `hackos`. |
| `MINIO_IMAGE` | Compose-level | no | MinIO image reference; the Compose default is a concrete release tag. Keep it pinned. |
| `MINIO_MC_IMAGE` | Compose-level | no | MinIO Client image reference; the Compose default is a concrete release tag. Keep it pinned. |
| `MINIO_MEM_LIMIT` | Compose-level | no | Memory limit, default `1g`. |

MinIO and its one-shot initializer have no host ports and use the internal
`private` network only.

## api, migrate and worker

`migrate`, `api` and `worker` use the same GHCR API image. `migrate` runs
`node dist/migrate.js`, `api` runs the migration guard and HTTP server, and
`worker` runs `node dist/worker.js` with `WORKERS_INLINE=false`.

| Variable | Kind | Required | What it does |
|---|---|---|---|
| `IMAGE_REPO` | Compose-level | yes | GHCR repository for the API image, for example `ghcr.io/danicallero/hackos-api`. |
| `IMAGE_TAG` | Compose-level | yes | The image tag. Deployments accept only `sha-<40 lowercase hex characters>`; the in-LXC script overrides this with the workflow input. |
| `API_DOMAIN` | Compose-level | yes | Public API host. It becomes `BETTER_AUTH_URL`; GPULux's proxy routes it to `API_PUBLISH_PORT`. |
| `WEB_DOMAIN` | Compose-level | yes | Public web origin used for `WEB_URL`, auth redirects and email links. |
| `API_PUBLISH_PORT` | Compose-level | no | LXC host port mapped to API port `3000`, default `3000`. |
| `BETTER_AUTH_SECRET` | Container | yes | Session and token signing secret. Rotating it logs out existing sessions. |
| `CORS_ORIGINS` | Container | yes in production | Comma-separated credentialed browser origins; include `https://${WEB_DOMAIN}`. |
| `MOBILE_APP_SCHEME` | Container | no | Mobile callback scheme, default `hackos`. |
| `LOG_LEVEL` | Container | no | Pino log level, default `info`. |
| `LOG_EXPO_PUSH_TICKETS` | Container | no | Redacted Expo delivery logging switch, default `false`. |
| `LOG_EXPO_PUSH_TOKENS` | Container | no | Redacted push-token logging switch for API debugging, default `false`. |
| `LOG_EXPO_PUSH_UNSAFE_DEBUG` | Container | no | Explicitly unsafe full push debugging, default `false`; keep disabled in production. |
| `DB_POOL_MAX`, `DB_*_TIMEOUT_MS` | Container | no | Per-process Postgres pool and timeout controls; keep the API/worker connection budget below Postgres `max_connections`. |
| `SSE_*` | Container | no | API SSE connection and slow-client limits. |
| `RATE_LIMIT_*` | Container | no | Operational scanner and snapshot rate limits backed by Valkey. |
| `NOTIFICATION_OUTBOX_BATCH_SIZE` | Container | no | Worker rows claimed per five-second tick, default `100`. |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Container | yes | S3 credentials used by API and worker. Prefer a scoped MinIO account over root credentials. |
| `S3_BUCKET` | Container | no | Bucket used by API and worker, default `hackos`; it must match `minio-init`. |
| `S3_PUBLIC_URL` | Container | no | Public HTTPS base for sponsor logo objects; private uploads remain API-proxied. |
| `MAIL_PROVIDER` | Container | no | `smtp`, `resend` or `postal`, default `smtp`. |
| `MAIL_FROM_ADDRESS` | Container | yes | Sender address for transactional mail. |
| `MAIL_FROM_NAME` | Container | no | Sender display name, default `hackOS`. |
| `RESEND_API_KEY` | Container | only for Resend | Resend credential. |
| `POSTAL_URL` / `POSTAL_API_KEY` | Container | only for Postal | Postal endpoint and credential. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Container | only for SMTP | SMTP connection settings. |
| `MAIL_FOOTER_TEXT`, `MAIL_LAYOUT_*` | Container | no | Transactional email branding and layout. |
| `APPLE_*` | Container | no, all-or-nothing | Optional Apple Wallet signing and APNs settings. |
| `GOOGLE_WALLET_*` | Container | no, signing block all-or-nothing | Optional Google Wallet signing and branding settings. |
| `TRANSLATE_PROVIDER`, `GOOGLE_TRANSLATE_API_KEY`, `LIBRETRANSLATE_URL`, `LIBRETRANSLATE_API_KEY` | Container | no | Optional automatic translation provider and credentials. |
| `REVIEW_FIXTURE_PASSWORD` / `REVIEW_FIXTURE_DELETION_PIN` | API only | no | Optional synthetic reviewer fixture credentials; not passed to `migrate` or `worker`. |
| `API_MEM_LIMIT` | Compose-level | no | API memory limit, default `512m`. |
| `WORKER_MEM_LIMIT` | Compose-level | no | Worker memory limit, default `512m`. |

The API and worker join `private` for database/cache/storage traffic and
`egress` for external providers. The API publishes port `3000` through
`API_PUBLISH_PORT`; the worker has no host port. `migrate` is one-shot and has
no host port.

## web

The web image is environment-neutral. It reads `API_DOMAIN` and `WEB_DOMAIN`
at runtime and serves `/runtime-config.js`.

| Variable | Kind | Required | What it does |
|---|---|---|---|
| `WEB_IMAGE_REPO` | Compose-level | yes | GHCR repository for the web image, for example `ghcr.io/danicallero/hackos-web`. |
| `IMAGE_TAG` | Compose-level | yes | The same immutable SHA tag used by API and worker. |
| `API_DOMAIN` | Container | yes | Browser API origin exposed by `/runtime-config.js`. |
| `WEB_DOMAIN` | Container | yes | Canonical web origin exposed by `/runtime-config.js`. |
| `WEB_PUBLISH_PORT` | Compose-level | no | LXC host port mapped to web port `3001`, default `3001`; GPULux's proxy routes `WEB_DOMAIN` here. |
| `WEB_MEM_LIMIT` | Compose-level | no | Web memory limit, default `256m`. |

The web service has no private datastore access. It publishes only its HTTP
port; it does not expose Docker's Remote API.

## GitHub Actions and GPULux

`.github/workflows/build.yml` publishes branch and immutable SHA tags for both
images. It builds `linux/amd64` and `linux/arm64` and never publishes
`latest`.

`.github/workflows/deploy-gpulux.yml` is manual and accepts only
`production`/`staging` plus a `sha-<40 lowercase hex characters>` tag. The
matching GitHub Actions Environment supplies approval protection, not
application secrets. The workflow runs only on the GPULux self-hosted runner,
transfers the Compose/script with Incus and executes the rollout in `hackos`.

The `setup-gh-runner` block in `gpul-org/infra` is currently commented out, so
the runner must be provisioned and registered before deployments can start.
The workflow does not fall back to a hosted runner.

See [`deploy/README.md`](../deploy/README.md) for the secret-file contract,
lock and health gates, GHCR authentication on the LXC, rollback and the rule
that image rollback does not automatically revert database migrations.

## Cross-checking against the Compose file

If this document drifts from reality, the canonical Compose file is the ground
truth:

```sh
grep -n '\${' deploy/docker-compose.yml
```
