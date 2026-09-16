# Environment variables

This is the checked-in inventory of environment inputs that have real
consumers. API variables are parsed by `apps/api/src/config.ts`; Compose
variables are consumed while rendering `deploy/docker-compose.yml` or one of
the split service files. Client and test variables are listed separately so an
optional feature is not mistaken for dead configuration.

`INSTANCE_NETWORK` is intentionally retained. It is consumed by the five
split Compose files to attach separately launched services to the same
external private Docker network; it is not used by the single-stack file.

The email renderer keeps the former defaults as internal constants. SMTP
transport settings and delivery credentials remain supported.

## API and worker runtime

The API and dedicated worker read the following values through `config.ts`.
The worker uses the same config contract, except for HTTP-only controls such
as CORS and SSE limits.

| Variables | Consumer / purpose |
|---|---|
| `NODE_ENV`, `PORT`, `HOST` | API/server startup in `src/config.ts`, `src/server.ts` and `src/app.ts`. |
| `DATABASE_URL` | Postgres pool and migration/admin scripts (`src/db/pool.ts`, `scripts/*.ts`, `scripts/*.mjs`). |
| `VALKEY_URL` | Valkey client, queues, rate limiting, SSE fan-out and notification dispatch. |
| `DB_POOL_MAX`, `DB_IDLE_TIMEOUT_MS`, `DB_CONNECTION_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` | Postgres pool sizing and timeout options in `src/db/pool.ts`. |
| `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `MOBILE_APP_SCHEME` | Better Auth setup, callback URLs, session signing and native-origin validation in `modules/identity/`. |
| `WEB_URL`, `CORS_ORIGINS` | Auth redirects/email links, Google Wallet origins, CORS and Better Auth trusted origins. |
| `REVIEW_FIXTURE_PASSWORD`, `REVIEW_FIXTURE_DELETION_PIN` | Optional synthetic reviewer workspace and its deletion flow. |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION`, `S3_PUBLIC_URL` | S3/MinIO storage, presigned downloads and public sponsor-logo URLs in `src/lib/storage.ts` and logistics/projects modules. |
| `LOG_LEVEL` | Pino logger configuration. |
| `WORKERS_INLINE` | Whether BullMQ processors run in the API process; production Compose forces the dedicated worker mode. |
| `LOG_EXPO_PUSH_TICKETS`, `LOG_EXPO_PUSH_TOKENS`, `LOG_EXPO_PUSH_UNSAFE_DEBUG` | Explicitly opt-in diagnostics for Expo push delivery and token registration. |
| `SSE_MAX_CONNECTIONS_GLOBAL`, `SSE_MAX_CONNECTIONS_PER_TOPIC`, `SSE_MAX_CONNECTIONS_PER_CLIENT`, `SSE_WRITE_TIMEOUT_MS` | SSE connection budgets and slow-client backpressure in `src/lib/sse.ts`. |
| `NOTIFICATION_OUTBOX_BATCH_SIZE` | Notification outbox dispatcher tick size in the worker. |
| `RATE_LIMIT_SCAN_MAX`, `RATE_LIMIT_SCAN_WINDOW_SECONDS`, `RATE_LIMIT_MEAL_BATCH_MAX`, `RATE_LIMIT_MEAL_BATCH_WINDOW_SECONDS`, `RATE_LIMIT_SNAPSHOT_MAX`, `RATE_LIMIT_SNAPSHOT_WINDOW_SECONDS` | Operational scanner rate limits in `src/lib/rate-limit.ts`. |
| `TRUST_PROXY` | Opt-in trust for forwarded client headers when a trusted external reverse proxy is present. Direct Compose exposure defaults to `false`. |

## Email delivery

These variables are functional and must not be removed as part of layout
cleanup:

| Variables | Consumer / purpose |
|---|---|
| `MAIL_PROVIDER` | Fixed to `smtp`; retained as the deploy-time mail contract. |
| `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME` | Sender passed to the SMTP adapter. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Nodemailer/SMTP relay configuration; local default targets Mailpit and production targets Amazon SES's SMTP endpoint. |

Production decision: Amazon SES via SMTP. The AWS region, verified sender
domain and SES SMTP credentials still need to be recorded in the private
production runbook; ordinary AWS access keys are not used by this adapter.

## Optional Wallet and translation features

These are supported optional capabilities, not dead configuration:

