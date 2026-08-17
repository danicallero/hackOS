# Translation portal (Tolgee)

hackOS's UI copy lives in git-tracked JSON at
`packages/shared/locales/{en,es,gl}/{common,web,mobile,email}.json` (i18next's
standard `locales/{lng}/{ns}.json` layout — see `docs/DESIGN.md` §10 for the
copy-writing rules `scripts/check-copy.mjs` enforces on these files). A
self-hosted [Tolgee](https://tolgee.io/) instance is the translation
portal for editing them without touching code directly.

## Deployment

`deploy/tolgee/` — **not** one of the per-instance services in
`deploy/services/`. Tolgee is org-wide infra: deploy it once, independent of
any hackathon instance's lifecycle. See that compose file's header comment
for the full reasoning (in short: this deployment's actual exposure is a
Cloudflare Tunnel with `http://<service>:<port>` published application
routes, not Traefik — so Tolgee gets its own dedicated Docker network instead
of joining a per-event one, and the tunnel needs a one-time `docker network
connect` plus a new published route to reach it). Required env vars:
`docs/env-vars.md#tolgee`.

## One-time project bootstrap

After `deploy/tolgee/docker-compose.yml` is up and reachable:

1. Log in with the `TOLGEE_INITIAL_USERNAME`/`TOLGEE_INITIAL_PASSWORD` you
   set at deploy time, then change the password from the Tolgee UI.
2. Create one project (e.g. "hackOS").
3. Add three languages: `en`, `es`, `gl`.
4. Add four namespaces matching the resource files: `common`, `web`,
   `mobile`, `email`.
5. Import the existing JSON files as the seed content (Tolgee's import UI
   accepts the i18next JSON shape directly, including `email.json`'s nested
   `mail.auth.verify.subject`-style keys).
6. Generate an API key (project-scoped is enough — the CLI only needs
   push/pull access to this one project) and set it as `TOLGEE_API_KEY` in
   your local shell and as a GitHub Actions repository secret, alongside
   `TOLGEE_API_URL` (the public URL from the published application route).
7. Fill in the real `projectId` in `.tolgeerc.json` (the checked-in file has
   a placeholder value) and open a small PR with that one-line change.

## Day-to-day sync

Configured in `.tolgeerc.json` (repo root), using the official
[`@tolgee/cli`](https://docs.tolgee.io/tolgee-cli) (`format: JSON_I18NEXT`,
`convertPlaceholdersToIcu: false` — hackOS's `{var}`/`{{var}}` placeholders
stay exactly as i18next expects them, never rewritten to ICU syntax):

- `pnpm i18n:push` — pushes the **en** (source) strings to Tolgee, so
  translators see newly-added keys. Never overwrites `es`/`gl` in Tolgee.
- `pnpm i18n:pull` — pulls all three languages back into the JSON files,
  then runs `pnpm check:copy` on the result.

`.github/workflows/i18n-sync.yml` automates both: push runs on every merge
to `main` that touches `packages/shared/locales/**`; pull runs weekly (and
on demand via `workflow_dispatch`) and opens a PR with whatever translators
changed — translations never land on `main` directly, they go through the
same review path as any other change.
