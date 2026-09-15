# Mutation idempotency matrix

This is the auditable classification for every API mutation (issue #715). Route
schemas remain the source of request/response detail; this matrix states the
retry contract.

| Class | Routes | Contract |
|---|---|---|
| Key-protected operational transition | `/api/accreditation/*`, `/api/presence/*`, `/api/activities/*/scan`, `/api/queue/**`, confirmations/declines, exports requests, native/self-service project creation and membership transitions | Client supplies `Idempotency-Key`; the same actor, route, target and payload replays the completed response. A mismatched reuse is `409`; a concurrent in-flight duplicate is `409` with `Retry-After`. |
| Key-protected durable side effect | Invite create/regenerate/expire/renew/resend, enterprise create/visibility/profile/member/judge/logo/FAQ writes, event config, announcement CRUD, statistics access overrides, application uploads | Supported clients attach a key before the write; a replay does not create another token, outbox row, roster change, object reference, audit event, or broadcast. The temporary compatibility path accepts no-key one-shot requests while clients migrate. Upload/logo storage keys derive from the request key, so recovery after an interrupted response overwrites the same object key. |
| Naturally idempotent resource convergence | Profile/UI/notification preferences, inbox read/delete, push-token registration, schedule/challenge/room/TV configuration, role and role-grant-rule configuration, university normalization, review score replacement | `PUT`/`PATCH` converges on the supplied resource representation; `DELETE` either removes the exact resource or returns the documented missing-resource conflict. Clients still attach a key automatically, allowing safe response replay while preserving semantic convergence. |
| State-machine / uniqueness-protected | Invite acceptance, Better Auth session/password/verification operations, Devpost imports and claims, application draft/submission/review decisions, account removal, wallet-device protocols, telemetry | The underlying token lock, unique constraint, or transition lock supplies one winner. These remain explicitly documented exceptions because some are third-party protocol endpoints or have identity/session semantics that cannot replay a generic HTTP response. |

## Exactly-once boundary

`idempotency_keys` stores a hash of method, route template, parameters and body,
scoped to the actor. It rejects any different payload deterministically. The
idempotency record is claimed before the mutation; a completed response is
stored once. Domain writes, audit entries, and durable `notification_outbox`
rows commit in the same database transaction. SSE is a post-commit freshness
signal by design: Valkey is not a transactional database, so consumers always
refetch the durable Postgres projection after an event. Replayed responses skip
the handler and therefore emit no second broadcast.

All web and mobile mutation helpers attach an `Idempotency-Key` when one was
not supplied. Scanner/offline callers retain their operation key and therefore
reuse it across transport retries.
