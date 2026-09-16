# Deploying hackOS on GPULux

GPULux runs hackOS as one Docker Compose stack inside the Incus LXC named
`hackos`. The canonical stack is [`docker-compose.yml`](./docker-compose.yml);
the deployment script is [`gpulux-deploy.sh`](./gpulux-deploy.sh).

The release path is:

```text
GitHub Actions build → GHCR → self-hosted GPULux runner → Incus → hackos LXC
```

Application secrets stay in the LXC and are never passed through GitHub Actions.

## Architecture

```text
Internet
   │
   ▼
GPULux proxy LXC (Caddy, managed by gpul-org/infra)
   │ Incus network, only HTTP ports
   ├── hackos:API_PUBLISH_PORT → api:3000
   └── hackos:WEB_PUBLISH_PORT → web:3001

hackos LXC
   └── Compose project hackos-<environment>
       ├── api      ─┐
       ├── worker    ├── private network + egress network
       ├── web      ─┘
       ├── migrate     private network, one-shot
       ├── postgres    private network, no host port
       ├── valkey      private network, no host port
       └── minio       private network, no host port
```

The proxy configuration is an infrastructure dependency. It must route the
public API and web domains to the published ports in the environment file; this
repository does not modify `gpul-org/infra`.

The `private` network is internal to Docker, so Postgres, Valkey and MinIO are
not reachable from the LXC network. API and worker also join `egress` because
they call mail, push, translation and wallet providers. The Compose file does
not mount `/var/run/docker.sock` and does not publish Docker's Remote API.

## Environment file and secrets

The LXC must already contain `/root/hackos/.env`, or an environment-specific
`/root/hackos/.env.production` / `/root/hackos/.env.staging`. The deploy script
prefers the environment-specific file when it exists and otherwise uses
`.env`. It is read only inside the LXC with `docker compose --env-file`; GitHub
Actions never reads, decrypts or prints it. Provision it out of band, with mode
`0600`, for each isolated environment. It contains the application secrets and
the non-secret deployment values from [`.env.shared.example`](./.env.shared.example)
plus [`.env.instance.example`](./.env.instance.example).

At minimum, the file must define the GHCR image repositories, domains, host
ports, database/cache/storage credentials and mail configuration. If the GHCR
packages are private, configure a read-only registry login in the LXC before
the first deployment. That registry credential is not a GitHub Actions secret.

Do not put application secrets in GitHub Actions repository or environment
secrets. The deploy workflow only needs the protected GitHub Actions
Environments `production` and `staging`; it has no application secret inputs.

The workflow does not assume that the runner is enabled. In the current
`gpul-org/infra` repository, the `setup-gh-runner` block in
`ansible/incus/playbook.yml` is commented out. An infrastructure administrator
must provision and register the `gpulux-runner` self-hosted runner in the
`infra` runner group, install its service, configure its Incus client and make
sure it can reach the `hackos` instance. Until then, the deploy job remains
queued or cannot start; no fallback to a hosted runner is allowed.

The existing infra workflows use `runs-on: self-hosted`, `incus file push` and
`incus exec <instance> ...`; the hackOS workflow follows the same contract.

## Build and release tags

`.github/workflows/build.yml` runs after pushes to `main` and `staging` and
publishes both images to GHCR:

```text
ghcr.io/danicallero/hackos-api:<branch>
ghcr.io/danicallero/hackos-api:sha-<40-hex-commit>
ghcr.io/danicallero/hackos-web:<branch>
ghcr.io/danicallero/hackos-web:sha-<40-hex-commit>
```

Each image is built for `linux/amd64` (required by GPULux) and `linux/arm64`.
There is deliberately no `latest` tag. Deployments accept only
`sha-<40 lowercase hex characters>`; branch tags are for discovery, never for
production or staging deployment.

The GHCR package owner in the checked-in examples is `danicallero`, matching
the canonical repository. Change the image repository values in the LXC env
file only if the canonical repository owner changes.

## Deploying

Run `.github/workflows/deploy-gpulux.yml` with:

- `environment`: `production` or `staging`;
- `tag`: an immutable `sha-<commit>` tag.

The job uses the matching GitHub Actions Environment, so configure required
reviewers and any other protection rules on both `production` and `staging`.
The job then:

1. validates the environment and tag format;
2. checks Incus access to the `hackos` LXC;
3. transfers the canonical Compose and deployment script with `incus file push`;
4. runs `/root/hackos/deploy.sh` through `incus exec hackos`;
5. acquires `/root/hackos/.deploy.lock` with `flock`;
6. pulls the API, worker and web images for the selected SHA tag;
7. starts the datastores and waits for their healthchecks;
8. initializes the MinIO bucket and runs `migrate`;
9. recreates API, worker and web;
10. waits for API/web healthchecks and confirms the worker process is running.

The GitHub job also has per-environment concurrency protection. The lock inside
the LXC protects against a second deploy started outside GitHub Actions. Logs
contain only operation status, health status and generic failure messages; the
secret file is never printed.

For example, after a successful build:

```sh
gh workflow run deploy-gpulux.yml \
  --ref main \
  -f environment=production \
  -f tag=sha-0123456789abcdef0123456789abcdef01234567
```

Do not run a real deployment as part of local validation.

## Rollback

Rollback is the same protected workflow with the previous known-good image
tag:

```sh
gh workflow run deploy-gpulux.yml \
  --ref main \
  -f environment=production \
  -f tag=sha-<previous-known-good-commit>
```

This rolls back API, worker and web images together. An image rollback does not
automatically revert PostgreSQL migrations. Before a release, take the normal
database backup and verify whether the previous image is compatible with the
current schema. Reversing data or schema changes is a separate, deliberate
database recovery operation.

## Local Compose validation

Use a filled local env file only for validation or local operations:

```sh
docker compose --env-file .env.hackos \
  --file deploy/docker-compose.yml \
  --project-name hackos-validation \
  config --quiet
```

The production script is not a local build script. It pulls immutable images;
the GitHub build workflow is responsible for publishing them.

### Wallet passes (H28)

Apple Wallet and Google Wallet settings are optional. Leave each platform's
block empty to keep its endpoints unavailable without blocking the deployment;
when enabling one, fill the complete signing block in the LXC secret file.

## Operations and security

- Postgres, Valkey and MinIO have no published ports.
- The MinIO console is off by default; do not expose it without an
  authenticated proxy route.
- Containers use pinned datastore image tags and application SHA tags.
- API and worker use the same API image; web uses its separate web image.
- `migrate` is advisory-locked by the application migration runner, and the
  deploy script serializes the whole release with `flock`.
- The LXC secret file is the only source of application secrets at deploy time.
- The GitHub runner needs Incus access, not Docker socket or Docker Remote API
  access on the GPULux host.

## Files

```text
deploy/
├── README.md                  ← this runbook
├── docker-compose.yml         ← canonical GPULux stack
├── gpulux-deploy.sh           ← in-LXC pull/migrate/rollout/health gate
├── .env.shared.example        ← non-secret image and runtime defaults
├── .env.instance.example      ← per-environment domains and secrets template
├── scripts/
│   └── gen-secrets.sh         ← generate a starting env file out of band
└── qualification/             ← disposable pre-event qualification stack
```