| Variables | Consumer / purpose |
|---|---|
| `APPLE_PASS_TYPE_IDENTIFIER`, `APPLE_TEAM_IDENTIFIER`, `APPLE_PASS_ORGANIZATION`, `APPLE_PASS_CERTIFICATE_PEM`, `APPLE_PASS_KEY_PEM`, `APPLE_PASS_KEY_PASSPHRASE`, `APPLE_WWDR_CERTIFICATE_PEM`, `APPLE_APNS_ENVIRONMENT`, `APPLE_PASS_APP_STORE_ID` | Apple Wallet pass generation and APNs pass updates in `modules/logistics/`; signing credentials are all-or-nothing. |
| `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_EVENT_TICKET_CLASS_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_WALLET_PRIVATE_KEY_PEM` | Google Wallet Event Ticket signing, class refresh and object updates. |
| `GOOGLE_WALLET_LOGO_URL`, `GOOGLE_WALLET_HERO_IMAGE_URL`, `GOOGLE_WALLET_WIDE_LOGO_URL`, `GOOGLE_WALLET_BACKGROUND_COLOR` | Optional Google Wallet class branding. |
| `TRANSLATE_PROVIDER` | Selects Google Cloud Translation or LibreTranslate for optional automatic translations. |
| `GOOGLE_TRANSLATE_API_KEY` | Google translation credential. |
| `LIBRETRANSLATE_URL`, `LIBRETRANSLATE_API_KEY` | LibreTranslate endpoint and optional credential. |

## Compose-level variables

Compose substitutes these before containers start. They are not read by the
API config parser unless they are also mapped to an API variable above.

| Variables | Consumer / purpose |
|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Postgres container and construction of `DATABASE_URL`. |
| `VALKEY_PASSWORD` | Valkey password and construction of `VALKEY_URL`. |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BROWSER`, `MINIO_IMAGE`, `MINIO_MC_IMAGE` | MinIO server, console toggle, image pinning and bucket-init sidecar. |
| `API_DOMAIN`, `WEB_DOMAIN` | Construct API `BETTER_AUTH_URL`/`WEB_URL` and inject the web runtime config. Keep them as public origins; external DNS/TLS is outside Compose. |
| `API_PORT`, `WEB_PORT` | Host ports published by the API and web services; defaults `3000` and `3001`. |
| `IMAGE_REPO`, `WEB_IMAGE_REPO`, `IMAGE_TAG` | API/worker and web image references. |
| `PG_MEM_LIMIT`, `VALKEY_MEM_LIMIT`, `MINIO_MEM_LIMIT`, `API_MEM_LIMIT`, `WORKER_MEM_LIMIT`, `WEB_MEM_LIMIT` | Container memory limits in Compose. |
| `INSTANCE_NETWORK` | External private network name for the split service files only. |

## Client and test variables

These variables have consumers outside the production API Compose contract:

| Variables | Consumer / purpose |
|---|---|
| `API_URL`, `NEXT_PUBLIC_API_URL`, `SITE_URL`, `NEXT_PUBLIC_SITE_URL` | Web server/runtime config and canonical metadata (`apps/web/src/lib/env.ts`, `src/app/runtime-config.js/route.ts`, `src/lib/metadata.ts`). |
| `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_EVENT_WEBSITE_URL` | Mobile build/runtime API and event website origins (`apps/mobile/lib/env.ts`, `app.config.ts`). |
| `APP_VARIANT`, `DEV_CLIENT_DEFAULT_LAUNCHER_URL`, `GOOGLE_SERVICES_JSON` | Mobile build profile, development launcher and Android Google services setup (`apps/mobile/app.config.ts`). |
| `EXPO_OS` | Expo platform branch selection across native UI components and tests. |
| `TEST_DATABASE_URL`, `TEST_VALKEY_URL`, `TEST_DATABASE_EPHEMERAL` | API integration-test database/Valkey selection and cleanup. |
| `QUALIFICATION_STACK`, `QUALIFICATION_RELEASE_IMAGE` | Isolated event-day qualification Compose stack and load script. |
| `E2E_WEB_PORT` | Browser E2E server port in `e2e/browser/playwright.config.ts`. |

## Compose cross-check

When adding or removing deployment configuration, compare this inventory with:

```sh
rg -n '\$\{[A-Z][A-Z0-9_]*' deploy
```

Do not add an environment variable merely because a Compose file can
interpolate it: add it only when a real consumer needs the value.
