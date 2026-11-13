# Mutation idempotency matrix

This is the auditable classification for every API mutation (issue #715). Route
schemas remain the source of request/response detail; this matrix states the
retry contract.

| Class | Routes | Contract |
|---|---|---|
| Key-protected operational transition | `/api/accreditation/*`, `/api/presence/*`, `/api/activities/*/scan`, `/api/queue/**`, confirmations/declines, exports requests, native/self-service project creation and membership transitions, event diary saves (`POST /api/me/diary/scan`; a re-save also converges on the one `(owner, target)` row, #935), help desk request creation and claim/release/resolve/cancel (`/api/helpdesk/requests/**`; a fresh-key claim retry by the winner with the same meeting also returns the claim without a second notice, and one active request per team/person is a unique constraint, H64-H66) | Client supplies `Idempotency-Key`; the same actor, route, target and payload replays the completed response. A mismatched reuse is `409`; a concurrent in-flight duplicate is `409` with `Retry-After`. |
| Key-protected durable side effect | Invite create/regenerate/expire/renew/resend, enterprise create/visibility/profile/member/judge/logo/FAQ/stand-tag/stand-scannable writes and bulk stand QR generation, event config, announcement CRUD, statistics access overrides, application uploads, question-library proposals and bulk curation, attendance-certificate issue, per-person certified-hours approval, bulk issue, revoke and policy writes (#1083; issue converges on the one live certificate per person, variant and language), plus the guarded role, role-grant-rule, reusable user-link, and application-form mutations listed below | Supported clients attach a key before the write; a replay does not create another token, outbox row, roster change, object reference, audit event, form version, or broadcast. Upload/logo storage keys derive from the request key, so recovery after an interrupted response overwrites the same object key. |
| Naturally idempotent resource convergence | Profile/UI/notification preferences, public directory profile (`PUT /api/me/public-profile`) and its moderation, event diary favourite/note/removal (`PATCH`/`DELETE` `/api/me/diary/:entryId`), per-activity RSVP replacement (`PUT /api/me/rsvps`, the audited staff correction `PUT /api/users/:id/rsvps` and the organizer settings `PUT /api/schedule/:id/rsvp`; serialized per user or per activity with a row lock), sponsor meal plan replacement (`PUT /api/me/meal-plan` and the audited staff correction `PUT /api/users/:id/meal-plan`, serialized per user with a row lock; one post-commit `logistics.meal_plan.updated` carrying only changed meals, none when nothing changed), inbox read/delete, push-token registration, the Live Activity device/session registry (`PUT /api/me/live-activities/device`, `PUT`/`DELETE` `/api/me/live-activities/sessions`, #966), schedule/challenge/room/TV configuration, university normalization, help desk topic proposal/rename/merge (equivalent names converge on one topic), helper profile and availability replacement (`PUT /api/me/helper-profile[/availability]`, H61-H62), review score replacement, and the one-way state changes listed below | `PUT`/`PATCH` converges on the supplied resource representation; `DELETE` either removes the exact resource or returns the documented missing-resource/not-found response. Repeated one-way changes below stop before writing another audit row or emitting another side effect. Clients still attach a key automatically, allowing safe response replay while preserving semantic convergence. |
| State-machine / uniqueness-protected | Invite acceptance, Better Auth session/password/verification operations, project invitation responses, application draft/submission/review decisions, account removal, wallet-device protocols, telemetry | The underlying token lock, unique constraint, or transition lock supplies one winner. These remain explicitly documented exceptions because some are third-party protocol endpoints or have identity/session semantics that cannot replay a generic HTTP response. |

## Scoped route decisions: roles, invite links, and application forms

The following admin routes were checked against their handlers. `idempotencyGuard`
keeps the same actor, route, target, and body bound to the first response. The
header remains optional; web and mobile clients send intent-stable keys automatically.

| Route | Decision | Reason |
|---|---|---|
| `POST /api/roles` | Guarded | Creates a new role ID and audit row on each execution. |
| `PATCH /api/roles/:roleId` | Guarded | Every execution audits and broadcasts the role change; event-access changes also reconcile tickets and wallet passes. |
| `PATCH /api/roles/:roleId/position` | Guarded | Repeating a reorder writes another audit row and identity broadcast, even when the position already matches. |
| `PUT /api/roles/:roleId/capabilities` | Guarded | Replaces the capability set but writes another audit row and identity broadcast on every execution. |
| `DELETE /api/roles/:roleId` | Naturally idempotent | A second request conflicts on the deleted marker before audit, ticket reconciliation, or broadcast. |
| `POST /api/roles/:roleId/restore` | Naturally idempotent | A second request conflicts once the role is live, before audit, ticket reconciliation, or broadcast. |
| `POST /api/roles/:roleId/reset-to-default` | Guarded | Reapplies the snapshot and writes another audit row and identity broadcast on every execution. |
| `POST /api/roles/:roleId/users/:userId` | Guarded | Membership insertion is conflict-tolerant, but a retry repeats audit, grant-rule processing, ticket reconciliation, and broadcasts. |
| `DELETE /api/roles/:roleId/users/:userId` | Guarded | Even when membership is already absent, the handler repeats revoke-rule processing, ticket reconciliation, audit, and broadcasts. |
| `POST /api/role-grant-rules` | Guarded | Inserts a distinct rule row and audit row on each execution; the table has no natural uniqueness constraint for this rule shape. |
| `PATCH /api/role-grant-rules/:ruleId` | Guarded | Reapplying the same rule values still writes another audit row. |
| `DELETE /api/role-grant-rules/:ruleId` | Naturally idempotent | After the first delete, a retry returns not-found before writing another audit row. |
| `POST /api/invites/user-links` | Guarded | Mints a fresh token and inserts a second reusable link and audit row on each execution. |
| `PUT /api/invites/user-links/:id` | Guarded | Recomputes relative expiry from the current time and audits the edit on every execution. |
| `POST /api/invites/user-links/:id/withdraw` | Naturally idempotent | A retry conflicts on the withdrawn marker before another update or audit row. |
| `POST /api/invites/enterprise-links/:id/withdraw` | Naturally idempotent | A retry conflicts on the withdrawn marker before another update or audit row. |
| `POST /api/applications` | Guarded | Inserts another form, initial form-version row, and audit row on each execution. |
| `PATCH /api/applications/:id` | Guarded | A repeated schema update increments the form version and writes another immutable version and audit row. |
| `DELETE /api/applications/:id` | Naturally idempotent | After the first delete, the retry returns not-found before repeating the cascade or audit. |

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
