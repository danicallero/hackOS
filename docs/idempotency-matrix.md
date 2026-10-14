# Mutation idempotency matrix

This is the auditable classification for every API mutation (issue #715). Route
schemas remain the source of request/response detail; this matrix states the
retry contract.

| Class | Routes | Contract |
|---|---|---|
| Key-protected operational transition | `/api/accreditation/*`, `/api/presence/*`, `/api/activities/*/scan`, `/api/queue/**`, confirmations/declines, exports requests, native/self-service project creation and membership transitions, event diary saves (`POST /api/me/diary/scan`; a re-save also converges on the one `(owner, target)` row, #935) | Client supplies `Idempotency-Key`; the same actor, route, target and payload replays the completed response. A mismatched reuse is `409`; a concurrent in-flight duplicate is `409` with `Retry-After`. |
| Key-protected durable side effect | Invite create/regenerate/expire/renew/resend, enterprise create/visibility/profile/member/judge/logo/FAQ/stand-tag/stand-scannable writes and bulk stand QR generation, event config, announcement CRUD, statistics access overrides, application uploads | Supported clients attach a key before the write; a replay does not create another token, outbox row, roster change, object reference, audit event, or broadcast. Upload/logo storage keys derive from the request key, so recovery after an interrupted response overwrites the same object key. |
| Naturally idempotent resource convergence | Profile/UI/notification preferences, public directory profile (`PUT /api/me/public-profile`) and its moderation, event diary favourite/note/removal (`PATCH`/`DELETE /api/me/diary/:entryId`), sponsor meal plan replacement (`PUT /api/me/meal-plan` and the audited staff correction `PUT /api/users/:id/meal-plan`, serialized per user with a row lock; one post-commit `logistics.meal_plan.updated` carrying only changed meals, none when nothing changed), inbox read/delete, push-token registration, the Live Activity device/session registry (`PUT /api/me/live-activities/device`, `PUT`/`DELETE /api/me/live-activities/sessions`, #966), schedule/challenge/room/TV configuration, role and role-grant-rule configuration, university normalization, review score replacement | `PUT`/`PATCH` converges on the supplied resource representation; `DELETE` either removes the exact resource or returns the documented missing-resource conflict. Clients still attach a key automatically, allowing safe response replay while preserving semantic convergence. |
| State-machine / uniqueness-protected | Invite acceptance, Better Auth session/password/verification operations, project invitation responses, application draft/submission/review decisions, account removal, wallet-device protocols, telemetry | The underlying token lock, unique constraint, or transition lock supplies one winner. These remain explicitly documented exceptions because some are third-party protocol endpoints or have identity/session semantics that cannot replay a generic HTTP response. |

## Retention

`idempotency_keys` is bounded (#994, H54 data minimisation). The
`applications-expirer` tick deletes, in batches of 1000 and using
`idempotency_keys_created_at_idx`:

- completed rows older than **7 days** (`IDEMPOTENCY_RETENTION_DAYS` in
  `@hackos/shared/idempotency`) — longer than any legitimate replay. The
  mobile scanner reuses its scan id as key after an offline shift and stops
  replaying a queued scan after `SCANNER_REPLAY_MAX_AGE_DAYS` (6 days; the
  extra day absorbs device-clock drift); an older scan is failed locally
  instead of re-executing (`docs/mobile.md` § Backend changes);
- rows with no response (abandoned in-flight attempts and the H54
  pending-removal marker) older than **1 day**, well past the 30 s reclaim
  threshold.

A key reused after its window executes again as a new request. Because the
table is bounded, the account-removal scrub in `identity/removal.ts` scans at
most 7 days of rows.

## Exactly-once boundary

`idempotency_keys` stores a hash of method, route template, parameters and body,
scoped to the actor. It rejects any different payload deterministically. The
idempotency record is claimed before the mutation; a completed response is
stored once. Domain writes, audit entries, and durable `notification_outbox`
rows commit in the same database transaction. SSE is a post-commit freshness
signal by design: Valkey is not a transactional database, so consumers always
refetch the durable Postgres projection after an event. Replayed responses skip
the handler and therefore emit no second broadcast.

Keys represent user intent (#995). `apiFetch`/`apiUpload` (web) and `apiFetch`
(mobile) derive the key from method, path and payload: the key minted for the
first send is reused when the user re-sends the identical request after a
timeout or lost response, so the server replays the first result. It is
discarded on any definitive answer (2xx, or 4xx other than 408/409/425/429) and
after 10 minutes; a changed payload is a new intent with a new key. Call sites
do not mint keys. Scanner/offline callers and flows that persist a key (profile
photo, networking profile, confirmations, imports) pass their own, which wins.
The API treats the header as optional (`idempotencyGuard`): scripted callers
that omit it run one-shot.

Wallet runtime operations (H28): `POST /api/event/wallet/operations` accepts
Idempotency-Key and retains a unique actor/request key in its durable operation
record. Retries cannot queue a second alert or consume a second quota slot.
Artwork uploads use the shared request idempotency guard; immutable published
image revisions remain available for existing pass/provider caches.
