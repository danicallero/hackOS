# Rate limiting (#538)

Distributed, Valkey-backed rate limiting across every API replica — the shared
primitive, endpoint classes, fail-open behavior, and the trust-proxy
requirement it depends on.

## Shared primitive

`apps/api/src/lib/rate-limit.ts` exports `consumeRateLimit(bucket, key, rule)`:
a Valkey fixed-window counter (`INCR` + `EXPIRE` on the first hit of the
window, capped at `rule.max`), keyed `ratelimit:<bucket>:<key>`. Because the
counter lives in Valkey rather than process memory, the limit is shared across
every API replica — the concrete requirement behind this whole issue.

`rateLimitGuard(bucket, rule, keyOf)` wraps it as a Fastify preHandler that
throws `TooManyRequestsError` (429, `retry-after` header) on rejection —
composed into a route's `preHandler` array exactly like `idempotencyGuard` or
a capability check, and ordered **first** so an abusive caller is rejected
before any auth/DB work runs.

Better Auth's own built-in rate limiter (covering every `/api/auth/*` path)
is pointed at the same Valkey instance via a small adapter
(`apps/api/src/modules/identity/rate-limit-storage.ts`) implementing its
`customStorage` interface, delegating the atomic step to the same
`consumeRateLimit` primitive — one implementation, one set of metrics,
whether the route is Better Auth's own or this app's.

## Endpoint classes and limits

| Class | Routes | Limit | Key | Configurable? |
|---|---|---|---|---|
| Better Auth baseline | any `/api/auth/*` path not listed below | 60/60s | client IP | fixed |
| sign-in | `POST /sign-in/email` | 30/5min | client IP | fixed |
| sign-up | `POST /sign-up/email` | 30/hour | client IP | fixed |
| password-reset request | `POST /request-password-reset` | 10/hour | client IP | fixed |
| password-reset consume | `POST /reset-password` | 20/15min | client IP | fixed |
| email verify | `POST /verify-email` | 30/hour | client IP | fixed |
| resend-verification | `POST /api/auth/resend-verification` | 3/hour + 60s cooldown (H3, pre-existing) | invitee email | fixed |
| invite-lookup | `GET /api/invites/lookup` | 30/min | client IP | fixed |
| invite-accept | `POST /api/invites/accept` | 20/hour | client IP | fixed |
| scan | `POST /api/accreditation/{check-in,check-in-user,rotate,remove}`, `POST /api/presence/scan` | 120/min (default) | staff user id | `RATE_LIMIT_SCAN_MAX`, `RATE_LIMIT_SCAN_WINDOW_SECONDS` |
| meal-batch | `POST /api/activities/:id/meal-scans/batch` | 60/min (default), per **request** (each carries up to 100 scans) | staff user id | `RATE_LIMIT_MEAL_BATCH_MAX`, `RATE_LIMIT_MEAL_BATCH_WINDOW_SECONDS` |
| snapshot | `GET /api/scanner/snapshot` | 20/min (default) | staff user id | `RATE_LIMIT_SNAPSHOT_MAX`, `RATE_LIMIT_SNAPSHOT_WINDOW_SECONDS` |

**Auth limits are fixed in code, not env-configurable.** A change to the
security posture of login/registration/reset throttling should go through
code review, the same way `MAIL_PROVIDER` is a deploy-time choice rather than
a runtime toggle (`config.ts`) — not something an ops env var can loosen
casually.

**Operational (scan/meal-batch/snapshot) limits are env-configurable**
because event-day throughput needs may genuinely require live tuning without
a redeploy — see `docs/big-event-readiness.md` for the same reasoning applied
to `DB_POOL_MAX`. All three are per **authenticated staff user**, not IP:
multiple scanner devices legitimately share one staff login, and multiple
staff commonly share one venue IP, so IP-keying would be either too loose
(shared devices) or wrongly collective (shared venue network). The `scan`
class is one shared budget across check-in/rotate/remove/presence-scan for a
given staff member, not a separate budget per route.

## Auth limits and shared-venue NAT

Per-IP throttling on `/api/auth/*` is coarse at a hackathon: many legitimate
attendees on venue Wi-Fi often share one public IP behind NAT. The limits
above are deliberately more generous than Better Auth's own built-in defaults
(3 attempts/10s) for exactly this reason. If a shared-IP venue still trips
these limits in practice, the fix is a follow-up (e.g. a secondary
per-account layer) — not something this rollout attempts to solve.

## Trusted-proxy requirement

Better Auth's rate limiter keys on client IP read from the `x-forwarded-for`
header (`advanced.ipAddress.ipAddressHeaders` in `auth.ts`), which by
default it would trust from any caller — a spoofing hole when the API is
directly exposed. To close it, `betterAuthPassthrough`
(`apps/api/src/modules/identity/index.ts`) **always overwrites**
`x-forwarded-for` with Fastify's own `request.ip` before forwarding to Better
Auth's handler — and `request.ip` is only trust-aware of proxy headers when
`config.trustProxy` is set (`TRUST_PROXY=true`, hardcoded in
`deploy/services/api/docker-compose.yml` and the root `deploy/docker-compose.yml`,
and the default whenever `NODE_ENV=production` even without it — see
`config.ts`). In other words: rate limiting inherits the same trusted-proxy
posture the rest of the app already requires — see `deploy/README.md`'s
network/security section. **Never run the API directly internet-facing with
`TRUST_PROXY=true`** (that already applied before #538; it now also matters
for IP-keyed rate limits, not just the audit trail).

The invite and scanner routes (real Fastify routes, not the Better Auth
passthrough) use Fastify's `request.ip` directly for the same reason — no
extra plumbing needed there.

## Fail-open behavior

Every check funnels through `consumeRateLimit`. On any Valkey error, the
request is **allowed through** (fail-open) rather than rejected — a Valkey
outage must never become a full auth or scanner outage, especially on event
day. Two counters expose this on `GET /metrics` (Prometheus, `lib/metrics.ts`
registry), both labeled only by `bucket` — no user id, IP, or other
high-cardinality identifier:

- `hackos_rate_limit_rejections_total{bucket}` — actual 429s issued, by class.
- `hackos_rate_limit_store_errors_total{bucket}` — Valkey errors while
  checking a limit (request was allowed through); a sustained non-zero rate
  here means rate limiting is currently not actually protecting anything and
  Valkey needs attention.
