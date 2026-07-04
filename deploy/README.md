# Deploying hackOS

hackOS runs as a small set of containers built from one image (`apps/api/Dockerfile`)
plus three datastores. This directory gives you **two ways** to deploy, both
tuned for [Dokploy](https://dokploy.com) but usable with plain `docker compose`:

| Mode | Files | You get | Use when |
|---|---|---|---|
| **A — per-service** (recommended for Dokploy) | `deploy/services/<svc>/docker-compose.yml` | Each service (postgres, valkey, minio, api, worker) is its **own** Dokploy service: deploy, roll back, scale, and read logs independently. | You want to manage/scale services separately — the normal Dokploy workflow. |
| **B — single stack** | `deploy/docker-compose.yml` | All containers in **one** Compose project/service. | A quick single-unit deploy, a non-Dokploy host, or local prod smoke-testing. |

Both modes share the same image, the same env variables, and the same security
posture. Pick one per instance — don't mix them for the same instance.

> **One instance = one hackathon/tenant.** Everything below is per-instance and
> fully isolated (own network, own volumes, own secrets). Run the whole thing
> again with a different `STACK_NAME` + `INSTANCE_NETWORK` to host a second
> event on the same server with zero shared state. See [Multiple instances](#multiple-instances).

---

## Architecture

```
                        Internet
                           │  443 (TLS)
                    ┌──────▼───────┐
                    │   Traefik    │  (Dokploy-managed reverse proxy)
                    │ dokploy-network (edge)
                    └──────┬───────┘
                           │  http :3000
                    ┌──────▼───────┐        ┌──────────┐
                    │     api      │        │  worker  │   BullMQ jobs
                    │ (HTTP + SSE) │        │ (no HTTP)│   mail·pump·expirer
                    └──────┬───────┘        └────┬─────┘
   hackos-<instance>-net   │  (private, no host ports)  │
        (instance) ────────┼───────────────┬────────────┘
                    ┌───────▼──┐   ┌────────▼─┐   ┌────────┐
                    │ postgres │   │  valkey  │   │  minio │
                    └──────────┘   └──────────┘   └────────┘
```

- **Two networks.** The **instance** network (`hackos-<name>-net`, private) carries
  all inter-service traffic; datastores publish **no host ports**, so they're
  reachable only by services on that network — never from the host or the
  internet. The **edge** network (`dokploy-network`) is Traefik's; **only the
  api** joins it, and it's the only service with a public route.
- **Egress.** The instance network is a normal bridge, so `api` and `worker`
  still reach the internet (mail provider, Expo push). Datastores don't need to
  and, having no route out, effectively can't.
- **Hostnames.** Services find each other by name on the instance network:
  `postgres:5432`, `valkey:6379`, `minio:9000`. Those names are baked into
  `DATABASE_URL` / `VALKEY_URL` / `S3_ENDPOINT`.
- **Migrations** run as a one-shot `migrate` container (bundled with the `api`
  service) before the API starts, guarded by a Postgres advisory lock so
  replicas/redeploys can't race.

---

## Environment variables: project (shared) vs service-only

Dokploy has **two scopes** for env vars: **Project → Environment** (inherited by
every service in the project) and **each service's own Environment**. hackOS is
designed so that **almost everything goes in Project (shared) env** — because the
same secret is read by several services and MUST match between them (e.g. the
Postgres password is set on `postgres` *and* embedded in the `DATABASE_URL` that
`api`/`worker` use). Keeping them in one shared place is what prevents drift.

### Put these in **Project (shared) environment**

These are read by two or more services. Secrets are marked 🔒 — generate them
with `deploy/scripts/gen-secrets.sh` and never reuse across instances.

| Variable | Read by | Notes |
|---|---|---|
| `STACK_NAME` | api | Unique per instance; namespaces Traefik routers. Also use as the Dokploy project name / `-p`. |
| `INSTANCE_NETWORK` | all | The private network name, e.g. `hackos-event2026-net`. Create it first (below). |
| `PROXY_NETWORK` | api | Traefik network. Dokploy default `dokploy-network`. |
| `API_DOMAIN` | api, worker | Public hostname. `worker` uses it only to build `BETTER_AUTH_URL`. |
| `CORS_ORIGINS` | api | Comma-separated allowed browser origins. |
| `CERT_RESOLVER` | api | Traefik ACME resolver name (default `letsencrypt`). |
| `IMAGE_REPO`, `IMAGE_TAG` | api, worker | The built image. Ignored if Dokploy builds from source. |
| `BETTER_AUTH_SECRET` 🔒 | api, worker | 32+ random bytes. |
| `POSTGRES_USER` | postgres, api, worker | Also part of `DATABASE_URL`. |
| `POSTGRES_PASSWORD` 🔒 | postgres, api, worker | Must match everywhere. |
| `POSTGRES_DB` | postgres, api, worker | |
| `VALKEY_PASSWORD` 🔒 | valkey, api, worker | Must match everywhere. |
| `MINIO_ROOT_USER` | minio, minio-init | |
| `MINIO_ROOT_PASSWORD` 🔒 | minio, minio-init | |
| `S3_ACCESS_KEY` | api, worker | Root keys work; a scoped MinIO service account is better. |
| `S3_SECRET_KEY` 🔒 | api, worker | |
| `S3_BUCKET` | api, worker, minio-init | Default `hackos`. |
| `MAIL_PROVIDER` | api, worker | `smtp` \| `resend` \| `postal`. |
| `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME` | api, worker | |
| `MAIL_FOOTER_TEXT`, `MAIL_LAYOUT_*` | api, worker | Optional email theming/footer text customization (header, colors, sizing, footer copy). |
| `RESEND_API_KEY` 🔒 / `POSTAL_*` 🔒 / `SMTP_*` 🔒 | api, worker | Fill the block for your provider. |
| `LOG_LEVEL` | api, worker | |

### Put these in **service-only environment** (optional)

Each is read by exactly one service. They're safe to leave in Project env too —
they're isolated here only because they logically belong to one service and have
sensible defaults, so you can usually skip them entirely.

| Service | Variable(s) | Purpose |
|---|---|---|
| postgres | `PG_MEM_LIMIT` | Memory cap (default `1g`). |
| valkey | `VALKEY_MEM_LIMIT` | Memory cap (default `512m`). |
| minio | `MINIO_IMAGE`, `MINIO_MC_IMAGE`, `MINIO_BROWSER`, `MINIO_MEM_LIMIT` | Pinned image tags; console on/off; memory cap. |
| api | `API_MEM_LIMIT` | Memory cap (default `512m`). |
| worker | `WORKER_MEM_LIMIT` | Memory cap (default `512m`). |

> **The split in one line:** shared secrets + anything two services touch →
> **Project env**; per-service memory limits and MinIO image/console toggles →
> **service env** (or leave them at defaults). The two `.env.*.example` files
> mirror this: `.env.shared.example` = non-secret shared, `.env.instance.example`
> = per-instance secrets. Assemble both into Project env.

---

## Mode A — per-service on Dokploy (recommended)

### 1. Create the private network (once per instance)

Dokploy doesn't create arbitrary app networks for you, so make the instance
network on the host first:

```sh
docker network create hackos-event2026-net
```

Use that exact name as `INSTANCE_NETWORK`. The `dokploy-network` (edge) already
exists on any Dokploy host.

### 2. Create a Dokploy **Project** and set its shared Environment

Create a project (e.g. `hackos-event2026`). In **Environment**, paste the
combined shared values — generate secrets first:

```sh
./deploy/scripts/gen-secrets.sh hackos-event2026 api.event2026.example.org > .env.event2026
# then hand-fill CORS_ORIGINS, the mail block, and copy the non-secret
# shared values from deploy/.env.shared.example
```

### 3. Add five services, each pointing at its compose file

For each of `postgres`, `valkey`, `minio`, `api`, `worker`, add a **Compose**
service in the project that uses this repo and the corresponding file:

- `deploy/services/postgres/docker-compose.yml`
- `deploy/services/valkey/docker-compose.yml`
- `deploy/services/minio/docker-compose.yml`
- `deploy/services/api/docker-compose.yml`  ← builds the image + runs migrations
- `deploy/services/worker/docker-compose.yml`

Each inherits the project's shared env; add service-only vars only if you want
to override a default. Attach `API_DOMAIN` as the domain on the **api** service
(Dokploy fills the Traefik cert); the compose already carries the router labels.

### 4. Deploy in order

`postgres` → `valkey` → `minio` → `api` (runs migrations, then serves) →
`worker`. Redeploying `api` re-runs migrations safely (advisory lock). The
datastores keep their volumes across app redeploys.

---

## Mode B — single stack

One env file, one command. Good for a non-Dokploy host or local prod testing.

```sh
# assemble env: shared defaults, then per-instance secrets (later wins)
cat deploy/.env.shared.example > .env.prod
./deploy/scripts/gen-secrets.sh hackos-event2026 api.event2026.example.org >> .env.prod
# edit .env.prod: CORS_ORIGINS, mail block, INSTANCE_NETWORK is NOT needed here

docker network create dokploy-network 2>/dev/null || true   # if no Traefik yet

docker compose --env-file .env.prod \
  -f deploy/docker-compose.yml \
  -p hackos-event2026 up -d --build
```

In this mode the datastores + app tier sit on a Compose-managed **`private`
network with `internal: true`** (no egress at all for datastores), and only
`api`/`worker` also join the external `edge` (`dokploy-network`). On Dokploy this
mode is a single Compose service containing every container.

---

## Multiple instances

Every instance is isolated by three unique values: **`STACK_NAME`**,
**`INSTANCE_NETWORK`**, and the **Dokploy project / `-p` name** (which scopes
volumes). Nothing is shared between instances — separate networks, separate
`pgdata`/`miniodata` volumes, separate secrets, separate Traefik routers (the
router names carry `STACK_NAME`, so no collision on one Traefik).

```
event2026:  STACK_NAME=hackos-event2026  INSTANCE_NETWORK=hackos-event2026-net  domain api.event2026…
event2027:  STACK_NAME=hackos-event2027  INSTANCE_NETWORK=hackos-event2027-net  domain api.event2027…
```

Give each instance its own generated secrets — a leak in one must never touch
another.

---

## Security posture

- **Datastores are never exposed.** No `ports:` mappings; reachable only inside
  the instance network. Postgres and Valkey are password-protected; Valkey uses
  `requirepass`.
- **Only `api` is public**, via Traefik on `dokploy-network`. It sets HSTS,
  `X-Content-Type-Options`, `X-Frame-Options: DENY`, and a strict referrer
  policy (Traefik middleware), and trusts `X-Forwarded-*` (`TRUST_PROXY=true`)
  so the audit trail records real client IPs (H53).
- **CORS is locked down in production** to `CORS_ORIGINS`; credentialed requests
  from other origins are refused.
- **Containers run unprivileged** (`USER node`, `no-new-privileges:true`) under
  `tini` for correct signal handling and graceful shutdown.
- **Pin your images.** Set `IMAGE_TAG` to a released version and `MINIO_IMAGE`/
  `MINIO_MC_IMAGE` to concrete tags — never ship `:latest` to production.
- **MinIO console is off** by default (`MINIO_BROWSER=off`). To expose it, put it
  behind Traefik on its own subdomain with auth; don't publish `:9001`.
- **Secrets live only in Dokploy's env store** (or your `.env.<instance>` file,
  which is gitignored). Rotating `BETTER_AUTH_SECRET` invalidates sessions.

---

## Operations

- **Migrations**: automatic on `api` deploy. To run manually:
  `docker compose -f deploy/services/api/docker-compose.yml -p <proj>-api run --rm migrate`.
- **Backups**: snapshot the `pgdata` volume (or `pg_dump` on a schedule) and the
  `miniodata` volume. These are the only stateful pieces; Valkey is ephemeral.
- **Scaling**: run more `worker` replicas for notification/queue throughput
  (dispatcher uses `FOR UPDATE SKIP LOCKED`, so replicas won't double-send).
  Multiple `api` replicas are fine — SSE is stateless and fans out via Valkey.
- **Logs/health**: every long-running service has a healthcheck; the `worker`'s
  is disabled (it serves no HTTP — liveness is process-based via `restart`).

---

## Files here

```
deploy/
├── README.md                     ← this file
├── docker-compose.yml            ← Mode B: single stack
├── .env.shared.example           ← non-secret, shared across instances
├── .env.instance.example         ← per-instance secrets (never commit filled)
├── scripts/
│   └── gen-secrets.sh            ← generate a per-instance secret env file
└── services/                     ← Mode A: one compose per Dokploy service
    ├── postgres/docker-compose.yml
    ├── valkey/docker-compose.yml
    ├── minio/docker-compose.yml
    ├── api/docker-compose.yml    ← api + one-shot migrate
    └── worker/docker-compose.yml
```
