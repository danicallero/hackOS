# Deploying hackOS with Docker Compose

hackOS runs as six containers built from the API and web images, plus
Postgres, Valkey and MinIO. The supported deployment contract is plain Docker
Compose. The repository contains a single-stack file for the usual deployment
and one file per service for hosts that need independent service lifecycles.

## Architecture

```
                         host / external load balancer
                         :${API_PORT:-3000}  :${WEB_PORT:-3001}
                                  │                 │
                         ┌────────▼───────┐ ┌─────▼────────┐
                         │ api (HTTP/SSE) │ │ web (Next.js)│
                         └────────┬───────┘ └──────────────┘
                                  │
                 private network │ public network
       ┌──────────────────────────┼──────────────────┐
       │                          │                  │
   postgres                    valkey              worker
       │                          │                  │
       └────────────────────── minio ───────────────┘
```

- The datastores have no published ports. Only `api` and `web` publish host
  ports; the worker has no inbound HTTP surface.
- The API and worker join both Compose networks so they can reach datastores
  and external mail, push, Wallet and translation providers. Web joins only
  the public network.
- TLS, DNS, firewall policy and any external load balancing belong to the
  host or infrastructure layer. Set `TRUST_PROXY=true` only when that layer is
  a trusted reverse proxy.
- `API_DOMAIN` and `WEB_DOMAIN` remain application origins: they configure
  Better Auth, CORS and the web runtime config. They do not create routes in
  Compose.

## Environment files

Use the two checked-in templates as a starting point, then keep the filled
instance file outside Git:

```sh
./deploy/scripts/gen-secrets.sh api.event2026.example.org > .env.event2026
# Review domains, CORS_ORIGINS, provider credentials and optional Wallet blocks.
```

`deploy/.env.shared.example` contains image references, port defaults,
resource limits and non-secret choices. The generated instance file contains
database, storage, auth and mail values. When both files are passed to
Compose, the later file wins.

Never commit a filled environment file or private key. The examples contain
placeholders only.

## Single stack (recommended)

The single stack creates its own private and public bridge networks and is the
least error-prone option for one host:

```sh
docker compose \
  --env-file deploy/.env.shared.example \
  --env-file .env.event2026 \
  -p hackos-event2026 \
  -f deploy/docker-compose.yml \
  up -d
```

The API is available on `${API_PORT:-3000}` and the web app on
`${WEB_PORT:-3001}`. If a host-level load balancer terminates TLS, point its
API and web backends at those ports and set `TRUST_PROXY=true` for the API.
Do not publish Postgres, Valkey or MinIO ports.

The API service runs the advisory-locked migration command before listening;
the separate `migrate` service makes the startup order explicit. `minio-init`
creates the configured bucket idempotently.

## Separate service Compose files

Use `deploy/services/<service>/docker-compose.yml` when Postgres, Valkey,
MinIO, API, worker and web need separate restart or rollout controls. This
mode uses one external private Docker network shared by the service projects:

```sh
docker network create hackos-event2026-net
```

Set `INSTANCE_NETWORK=hackos-event2026-net` in the instance environment and
launch the services with distinct Compose project names. API and web publish
`${API_PORT:-3000}` and `${WEB_PORT:-3001}` respectively. The service files
use the same image tag and application secrets as the single stack.

Launch order is `postgres`, `valkey`, `minio`, `api`, `worker`, then `web`.
The API file includes the one-shot `migrate` service. A split deployment must
keep all six services on the same `INSTANCE_NETWORK`; changing it isolates a
service from the datastores.

## Images and releases

The CD workflow builds and publishes the API and web images for pushes to the
protected release branches. It does not connect to a host or perform a
deployment. Pull the published tag on the target host and restart the
Compose project there. Use an immutable `sha-<commit>` tag for a rollback.

The API and worker must use the same `IMAGE_REPO` and `IMAGE_TAG`; the web
uses `WEB_IMAGE_REPO` and the same release tag. Pin `MINIO_IMAGE` and
`MINIO_MC_IMAGE` to concrete versions for production.

## Wallet passes (H28)

Apple Wallet and Google Wallet are optional. Leaving an entire platform block
unset makes its endpoint return `503 service_unavailable`; a partial signing
block fails at boot. PEM values are base64-encoded content, not file paths.

Apple requires `APPLE_PASS_TYPE_IDENTIFIER`, `APPLE_TEAM_IDENTIFIER`,
`APPLE_PASS_CERTIFICATE_PEM`, `APPLE_PASS_KEY_PEM` and
`APPLE_WWDR_CERTIFICATE_PEM`; `APPLE_PASS_ORGANIZATION`,
`APPLE_APNS_ENVIRONMENT` and `APPLE_PASS_APP_STORE_ID` are optional.

Google requires `GOOGLE_WALLET_ISSUER_ID`,
`GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL` and
`GOOGLE_WALLET_PRIVATE_KEY_PEM`. The event-ticket class and visual options
are documented in [`docs/env-vars.md`](../docs/env-vars.md).

Never commit these values. Revoke a leaked Apple certificate or Google key at
its source; rotating the app auth secret does not rotate Wallet credentials.

## Mail

Production mail is Amazon SES through its SMTP interface. Set
`MAIL_PROVIDER=smtp`, use the SES SMTP endpoint for the selected AWS region,
port `587`, the SES SMTP credentials, and a verified `MAIL_FROM_ADDRESS`.
SES SMTP credentials are distinct from ordinary AWS access keys. Local
development uses SMTP against Mailpit, and the same `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER` and `SMTP_PASS` settings remain configurable for another relay.

Amazon SES also exposes an HTTPS API, but this repository intentionally uses
its existing generic SMTP adapter; no AWS SDK credentials are required by the
application. The provider choice and verified sender identity should still be
recorded in the production runbook.

Email layout branding is code-owned. The current hackOS name, logo URL,
colors, dimensions and footer are internal constants in the template renderer
and are no longer deployment variables.

## Operations and security

- Back up the Postgres and MinIO volumes before migrations or releases.
- The API exposes `/healthz` for process liveness and `/readyz` for dependency
  readiness. The worker is process-only and has no HTTP health endpoint.
- Keep `MINIO_BROWSER=off` unless the console is placed behind a separate,
  authenticated route. Never publish port `9001` directly.
- Set distinct Compose project names, networks and secrets for separate
  hackathons. Do not reuse database, auth, storage or signing credentials.
- `DB_POOL_MAX` is per process and per replica. Keep the combined API and
  worker pool below Postgres `max_connections`, with headroom for migrations
  and administration; see [`docs/big-event-readiness.md`](../docs/big-event-readiness.md).

## Files

```
deploy/
├── README.md
├── docker-compose.yml              # single stack
├── .env.shared.example             # non-secret shared values
├── .env.instance.example           # per-instance values/placeholders
├── scripts/
│   └── gen-secrets.sh
├── qualification/                  # disposable event-day load stack
└── services/                       # optional split Compose deployment
    ├── postgres/docker-compose.yml
    ├── valkey/docker-compose.yml
    ├── minio/docker-compose.yml
    ├── api/docker-compose.yml
    ├── worker/docker-compose.yml
    └── web/docker-compose.yml
```

The authoritative environment-variable inventory is
[`docs/env-vars.md`](../docs/env-vars.md).
