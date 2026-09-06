---
name: verify
description: Build, launch and drive hackOS (API + web) locally to verify a change end-to-end.
---

# Verifying hackOS changes at runtime

## Launch

```sh
pnpm infra:up          # postgres :5433, valkey :6379, minio :9000, mailpit :8025 (often already up)
pnpm migrate
cd apps/api && WORKERS_INLINE=1 pnpm dev            # API on :3000 (background)
cd apps/web && ulimit -n 65536 && pnpm dev          # web on :3001 (background)
```

Gotcha: without `ulimit -n 65536`, Next dev's watcher dies with EMFILE and
**every route 404s** — that's the environment, not the change.

## Real auth over HTTP (API surface)

`x-test-user-id` only works in NODE_ENV=test. Against the dev server, create a
real Better Auth session:

```sh
curl -c s.jar -X POST :3000/api/auth/sign-up/email -H 'content-type: application/json' \
  -d '{"email":"x@verify.local","password":"Sup3rSecret!x","name":"X","surname":"Y"}'   # surname required
docker exec hackos-postgres-1 psql -U hackos -d hackos \
  -c "UPDATE users SET email_verified=true WHERE email='x@verify.local';"
curl -c s.jar -X POST :3000/api/auth/sign-in/email ... # then use -b s.jar
```

Grant capabilities via SQL: insert into `roles`, `role_capabilities`
(capability strings like `accredit:scan`), and `user_roles`. Note: heredocs
into `docker exec psql` silently no-op — pass statements with repeated `-c`
flags instead.

## Driving the web GUI

No Playwright in the repo; use system Chrome headless from the scratchpad:

```sh
npm init -y && npm install playwright-core
```

```js
chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true })
```

- Log in at `/login` (`input[type=email]`, `input[type=password]`, submit).
- UI language follows the user's `language` column (default `en`) — match
  button text with regexes covering es|en, or set the column to `es`.
- A cookie-notice `<aside aria-labelledby="cookie-notice-title">` overlays the
  bottom-right and intercepts clicks — close its first `button` after load.

## Clean up

Delete seeded rows (`... WHERE email LIKE '%@verify.local'`) from
`check_in_logs` (by `user_id` **and** `staff_id`), `tickets`, `wallet_passes`,
`notification_outbox`, `notifications`, `user_roles`/`role_capabilities`/
`roles`, `sessions`, `accounts`, `audit_log`
(by `actor_id`), then `users`; kill the two dev servers. Workers create
notification rows on check-in, so delete those even if you never touched
notifications.
