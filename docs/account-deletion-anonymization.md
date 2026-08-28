# H54 — account deletion and irreversible anonymization audit

**Review date:** 2026-08-27
**Scope:** `apps/api`, `apps/mobile`, `apps/web`, Postgres migrations, object
storage references, offline scanner paths, notification workers, audit/export
paths, and the account/privacy copy.  This is a code and data-lifecycle audit,
not a legal opinion.

## Executive result

The branch implements two server-selected outcomes plus one short operational
transition:

```text
active --(no canonical accreditation)----------------> full deletion
active --(check_in_logs accreditation)--> removal_pending
                                      |\
                                      | +-- outside venue --> anonymous participant
                                      |\
                                      +---- inside venue --> pending exit
                                                          --> staff/system exit or
                                                              recovery expiry
                                                          --> anonymous participant
                                      pending exit keeps only transient
                                      recovery/exit identity; finalization
                                      revokes sessions/accounts/push and
                                      removes the remaining profile data
                                      no anonymous-to-user mapping
```

The mobile and web clients call `GET /api/me/removal-eligibility` and do not
infer the mode from a badge, cached profile, or client boolean.  `DELETE
/api/me` is selected only when the server sees no canonical accreditation;
an inconsistent open door session may briefly use its pending-exit path while
it is reconciled.  `POST
/api/me/anonymize` is explicit and requires `{ "confirm": true }`.  Admin
equivalents are capability-gated under `/api/users/:id`.

The authoritative implementation is `getAccountRemovalEligibility()` and the
locked preflight in `apps/api/src/modules/identity/removal.ts`. A row in
`check_in_logs` is the canonical accreditation boundary. Door/activity/badge
history is inspected as an integrity signal when accreditation is absent; it
does not, by itself, turn the account into a permanent anonymous-audit case.
Acceptance, applications, tickets, wallet passes, permissions, and
notifications alone do not force anonymous retention.

After anonymization the `users` row, credentials, identity-bearing service
relationships, personal files, direct identifiers, and raw operational scan
rows are deleted or detached as applicable.
Before those rows are destroyed, the verified attendance total is calculated
and stored on a new `anonymous_participants.id` generated with
`crypto.randomUUID()`; no deterministic input and no mapping table is used.
The anonymous row contains a random subject ID, verified venue minutes, and
dynamic application values explicitly marked `ANONYMOUS_AUDIT` in the immutable
form version used by each submitted response. The current HackUDC forms start
with age, gender, university, degree, graduation year, and origin city, but
future configured dimensions do not require anonymization-service changes.
Missing values are omitted. The guarantee is scoped precisely: the retained
record has no identity mapping in the hackOS Postgres database. Provider copies,
browser/device caches, infrastructure logs, backups, and inference from an
unusually small demographic cohort require the operational controls and
confirmations listed below.

## 1. Current architecture and flows

### Identity and access

Registration is external to hackOS.  An accepted participant or authorized
staff member receives an app-capable account; acceptance itself is not a
mobile login grant.  Better Auth credentials live in `accounts`, server
sessions in `sessions`, and the identity/profile in `users`.  Role is derived
from capability groups and event relationships in `apps/api/src/modules/identity/role.ts`;
there is no role column to preserve or anonymize.

The old implementation on `origin/main` (`anonymizeUser()` in the former
`apps/api/src/modules/identity/anonymize.ts`) changed a user in place to an
`anonymized+<id>@deleted.invalid` row.  That left the original numeric row and
all its foreign-key relationships available as an identity-shaped audit
subject.  The obsolete compatibility module has been removed; the only
implementation is now the shared lifecycle in `removal.ts`.

### Removal request

1. The authenticated client reads the server preflight. If the primary email
   is verified, the client requests a short-lived one-time security PIN and
   submits it with the destructive request. A real account with no usable
   email code must instead re-enter its current credential password; synthetic
   fixture accounts use the fixture-only PIN path.
2. `prepareAccountRemoval()` locks the permission graph and target user,
   re-evaluates the boundary, and commits `account_state = 'removal_pending'`
   with the selected action. A live open session produces `pending_exit`, not
   a rejected privacy request.
3. For a finalizable request, sessions, Better Auth accounts, push tokens and
   dietary values are removed in preparation. For `pending_exit`, those
   identity and catering rows remain only for the fixed recovery window so the
   participant can cancel or staff can record the exit; `account_state` blocks
   normal participant activity. Wallet rows are marked voided on finalizable
   paths while external invalidation is attempted.
4. S3/MinIO uploads, DSR exports, and provider wallet artifacts are cleaned
   outside the database transaction. A failure returns `503
   removal_storage_pending`, keeps the account inaccessible, and queues a
   bounded retry.
5. Once a valid staff/system exit or the fixed recovery deadline makes a
   pending request finalizable, `finalizeAccountRemoval()` takes a new
   transaction, computes the verified
   attendance total before destroying activity rows, creates the random
   anonymous subject where required, scrubs relationships, and deletes the
   `users` row. The final operation is idempotent through the pending state and
   self-service completion idempotency record.

### Client flows

- Web: `apps/web/src/app/(app)/settings/profile/danger-zone.tsx` renders the
  server-selected “Delete account” or “Anonymize my data and close account”
  action, keeps the action available while inside, explains the concise
  consequences, links the Privacy Policy, confirms with an accessible modal,
  requests a one-time PIN for verified primary email accounts, sends
  `Idempotency-Key`, clears app-owned browser storage, signs out, and redirects
  even when the response is ambiguous after the server has revoked access.
- Mobile: `apps/mobile/components/account-screen.tsx` performs the same
  preflight, warning and confirmation flow, requests the same verified-email
  PIN through a native modal, sends the authenticated API request, clears
  native app data and scanner cache, signs out, and explains that a
  storage/network error may still have completed server-side. A pending-exit
  response leaves the authenticated recovery surface available: after sign-in
  it shows the expiry countdown, tells the participant to ask staff to record
  the exit, and offers cancellation or sign-out until the exit/deadline wins.
- Email is a secondary support/privacy link only; the security PIN email is
  issued by the authenticated in-app flow. Email is not the mechanism that
  starts deletion or anonymization.

## 2. Data-flow map

```text
external registration / acceptance
              |
              v
users <---- accounts, sessions, tokens, push, wallet, ticket
  |
  +--> application_responses --> uploaded objects / DSR exports
                         \--> explicitly retained anonymous application values
  |
  +--> check_in_logs, time_logs, activity_logs --> presence calculation
  |
  +--> meals / notifications / permissions / staff relationships
  |
  +--> submissions --> repos --> queue_entries --> judging/review history
  |
  +--> invite redemptions / Devpost denormalized email snapshots
  |
  +--> audit_log.actor_id and JSON/entity-id snapshots

anonymization:
  verified time calculation --> anonymous_participants (random UUID + minutes)
  raw check-in/time/activity rows ------------------> deleted
  everything else identity-bearing --------------------> deleted or detached
```

Important indirect paths are `application_responses.responses` (including
file keys and demographic answers), `devpost_participants.email/name`, invite
redemption snapshots, `audit_log.before/after/reason/entity_id`, notification
payloads, DSR `storage_key`, meal inbox `badge_id/result/error`, object-store
keys, wallet device identifiers, and offline scanner queues.  A foreign key
scan alone is therefore insufficient.

## 3. Findings and priorities

| ID | Severity | Classification | Finding and current disposition |
| --- | --- | --- | --- |
| F01 | Critical | confirmed code problem; privacy/security risk | The previous in-place anonymizer retained the `users` row and identity-shaped foreign keys. H54 now creates a random anonymous subject, migrates only the attendance evidence, scrubs direct/denormalized relationships, and deletes the user. |
| F02 | Critical | confirmed code problem; privacy/security risk | Self-service uses `/me` routes and active-session authorization; admin operations require `ADMIN_ALL`; request IDs are not accepted as target identity for self-service. This closes the original IDOR risk. |
| F03 | High | confirmed code problem; privacy/security risk; operational risk | Removal must race check-in, presence, notification, wallet and invite writes. The pending state, user-row locks, active-state filters, and the final `0730` reference triggers reject new direct user references after pending begins. The event-end closer locks and re-checks each candidate so one removal cannot abort the whole worker tick. |
| F04 | High | requires legal/product confirmation; operational risk | `check_in_logs` is the canonical accreditation boundary. Door/activity/badge history without accreditation is reported as an inconsistency and follows full deletion with a warning; confirm the reconciliation procedure for legacy records rather than turning artifacts into permanent retention. |
| F05 | High | confirmed code problem; operational risk | Object deletion and final DB deletion are separate phases. A storage or final-transaction failure leaves access revoked and `removal_pending`, with bounded retry. Operators must monitor and replay pending rows if the queue is unavailable. |
| F06 | High | confirmed code problem fixed in this follow-up; privacy/security risk; operational risk | Staff offline meal queues contain badge credentials and must be encrypted, owner-bound, cleared on closure, and rejected when stale. Native scanner records are encrypted and tombstoned; an offline staff device can still retain encrypted data until it reconnects and is wiped or retired. The central permanent denylist prevents a stale credential from resolving to a replacement participant, but it cannot remotely erase an unreachable device. The pre-H54 combined native database had ownerless plaintext payloads, so it cannot be safely assigned to the first authenticated operator; the current migration retires the app-owned file and its SQLite sidecars, blocks the queue if retirement fails, and requires any lost pre-upgrade scans to be re-recorded. Presence/activity/meal replay now also rejects an event timestamp earlier than the current badge assignment boundary, so a late scan cannot be accepted under a replacement owner. |
| F07 | High | confirmed code problem fixed in this follow-up; privacy/security risk; operational risk | Installed Apple/Google Wallet passes and copies already delivered to a device are outside the database. The server voids rows, sends provider invalidation/update signals where configured, and retires scanned badge/ticket credentials in an unlinked keyed-digest denylist. Physical badge IDs may be rotated to another participant: the current assignment timestamp is recorded server-side and stale pre-replacement event timestamps are rejected at enqueue and locked processing, while a permanently tombstoned account credential remains unusable by design. The branch removes the old expiring-tombstone compatibility path; it avoids retaining/distributing raw central tombstone values and rejects retired ticket tokens when used as badges. |
| F08 | High | privacy/security risk; requires legal/product confirmation | Application logs, web-server logs, analytics, database backups, object-store versioning, and provider logs are not retention systems represented in this repository. Production operations must confirm their subject lookup, retention and purge controls before claiming system-wide erasure. |
| F09 | High | confirmed code problem fixed in this follow-up; privacy/security risk; operational risk | Self-service destructive routes require the current authenticated session. A verified primary email requires a short-lived one-time PIN sent to that address; an unverified real account that cannot receive that code must re-enter its current password. Synthetic fixtures may use the configured fixture PIN. The password is verified against the credential account and is never placed in retry jobs, audit rows, or responses. |
| F10 | Medium | confirmed code improvement; privacy/security risk | Anonymous application retention is now driven by each submitted response's immutable form-version fields (`retention_mode = anonymous_audit`) and optional open semantic dimension. Labels, translations, and the mutable current form do not grant retention. |
| F11 | Medium | privacy/security risk; requires legal/product confirmation | Age, gender, university, degree, graduation year and origin city can identify a person in a rare cohort. Small-cell suppression/aggregation is intentionally outside this implementation; the audit owner must make any reporting decision before publishing combinations. |
| F12 | Medium | confirmed code problem; privacy/security risk | The first H54 implementation retained raw check-in/door rows under the anonymous UUID, exceeding the approved minimum. The final fresh-schema `0730` state has no anonymous raw-presence foreign keys; finalization retains only calculated guaranteed minutes plus explicitly retained application values. |
| F13 | Medium | confirmed code problem fixed in this follow-up; operational risk; privacy/security risk | Self-service destructive requests now require a non-empty `Idempotency-Key`; a missing key is rejected instead of entering a path that cannot safely replay a lost response. Supported mobile/web clients already send a high-entropy key, and the no-production-database assumption allows the old no-key compatibility path to be removed. |
| F14 | Medium | confirmed code problem; operational risk | Offline stale submissions can reach the server after anonymization. Permanent unlinked keyed-digest badge/ticket tombstones and active lookups reject them, and clients remove terminal stale queue items. Devices that never reconnect cannot be remotely wiped; device management/reinstall remains the operational control for the residual local copy. |
| F15 | Medium | confirmed code improvement; privacy/security risk; requires legal/product confirmation | Shared public repositories, Devpost content and external documents can contain a person's identity independently of hackOS rows. The service removes the subject's personal submission/member link and deletes solo projects, but preserves a shared project for remaining members. The participant Privacy Policy now explains that forms/project records may request links to independent external sites with their own policies and no GPUL affiliation; confirm that this wording matches the event's external-content policy. |
| F16 | Medium | confirmed code problem fixed in this follow-up; privacy/security risk; operational risk | The fresh-schema migration `0730` installs `time_logs_kind_check` and versioned response integrity from the start. Invalid presence events and unversioned response policies are not supported compatibility states; retained calculations rely on the database domain (`in`/`out`) and submitted form-version policy. |
| F17 | Medium | App Store review risk; confirmed code improvement | The prior mobile flow did not expose a direct, truthful account action. The current Account/Data control is visible in-app, remains available while inside, distinguishes full deletion from irreversible anonymization/pending exit, links the Privacy Policy, and explains the consequences. Reviewer access instructions must provide an accepted test account that can reach it. |
| F18 | Medium | App Store review risk; requires legal/product confirmation | “Delete” is reserved for full deletion; “anonymize” names the irreversible alternative. Privacy policy and App Store privacy disclosures must match actual operational retention and external-cache limitations. |
| F19 | Low | optional hardening | The branch has focused regression tests and a documented matrix, but provider deletion, lost-response, offline-device, backup and rare-cohort tests require deployment fixtures outside this repository. |
| F20 | High | confirmed code problem fixed in this follow-up; privacy/security risk | A completed pending-exit scan could have persisted `userId` in the scanner idempotency response, and a late HTTP `202` could have overwritten a finalized `200`. Pending-exit responses are now identity-free and idempotency completion writes are monotonic. |
| F21 | High | confirmed code problem fixed in this follow-up; privacy/security risk; operational risk | A retired ticket token could previously be assigned as a badge because the badge guard checked only live `tickets` rows. The guard now checks the detached ticket digest denylist too; regression coverage proves a retired ticket cannot become a replacement badge. |
| F22 | Medium | confirmed code problem fixed in this follow-up; privacy/security risk; operational risk | Synthetic participant rows could otherwise leak through generic application-file exports, personal export bundles, DSR request views, or a guessed private-upload key. Global export/read paths now exclude marked subjects, DSR target creation is scope-checked, and upload downloads fail closed for missing or out-of-scope owners. |

## 4. Authoritative deletion boundary

`getAccountRemovalEligibility()` is authoritative and is called again under a
`SELECT ... FOR UPDATE` lock before pending is committed. It currently returns:

| Condition | Result |
| --- | --- |
| No `check_in_logs`, `time_logs`, or `activity_logs`; no current badge; empty badge history | Full deletion (`DELETE /api/me`) |
| A `check_in_logs` accreditation exists | Irreversible anonymization (`POST /api/me/anonymize`) |
| No accreditation, but a door/activity/badge reference exists | Full deletion with `inconsistent_operational_reference` warning; reconcile the legacy artifact safely |
| The selected action has a latest valid `time_logs.kind = 'in'` at the current DB time | Request is accepted as `202 pending_exit`; access is revoked, only an exit scan is allowed, and that valid exit triggers finalization |
| A ticket, wallet pass, acceptance, application, permission, notification or preference exists without operational history | Still full deletion eligible |

This is intentionally a backend fact, not a client-side `hasCheckedIn` flag.
`check_in_logs` is the canonical physical boundary. The other references are
integrity signals: they trigger a warning and safe cleanup, but do not silently
become a permanent retention requirement. A product decision may change the
reconciliation rule, but it must change the server function and tests together.

## 5. Anonymous-account design

`anonymous_participants` has these permanent fields:

```text
id (random UUID), guaranteed_presence_minutes, created_at
```

Application values are normalized in `anonymous_participant_fields` with the
anonymous subject UUID, non-identifying form/application context, field key,
optional semantic dimension, original field kind, and typed JSON value. This
keeps retained fields queryable without a new table column for every future
audit requirement.

The UUID is generated only at finalization with `randomUUID()` and is not
derived from the user ID, email, name, DNI, badge or a hash of any of them.
There is no bridge table, mapping column, reversible encryption key, or
idempotency response containing the original identity. The original `users.id`
is deleted. Raw check-in and time logs are used to calculate the aggregate,
then deleted; the schema has no anonymous foreign key for retaining them. A
final anonymous audit event contains the retained-field list but suppresses
request IP, user agent, and request-supplied reason text.

The demographic values are not assumed to live only on `users`: the extractor
reads each application response together with the immutable form snapshot
stored on that response and the current university directory value. It copies
only fields whose snapshot explicitly says `retention_mode =
anonymous_audit`; unmarked fields are destroyed with the response. The
optional semantic dimension is an open stable slug for reporting, not a
hardcoded whitelist. The current HackUDC configuration uses age, gender,
university, degree, graduation year, and origin city; another application may
retain a different explicitly configured field. A missing answer produces no
row and no fabricated value. Labels and translations have no retention effect.

The guarantee is “not recoverable through normal hackOS database relationships”
and not “impossible for every external observer to infer.” Cohort-size risk,
provider copies, backups and logs are separate controls (A07–A09, A17).

## 6. Operational retention and dietary data

During the event, `users.food_intolerances`,
`users.food_intolerance_notes`, and the derived `dietary_data_state` are
available to authorized logistics paths. Native scanner snapshots include only
what a staff scanner needs at the point of service; meal inbox rows use the
badge only as a transient retry credential. Terminal meal results retain
counts/status and clear `badge_id`; they do not retain dietary fields.

An anonymization request while the participant is inside is accepted as a
pending-exit transition. Access and participant services are revoked, meal and
other new activity writes are blocked, and only an exit lookup/scan may use the
temporary operational identity. Staff must record the exit; the valid exit
then triggers finalization. Dietary values remain available only during this
reversible transition so staff can safely complete any already-in-flight
catering operation; they are cleared during irreversible finalization and are
never copied to the anonymous record. Cancellation restores the active account
before the exit/deadline race is won. Both clients state that the request ends
participation before confirmation.
Dietary data is not copied into `anonymous_participants`, audit snapshots,
exports, notification history, or the permanent anonymous dataset by the H54
code. The remaining check is operational: purge provider/email/server logs and
offline copies according to the controls in F06/F08.

## 7. Venue-presence calculation

`guaranteedMinutesAtRemoval()` reads:

- valid `time_logs` `in`/`out` events for the user; and
- `activity_logs` events, which can confirm or renew a presence window under
  the existing H24 policy.

It uses the PostgreSQL clock as cutoff and
`event_config.presence_certainty_window_minutes` (default 720 minutes). An
interval receives permanent credit only when an exit or an in-window activity
secures it. Expired provisional intervals and conflicts receive zero credit;
invalid `time_logs.kind` values cannot survive the validated database
constraint. The total is floored to complete minutes and stored in
`anonymous_participants.guaranteed_presence_minutes` before raw activity rows
are deleted.

Edge behavior:

| Case | Behavior |
| --- | --- |
| Missing door-out | Provisional interval expires and contributes zero unless an in-window activity secured it; an open current session leaves an accepted removal request pending until exit. |
| Duplicate rapid `in` | Live scanner rejects it; a manually corrected `in → in` sequence is marked conflicting and credits zero for the affected window. Invalid `kind` values cannot survive the validated database constraint. |
| Manual correction | Manual rows use the same calculator; invalid ordering is visible to staff and cannot manufacture guaranteed time. |
| Accreditation before first door scan | Check-in crosses the removal boundary, but it contributes no presence minutes until an interval is secured. |
| Participant still inside | The request returns `pending_exit`; no anonymous row is created yet. Only a valid exit path is allowed, and its completion triggers finalization. |
| Event still running | Client warning includes participation termination, access/service/proof loss; server accepts the request and waits for exit. |
| Event-end closer | It writes the exact system-generated `out` at `event_config.event_ends_at`; that automatic event-closing exit is a valid pending-removal completion path. An already-expired H24 certainty window is also valid without fabricating an `out`. |

Raw check-in and time history is not retained after anonymization. The
calculated guaranteed minutes on `anonymous_participants` are the permanent
presence evidence; F12 records the corrective migration that enforces this
minimization boundary. For a pending request, a normal current staff `out`,
the exact event-end system-generated `out`, or expiry of the latest accrued
H24 certainty window can make the transition safe. The event-end path is
matched to `event_config.event_ends_at`; missing event dates suppress only the
live-event warning and never bypass the accreditation/removal boundary.

## 8. Mobile and web UX changes

Both clients use an Account/Data danger zone and server preflight:

| State | Primary action | Required explanation |
| --- | --- | --- |
| Fresh account | “Delete account” | Permanent deletion of the account, credentials, tokens, profile, files and related non-operational data; event spot/services end. |
| Operational history | “Anonymize my data and close account” | Identity is destroyed; verified attendance and explicitly configured anonymous application values remain under a random subject without a link to the person. |
| Live open venue session | Same action remains visible; request returns `pending_exit` | The request ends participation, permits only the recovery/exit process, and completes irreversible closure after staff records a valid exit or the fixed recovery deadline expires. |
| Any anonymization | Concise confirmation warning + Privacy Policy link | Identity is removed; explicitly retained anonymous audit data may remain without a link; named certificates, ECTS evidence and identity-linked participation proof cannot be issued later. |

The modal is keyboard/screen-reader reachable on web, uses native confirmation
on mobile, and has English/Spanish/Galician strings. Verified-primary-email
accounts receive a one-time security PIN in the flow; unverified real accounts
re-enter their current password, while synthetic fixtures use the fixture-only
PIN path. The destructive copy stays concise and
links to the Privacy Policy for retention detail. On success or an
ambiguous network/5xx/storage response, local account data is cleared and the
session is ended; the UI tells the user that server processing may still be
retrying. A normal business conflict leaves the page in place so the user can
correct it.

## 9. Backend/API changes

| Surface | Implementation |
| --- | --- |
| Preflight | `GET /api/me/removal-eligibility`; admin `GET /api/users/:id/removal-eligibility`. |
| Full delete | Authenticated `DELETE /api/me`; admin `DELETE /api/users/:id`; both re-evaluate and select full deletion only without canonical accreditation. Verified-primary-email self-service calls include the one-time PIN. An inconsistent open session may return `pending_exit` before deletion. |
| Anonymize | Authenticated `POST /api/me/anonymize` with `{confirm:true}`; admin `POST /api/users/:id/anonymize`; admin requires `ADMIN_ALL` and cannot target self. Verified-primary-email self-service calls include the one-time PIN. An open session returns `202 pending_exit`, not an error. |
| Security PIN | Authenticated `POST /api/me/removal-pin`; the server locks the active account, invalidates older challenges, stores only an HMAC digest/nonce, and queues the six-digit code through `notification_outbox`. |
| Authentication | Active-user guard rejects `removal_pending`/deleted users from ordinary participant services; the profile guard allows only pending recovery/status/cancel. Verified-primary-email self-service requests also require a short-lived one-time PIN. Sessions, Better Auth accounts and push tokens are removed during preparation for finalizable paths and during pending-exit finalization. |
| Authorization | `/me` avoids caller-supplied target IDs; admin routes use capability guards and self-protection. |
| Idempotency | Clients send keys; self completion is moved to an identity-free scope before deleting `users`; pending-exit scanner responses omit target identity; completion writes cannot be regressed by a late `202`; stale in-flight records can be reclaimed. |
| Storage | Exact subject upload path, response-derived upload prefixes, DSR export prefixes and known storage keys are deleted; S3 deletion errors are surfaced and retried. |
| External identity | Google Wallet objects are expired where configured; Apple Wallet push invalidation is attempted; unregistered passes are already gone. |
| Writers | `0730` installs active-user reference triggers for every final direct FK to `users`; domain writers also use active filters and row locks. |
| Audit | Removal deletes identity-bearing subject/actor audit rows rather than preserving a hidden identity bridge. The final anonymous event has no IP/user-agent. |

## 10. Database and migration changes

`0730_account_deletion_anonymization.sql` is the single fresh-schema H54
baseline. It contains the lifecycle gate, anonymous subject and dynamic
retained fields, nullable operational actor references, immutable form
versions, fixture markers, badge-assignment fence, keyed scanner denylist,
pending-exit rules, strict presence checks, and active-user reference triggers.
It intentionally performs no broad identity cleanup for a populated database.

Migration policy is checksum-enforced by `apps/api/scripts/migrate.ts`. The
development-only H54 chain was squashed because it has not shipped outside this
branch. If a populated deployment ever needs H54, prepare and review a separate
upgrade migration rather than reusing this fresh baseline. After first
deployment, applied checksums are immutable and later corrections use a new
migration.

## 11. Offline caches and external copies

### Native staff scanner

`apps/mobile/lib/scanner-db.native.ts` stores the roster encrypted with
AES-256-GCM and scopes queues/sync state by signed-in owner. A successful
snapshot is replace-all, no raw central tombstone values are returned, and
sign-out wipes the roster. Closure wipes the local account/cache. A queue item
rejected as `not_found`, `badge_unknown`, or `badge_revoked` is deleted rather
than retained indefinitely. An offline device that never reconnects cannot
receive a tombstone or a remote wipe; it must be covered by device management
and the release/reinstall procedure.

The current permanent denylist is deliberately unlinked and stores only a
stable HMAC digest of the raw badge/ticket credential. That is not an anonymous
audit record. Ordinary badge rotation may assign the old physical badge to a
different participant; the server records the new assignment boundary and
rejects offline events timestamped before that replacement. A credential
retired with an account remains globally tombstoned, because an arbitrarily
late offline scan must not resolve to a replacement participant. The server
also rejects a retired ticket token when it is presented as a badge.
The retired pre-H54 `hackos-scanner.db` is not migratable: its plaintext
pending rows had no trustworthy owner, and its roster also contained personal
data. On the first authenticated queue access, current code closes and
deletes that app-owned database plus `-wal`, `-shm`, and `-journal` sidecars;
it never imports or replays those rows. A device upgrade therefore requires
staff to re-record any scan that existed only in the old queue. If the OS
refuses deletion, queue initialization fails closed and retries later, so the
old identity-bearing file is not used while it remains present.

### Web staff scanner

`apps/web/src/components/logistics/offline-queue.tsx` stores pending meal
scans as AES-GCM ciphertext in browser `localStorage`, with a non-extractable
per-owner key in IndexedDB and the owner ID authenticated as additional data.
The legacy plaintext key is removed rather than migrated or replayed. Queue
loads/syncs are owner-scoped, account closure removes the envelope and key,
and stale participant rejections discard the queued credential. A browser
that stays offline cannot receive a central tombstone and there is no remote
wipe for an unreachable browser; device/browser retirement and closure remain
an operational residual window, not a hidden identity mapping.
`clearWebAccountData()` also clears the app-owned local/session-storage
namespace during closure.

### Wallets, logs, backups

Database wallet rows, access tokens, device registrations and credentials are
deleted; installed passes and provider delivery logs are not controlled by
Postgres. The same distinction applies to reverse proxies, analytics,
exception telemetry, PostgreSQL WAL/backups and S3 versioning. The codebase
does not expose those retention systems, so “irreversible” must not be used to
claim those systems have been purged without an operations runbook.

## 12. Concurrency and race analysis

The safe ordering is:

```text
lock permission graph + user
        |
        +--> state = removal_pending; revoke auth/delivery
        |          |
        |          +--> if open: pending_exit; only valid `out` is accepted
        |          +--> direct-FK triggers reject other identity references
        |
        +--> external cleanup (retryable)
        |
        +--> lock user; re-check exit; compute/migrate audit evidence;
                    scrub; delete user
```

The following races are covered:

- check-in vs removal: the first transaction holding the user row wins; the
  other either becomes part of history before pending or receives an active
  state conflict;
- door scan vs removal: presence writers lock/filter active users, and the final
  `0730` trigger rejects late identity references except the pending
  participant's valid `out`; exit completion rechecks the same row lock;
- meal scan vs removal: active badge/ticket lookup and permanent tombstones
  reject stale scans; terminal inbox data is minimized;
- judging/teams/notifications: readers exclude closed users; direct FK writes
  are guarded; notification dispatch locks the user before sending;
- event-end closer vs removal: candidate user rows are locked and rechecked;
- push and export jobs: active checks, request-owned export prefixes and
  finalization cleanup prevent post-closure delivery/resurrection;
- repeated request: locked pending action cannot change from delete to
  anonymize or vice versa; self completion replay is identity-free;
- pending-exit response race: the scanner's durable response is sanitized
  before idempotency persistence, and a late request response cannot overwrite
  a completed result;
- partial failure: pending state prevents access restoration, storage deletion
  is idempotent, and retry jobs are bounded.

Remaining non-transactional limits are offline devices and external providers.
The web queue has an owner-bound encrypted storage path, but an offline browser
cannot receive a central tombstone until it reconnects; device/browser
retirement and closure are covered as an operational control rather than a
hidden identity mapping.

## 13. Apple App Store review

Apple’s current [App Review Guidelines, section
5.1.1(v)](https://developer.apple.com/app-store/review/guidelines/) says that
apps supporting account creation must offer account deletion within the app.
Apple’s [account-deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/)
also says the control should be easy to find, should cover the account and
associated personal data, and should explain when completion takes additional
time or when data is retained under an applicable requirement.

The unusual hackOS model does not remove the review risk: registration is
external and access is restricted, but the app still presents authenticated
account-based functionality and must give a reviewer a reachable account/data
control. The release checklist must provide a seeded accepted participant (and
staff account where relevant), credentials through App Store Connect review
notes, and the exact path to Settings → Account & Data.

Likely review failures if regressed:

- only a `mailto:` link or support ticket starts the operation;
- the button says “delete” while the backend retains identity;
- the app says “all data deleted” while anonymous audit, wallet/provider,
  offline or backup copies remain;
- the reviewer cannot reach the danger zone because the account is not
  accepted/authorized;
- privacy policy, App Store privacy answers and implementation disagree.

There are no purchases, subscriptions or public user-generated-content feeds,
so those special flows do not change this implementation. No current ECTS or
certificate endpoint was found in the repository; product must not promise a
later named proof after anonymization unless it deliberately changes the
retention model.

The repeatable accepted accounts and the synthetic participant judging queue
used to exercise these states are documented separately in
[Synthetic reviewer fixtures](./reviewer-fixtures.md). That fixture system is
isolated by persisted markers from real participant operations, statistics,
exports and the permanent anonymous audit dataset while running in the same
deployed API/database; its admin-only usage signal records only a last
successful sign-in timestamp.

## 14. Required data-lifecycle analysis

“Delete” below means remove the subject's rows/values or detach the subject's
actor FK. “Anon” means retain only if explicitly stated; it never means keep a
synthetic identity-shaped `users` row.

| Data / table and participant fields | Before check-in | During event | After anonymization | Permanent anonymous audit record | Reason |
| --- | --- | --- | --- | --- | --- |
| `users`: id, email, verification, image, name, surname, DNI, secondary email, language, UI prefs, timestamps | Full account data | Active profile/service identity | Delete | No | Direct identity/auth profile. |
| `users`: badge_id, badge_id_history | Credential before use | Active badge operations | Delete; permanent unlinked keyed-digest non-reuse tombstone | No | Credential is not audit data; the digest tombstone exists only to reject arbitrarily late offline replay. |
| `users`: food_intolerances, food_intolerance_notes, dietary_data_state, shirt_size | May be edited | Operational catering/badge data | Keep dietary values only during reversible `pending_exit`; clear them during finalization, then delete the remaining user row | No | Dietary data supports active/in-flight catering only and is never part of the permanent anonymous audit dataset. |
| `users.university_id` / `universities.name` | Profile dimension | May support services | Detach/delete the subject link; catalog survives | Only an application field explicitly configured for anonymous audit may retain a university value | Profile data is not copied merely because the shared university catalog exists. |
| `accounts`: provider/account IDs, access/refresh/ID tokens, password | Auth credential | Auth credential | Delete | No | Credentials and provider identifiers must not survive. |
| `sessions`: token, IP, user agent, expiry | Login session | Login/session | Delete during preparation for finalizable paths; keep only the initiating/recovery session window for reversible `pending_exit`, then delete at finalization | No | Pending recovery needs authenticated status/cancel/exit guidance; session metadata is never anonymous audit data. |
| `account_removal_pin_challenges`: verified email, HMAC digest, nonce, attempts, expiry | None | Short-lived self-service proof | Expire/consume and cascade-delete with the account; raw PIN is never stored | No | Transient authentication metadata is not participant audit data. |
| `verifications`: identifier/value | Temporary email/reset state | Temporary auth state | Delete by email/ID match | No | No user FK; identifier is a hidden identity copy. |
| `email_verification_tokens`: token, email, user_id, groups | Claim/confirmation | Acceptance/account claim | Delete | No | Token and email are direct credentials/identity. |
| `push_tokens`: token, platform, user_id | Device delivery | Push delivery | Delete during preparation for finalizable paths; delete at pending-exit finalization | No | Delivery credential/device identifier; no new participant notifications are permitted after pending begins. |
| `notification_preferences`: category/channel/enabled | Personal preference | Service preference | Delete | No | Not required for audit. |
| `notification_outbox`: payload, recipient FK, status/errors | Pending welcome/service message | Operational delivery | Delete subject rows; active filters prevent new rows | No | Payload may contain identifying notification data. |
| `announcement_reads` / `announcement_recipients`: user FK, timestamps | Personal delivery/read state | Personal delivery/read state | Delete | No | Not an audit requirement. |
| `tickets`: user FK, token | Unused ticket | QR/ticket credential | Delete; permanent unlinked non-reuse ticket tombstone | No | Credential must not regain access or resolve to a replacement account. |
| `wallet_passes`: user FK, serial/auth token/provider object ID | Wallet credential | Venue ticket/pass | Void/delete during finalization; pending-exit may retain the row transiently for recovery/void processing | No | Apple/Google copies are external residuals and the credential is not anonymous audit data. |
| `wallet_pass_devices`: device library identifier/push token | Wallet device registration | Wallet updates | Delete with pass | No | Device/pass delivery identifiers. |
| `wallet_access_tokens`: scoped wallet token | Acceptance/wallet retrieval | Wallet retrieval | Delete | No | Temporary credential. |
| `applications`: template, labels, intake configuration | Shared form definition | Shared form definition | Survive | No | No subject row; the mutable form is not used to decide historical retention. |
| `application_form_versions`: immutable template/retention metadata and creator | Shared form definition | Schema used by submitted responses | Survive; creator FK may be nulled | No | The response's version is the source of its retention purpose; it contains no response values. |
| `application_responses`: user FK, application-specific template answers, status, decisions, referrers | Application identity/data | Acceptance/participant logistics | Copy only fields explicitly marked `ANONYMOUS_AUDIT` in the response's immutable form version; delete the response, all other answers, dietary values and files; null subject referrers | Dynamic rows in `anonymous_participant_fields` for supplied retained values | Different applications/versions can ask different questions; labels and later edits do not change historical purpose. During `pending_exit`, the identifiable response remains transiently available for cancellation/exit and is destroyed at finalization. |
| `anonymous_participants`: random UUID, guaranteed minutes, created timestamp | None | None until finalization | Created only for an accredited anonymization; no user FK or mapping | Random anonymous subject + system-generated verified minutes | Stable anonymous grouping without an identity bridge. |
| `anonymous_participant_fields`: anonymous subject, form/application context, field key, open dimension, field kind, typed value | None | None until finalization | Survives only for explicitly retained, sanitized answers; no user/response FK | Dynamic retained application values; missing answers create no row | Normalized/queryable schema avoids fixed demographic columns and supports future dimensions. |
| `users.is_test_account`, `anonymous_participants.is_test_account`: synthetic marker | QA marker | Isolated review fixture marker | Purge with the fixture; never convert a marker into a real participant attribute | No | The marker scopes synthetic data and keeps it out of ordinary operations, statistics and the permanent audit dataset. |
| `review_fixture_accounts`: fixture key, replaceable user FK, generation, last successful sign-in | QA registry | Admin fixture provisioning/usage signal | Null or replace the user pointer during purge/regeneration; retain only the bounded registry metadata needed to operate fixtures | No | This is deployment/QA control data, not a participant or audit record; it contains no password, PIN, response, IP or user-agent history. |
| `review_fixture_queues`: fixture key and synthetic enterprise/sponsor/challenge/repo/queue pointers | None | Participant-facing synthetic judging queue | Purge the marked queue/project graph before fixture regeneration or closure | No | Synthetic judging state exists only to exercise the participant flow and must not affect ordinary queues, statistics or audit counts. |
| `applicant_reviews`: response/author, score, notes | Review workflow | Selection workflow | Delete subject response reviews and subject-authored reviews | No | Identity/free text; not audit requirement. |
| Application upload objects: `responses` file keys, `uploads/<app>/<user>/...` | Personal file | Review/operations | Delete exact keys/prefixes | No | Personal files and identifying object paths. |
| `data_subject_requests`: subject/requester, reason, key, error | DSR workflow | Export/delete workflow | Null subject/requester and clear reason/key/error; delete objects/prefix | No | Request metadata can identify the person. |
| `user_email_history`: user FK, historical/current email | Transient cleanup aid | Profile email changes | Delete by `users` cascade before identity finalization; never copy to anonymous subject | No | Finds old denormalized email copies without becoming a permanent identity bridge. |
| `check_in_logs`: user/staff/badge/notes/time/method | Empty | Accreditation record | Calculate any required aggregate, then delete subject rows | None; represented by aggregate verified minutes | Physical participation evidence without retaining raw identifiers/timestamps. |
| `time_logs`: user/scanned_by/kind/time/notes | Empty | Door presence and corrections | Calculate guaranteed minutes, then delete subject rows | `guaranteed_presence_minutes` only | Verify guaranteed venue time; the validated database constraint permits only `in`/`out`. |
| `activity_logs`: user/logged_by/activity/time/device/scan ID/notes | Empty | Activity/meal/presence confirmation | Delete subject rows; detach subject actor | Only derived minutes | Raw activity can contain device/scan identity and is not needed long-term. |
| `activities` / `schedule`: names, categories, times, locations | Shared config | Event service definition | Survive | No | Shared operational catalog. |
| `meal_scan_batches`: activity/device/submitter/status | Empty | Meal ingestion metadata | Null subject submitter; terminal counts/status only | No | Device/submitter history is operational, not permanent audit. |
| `meal_scan_batch_items`: badge, client ID, result/error/times | Empty | Offline meal retry | Clear/delete badge and identity-bearing result/error; keep only terminal operational count/status | No | Badge is transient credential; dietary data excluded. |
| `audit_log`: actor, entity ID/type, JSON before/after, reason, IP/UA | May contain setup actions | Staff/action history | Delete rows that can identify subject; detach unrelated actor; suppress final IP/UA | Anonymous completion event only | Audit accountability cannot justify an identity bridge. |
| `idempotency_keys`: scope, request hash, response body | Request replay | Critical mutation replay | Delete identity-bearing rows; move current self key to identity-free completion scope | Boolean completion only, bounded by normal idempotency retention | Prevent replay from keeping user identity. |
| `permission_group_members`: user/assigned_by | Access grant | Staff/role access | Delete subject membership; null subject assigner on unrelated grants | No | Capability access is not audit data. |
| `manual_attendee_roles`: user/assigned_by/role | Optional classification | Participant/mentor access | Delete subject role; detach subject assigner | No | Derived access relationship. |
| `enterprise_judges`: user/added_by | Staff/judge roster | Judging operation | Delete subject roster; detach subject adder | No | Identity-dependent judging role. |
| `sponsors`: user FK/enterprise | Sponsor contact | Sponsor operation | Delete subject row unless needed anchor, then null user FK | No | Preserve organization challenge anchor only. |
| `enterprises`: director ID/name/config | Shared organization | Sponsor operations | Null subject director | No | Organization survives; person link does not. |
| `food_intolerances`: label/proposer | Shared catalog | Food option catalog | Null subject proposer | No | Labels survive; authorship does not. |
| `universities`: name/proposer | Shared catalog | Demographic lookup | Null subject proposer | University text copied to anonymous subject if required | Catalog is not a person record. |
| `schedule_owners`: user/assigner/free-text name | Staff ownership | Operations | Delete subject-owned row; null subject assigner; never copy real name to free text | No | Avoid hidden name snapshot. |
| `announcements`: author/payload | Staff content | Notifications | Null subject author; inspect payload/provider logs operationally | No | Personal authorship/payload is not audit data. |
| `enterprise_invite_link_redemptions`: user/email/name | Invite history | Access provisioning | Delete by FK and normalized email | No | Denormalized invitee identity. |
| `user_invite_link_redemptions`: user/email/name | Invite history | Access provisioning | Delete by FK and normalized email | No | Denormalized invitee identity. |
| `enterprise_invite_links` / `user_invite_links`: creator/token | Shared invite config | Provisioning | Null subject creator; expire/revoke shared token as normal | No | Shared link survives; subject authorship does not. |
| `devpost_participants`: repo/email/name/surname/username/user/linker | Imported project identity | Project reconciliation | Delete subject match by FK/email; shared repo may survive | No | External project snapshot is identity-bearing. |
| `repos`: creator/name/description/URLs | Project/team | Judging/project service | Null creator; delete solo orphan; preserve shared repo for remaining members | No | Shared project is not anonymous demographic audit. |
| `submissions`: repo/user/inviter/external ID | Team/project relation | Judging | Delete subject membership; null subject inviter | No | No individual submission relationship needed. |
| `repo_devpost_prizes` / `devpost_prizes`: project/prize | Shared project result | Judging/result | Survive for surviving shared repo; delete with solo orphan | No | No direct identity after member link removal. |
| `challenges`: sponsor author anchor | Shared challenge | Judging | Survive; sponsor user link is severed | No | Organization-owned challenge needs FK anchor. |
| `challenge_versions`: editor/snapshot | Content history | Challenge operations | Null subject editor; inspect free-text snapshots | No | Subject authorship not audit requirement. |
| `challenge_winners`: setter/repo | Judging result | Judging | Null subject setter; shared result may survive | No | Result is shared, actor identity is not required. |
| `queue_entries`: repo/challenge/room/status/times | No row or team row | Judging queue | Delete with solo orphan; shared entry survives without subject member | No | Queue state is team/project operational data. |
| `queue_history`: actor/status/reason/metadata | No row or team row | Judging operations | Null subject actor; inspect metadata | No | Actor identity not permanent audit requirement. |
| `attempt_review` / `attempt_review_versions`: scores/notes/author | No row or team row | Judging evaluation | Delete with solo orphan; null subject reviewer; free text requires review | No | Shared judging result may survive, identity link does not. |
| `judging_session`: judge/queue/room/times | No row | Judging operation | Null/delete subject judge relationship; shared session may survive | No | Judge identity not participant audit field. |
| `queue_groups` / `queue_group_challenges`: creator/enterprise/challenges | Shared config | Judging | Null subject creator | No | Shared queue configuration. |
| `rooms`, `room_*`, `queue_settings`: assignments/actors/config | Shared config | Venue/judging | Null subject assigner; shared config survives | No | No subject audit fields. |
| `scanner_revoked_badges` / `_tickets`: keyed credential digest | Empty | Offline safety | Survives as an unlinked global keyed-digest security denylist entry | No | This is security metadata, not participant audit data or a mapping. Normal badge rotation may reuse an old physical badge after the assignment boundary; credentials retired with an account remain permanently tombstoned so late offline scans cannot resolve to a replacement participant (F07/A30). |
| `wallet/provider payloads`, provider logs | External credential | Wallet/notification | Provider-specific revocation/expiry | No | Outside Postgres; operations confirmation required. |
| Browser/native/offline queues | Empty | Offline logistics | Encrypt and owner-scope web/native queues; wipe on closure; stale items reject/delete; unreachable devices retain until reconnect/device retirement | No | Device copies need an operational control; ciphertext at rest is not a remote wipe. |
| Reverse-proxy/app logs, analytics, error logs, DB backups/WAL, S3 versions | Infrastructure | All operations | Repository has no purge implementation; apply retention/purge policy | No | Not silently claimed deleted. |

## 15. Tests and validation matrix

Implemented or updated in this branch:

| Scenario | Coverage |
| --- | --- |
| Deletion before check-in | `apps/api/test/identity/profile.test.ts`: accepted/unaccepted/confirmed-but-unaccredited cases. |
| Verified-email security PIN | API profile tests cover PIN delivery, HMAC-only challenge storage, wrong/expired/correct PIN behavior, and unverified-account password reauthentication; web/mobile transport and mobile credential-modal tests cover the client flow. |
| Deletion immediately before concurrent check-in | User-row lock plus the final `0730` active-FK guard; add a production-load concurrency fixture before rollout. |
| Anonymization after check-in | Admin and self-service profile tests. |
| Anonymization while inside venue | Self-service request returns `202 pending_exit`, revokes access, permits a current staff `out` or exact event-end system `out`, and finalizes after a valid exit or expired H24 certainty window. |
| Anonymization after exit | Self-service test verifies two logs are used to calculate and then delete while 60 verified minutes survive. |
| Repeated anonymization | Self-service idempotency replay test; pending action cannot change. |
| API/storage failure halfway through | Retry/error handling is covered by the service contract; provider-failure integration fixture remains a release-gate test. |
| Sessions, refresh credentials and push tokens | Self-service test inserts/deletes `accounts`, `sessions`, `tickets` and `push_tokens`; wallet rows are covered by deletion tests. |
| Stale offline staff cache / sync after anonymization | Native scanner sync tests and web stale badge rejection path; device-never-reconnects is an operational test. |
| Meal and dietary data | Meal inbox minimization tests; dietary fields are excluded from anonymous row. |
| Judging and team relationships | Project/queue cleanup tests and shared sponsor-anchor regression. |
| Synthetic fixture read/write isolation | `apps/api/test/identity/review-fixtures.test.ts`, `apps/api/test/applications/files-export.test.ts` and `apps/api/test/exports/bundle-leakage.test.ts` cover ordinary-admin visibility, response/DSR target isolation, synthetic global-export exclusion, and refusal to build a personal export bundle. |
| Venue presence calculations | `apps/api/test/logistics/estimate.test.ts` and presence tests cover secured, duplicate, expired and inconsistent paths; the strict `0730` schema constraint rejects invalid kinds before calculation. |
| Anonymous record generation | Profile tests assert random UUID differs from original ID and verified minutes survive without raw subject rows. |
| Inability to recover identity | Profile regression inserts an email-bearing audit `entity_id`, verifies it is removed, and searches anonymous JSON for original email/name/ID. |
| ECTS/participation-document request after anonymization | No ECTS/certificate endpoint or identity bridge exists in the repository; release test must assert any future named-proof endpoint returns no subject after anonymization. |

The remaining release-gate fixtures are provider/object-storage fault
injection, concurrent transaction scheduling, offline device retirement and
infrastructure log/backup purge. They cannot be proved by the current unit
suite alone.

## 16. Concrete code and documentation inventory

### Backend and schema

- `apps/api/src/modules/identity/removal.ts`: eligibility, pending state,
  external cleanup, demographic extraction, presence aggregation, relation
  scrubbing, anonymous UUID creation, retry worker.
- `apps/api/src/modules/identity/routes/profile.ts`: `/me` and admin
  eligibility/removal routes, schemas, auth/idempotency prehandlers.
- `apps/api/src/lib/capabilities.ts`, `idempotency.ts`, `storage.ts`,
  `audit.ts`: active-account authorization, replay, object deletion and audit
  behavior.
- `apps/api/src/modules/logistics/{presence.ts,estimate.ts,presence-closer.ts,scanner-sync.ts,offline-meals.ts,accreditation.ts,activities.ts,wallet*.ts}`:
  presence correctness, active filters, event-end serialization, offline
  revocation and wallet/meal handling.
- `apps/api/src/modules/{applications,exports,notifications,projects,queue,sponsors}/`:
  active readers/writers, upload/DSR cleanup, notification dispatch and
  project/team relation cleanup.
- `apps/api/src/modules/identity/routes/review-fixtures.ts`,
  `review-fixture-queues.ts`, and `review-fixture-usage.ts`: admin-only
  synthetic account regeneration, queue-graph cleanup, marked-subject
  isolation and non-sensitive successful-sign-in telemetry.
- `apps/api/db/migrations/0730_account_deletion_anonymization.sql`: the
  squashed, dependency-safe fresh H54 schema described above.

### Clients and copy

- `apps/mobile/components/account-screen.tsx`,
  `apps/mobile/components/account-removal-pin-modal.tsx`, and
  `apps/mobile/lib/{self-service.ts,scanner-db.native.ts,scanner-db.web.ts,scanner-sync.ts,storage-usage.ts}`.
- `apps/web/src/app/(app)/settings/profile/danger-zone.tsx`, admin
  `users/[id]/profile-header.tsx`, `lib/privacy-removal.ts`, and logistics
  offline scanner components.
- `packages/shared/locales/{en,es,gl}/{mobile,web}.json` plus legal copy in
  `apps/web/src/components/legal/{privacy-copy,terms-copy}.ts`.
- `apps/web/src/app/(app)/users/review-fixtures-dialog.tsx`: admin-only
  generation and safe usage-status control; operating instructions are in
  `docs/reviewer-fixtures.md`.
- `docs/{modules-1-5,mobile,mobile-release,background-workers,api-reference,README}.md`.

## Assumptions ledger

These assumptions are intentionally recorded for PR review; none should be
silently converted into a legal conclusion.

| ID | Assumption | Confirmation/owner |
| --- | --- | --- |
| A01 | `check_in_logs` is the canonical physical accreditation boundary. Badge/history, door, and activity references without accreditation are integrity signals that require safe reconciliation, but do not by themselves create a permanent anonymous-audit case. | Product + event-operations owner |
| A02 | A participant may request anonymization regardless of current venue-presence state. If the participant is currently recorded as inside the venue, the request transitions to a pending-exit state because identity must remain temporarily available to safely complete participation termination and record venue exit. A valid exit completes irreversible anonymization. | Product + event-operations owner |
| A03 | `event_config.event_starts_at/event_ends_at` define the live-event warning window; missing dates mean no live warning, not permission to bypass the boundary. | Product owner |
| A04 | Guaranteed/verified venue time is system-generated retained audit data. Application audit values vary by application and form version; only fields explicitly configured as `ANONYMOUS_AUDIT` survive, and missing answers remain missing. The current HackUDC configuration starts with age, gender, university, degree, graduation year, and origin city. | Grant/audit owner |
| A05 | The existing H24 certainty-window algorithm is the approved definition of guaranteed/verified presence, including activity signals and minute flooring. | Event/audit owner |
| A06 | The approved permanent presence evidence is aggregate guaranteed minutes; raw check-in/time timestamps, kinds, methods, notes, and actor metadata are not retained after anonymization. | Audit/data-minimization owner |
| A07 | Rare combinations of demographics can be identifying. Reporting is expected to apply small-cell suppression/aggregation; the reporting layer is outside this implementation and must not publish raw unusual combinations. | Privacy/product owner |
| A08 | Shared public GitHub/Devpost content and other external sites linked from a form or project are outside the hackOS anonymous audit dataset. The app removes its direct participant link where it controls one but does not rewrite third-party content; those sites have their own policies and are independent of, and not affiliated with, GPUL. | Product/privacy owner |
| A09 | Production S3 versioning, reverse-proxy logs, analytics, error telemetry, PostgreSQL backups/WAL and provider logs have separate retention/purge controls. | Operations/security owner |
| A10 | The web `hackos*`/`queue-ops-*` namespace is the complete app-owned browser storage namespace; future features must register additional keys with `clearWebAccountData()`. | Web owner |
| A11 | Native offline scanner data must survive an ordinary staff account switch for operational continuity: shared roster data is wiped on sign-out, while each owner's encrypted pending queue remains recoverable only by that owner; closure wipes the affected owner's queue. The pre-H54 ownerless combined database is not safely migratable and is discarded rather than assigned to the first account. | Mobile/logistics owner |
| A12 | Wallet-provider invalidation and pass expiry are best-effort external controls; installed device copies are not synchronously deletable by this repository. | Mobile/release + operations owner |
| A13 | Self-service removal requires the current authenticated session. A verified primary email additionally requires a short-lived one-time security PIN sent through the in-app flow. A real account that cannot receive that email code must re-enter its current credential password; this password is verified only in the request transaction and is never persisted or queued. Synthetic fixtures may use the configured fixture PIN. Recent re-authentication beyond these checks is optional hardening, not asserted as present. | Security/product owner |
| A14 | Supported clients send a non-empty `Idempotency-Key`, and self-service destructive routes reject requests without one. There is no production database or supported legacy client to justify a weaker no-key path. | API/client owners |
| A15 | Anonymous application-data retention is schema-driven and version-aware. Authorized form administrators explicitly configure `retention_mode = ANONYMOUS_AUDIT` and an optional open semantic dimension through the Form Builder Advanced settings. Unmarked fields default to `NONE`; labels and translations do not control retention. | Applications/data owner |
| A16 | Meal/activity/judging/project records are operational or shared content, not permanent personal audit requirements, unless the table's row is explicitly listed above. | Domain owners |
| A17 | “Irreversible” means no identity mapping in the hackOS database after the transaction; it does not overclaim deletion from external systems or prevent statistical inference. | Privacy/security owner |
| A18 | No production database is in scope for this branch; H54 migrations are validated from a fresh schema. After first deployment, preserve applied checksums and use a new corrective migration for later changes. | Release/DB owner |
| A19 | No current ECTS, certificate or named participation-proof endpoint exists in this repository; any future implementation must not use a hidden anonymous-to-user map. | Product/academic-services owner |
| A20 | App Review can access a seeded accepted participant/staff account and reach Settings → Account & Data without external registration. | iOS release owner |
| A21 | The anonymizer uses the retention configuration attached to the submitted application/form version, not the later mutable form. New audit dimensions and custom retained fields work without anonymization-service code changes. A `NONE` → `ANONYMOUS_AUDIT` edit is not retroactive; any retroactive expansion requires a separate explicit product/privacy decision. | Applications + grant/audit owners |
| A22 | `hackos-scanner.db` was exclusively owned by the pre-H54 scanner implementation, no production device/database is in scope for this branch, and any pre-upgrade offline scan is intentionally discarded rather than migrated or replayed; staff can re-record it after the local migration. | Mobile/logistics + release owners |
| A23 | An `ANONYMOUS_AUDIT` → `NONE` edit affects future submissions/form versions only. Existing anonymous field rows remain until a separately approved minimization migration defines whether and how they should be removed. | Product/privacy + grant/audit owners |
| A24 | Form administrators may explicitly mark arbitrary fields, including potentially sensitive ones; the builder warning is the current safeguard. A future product/privacy policy may add prohibited categories or small-cohort publication controls without changing the anonymous subject identity model. | Product/privacy + applications owners |
| A25 | A pending-exit removal may complete after a valid current staff exit, the exact system-generated event-closing `out` at `event_config.event_ends_at`, or expiry of the latest H24 certainty window that invalidates the last provisional presence sum. Missing event dates remove only the live warning; they do not bypass the lifecycle boundary. | Event-operations owner |
| A26 | The fresh `0730` baseline snapshots each application's current form configuration as version 1. The repository cannot reconstruct edits from before versioning existed; any initial retention choices are explicit migration input and must be reviewed with the data owner. | Applications + data owner |
| A27 | A pending-exit request ends new participation but retains the existing profile, authentication, wallet and dietary artifacts only for the reversible recovery/exit window. This temporary retention lets staff complete already-started operational work safely; dietary data is cleared at irreversible finalization and is never copied to anonymous audit data. | Event-operations + privacy owner |
| A28 | The restart marker is best-effort, device-local, and contains only the action and `pending_exit`/`processing`/`device_cleanup_pending` status. It is not an account lookup or a guarantee that an offline device has received a remote wipe. | Mobile/web + release owners |
| A29 | Admin removal idempotency rows are deleted with the target during finalization. An admin retry after finalization receives the normal not-found result rather than a replayable completion response; this avoids retaining a target-bearing audit/replay record. | Security + operations owner |
| A30 | Badge and ticket credentials permanently retired with an account are recorded in an unlinked global denylist whose central values are stable HMAC digests, not raw credentials; these rows are security metadata, not anonymous audit data. Ordinary physical badge rotation may reuse the old badge for another participant because each current assignment has a server-side timestamp boundary; offline events before that replacement are rejected. Permanently retired credentials remain non-reusable so late offline scans cannot resolve to a replacement participant. | Security + privacy + operations owners |
| A31 | Only non-draft responses with a non-null, same-application form-version pointer are eligible for anonymous application retention. An unversioned response is excluded and the normal response lifecycle fails closed rather than evaluating it against the later mutable form; any recovery requires an explicit data decision. | Applications/data owner |
| A32 | The API distinguishes an accepted, cancellable `pending_exit` request from `processing`. `pending_exit` lasts until a valid current staff exit, exact event-end system `out`, or fixed recovery-deadline expiry wins; only then may irreversible finalization report completion. | Privacy + operations owners |
| A33 | A verified-primary-email self-service request must enter the six-digit PIN delivered to that email. The PIN is one-time, short-lived, attempt-limited, stored only as an HMAC digest/nonce. If a real account has no usable email code because its primary email is unverified, the request must re-enter the current credential password instead; synthetic fixtures remain eligible for the fixture-only PIN path. | Security/product owner |
| A34 | Guaranteed/verified venue time is system-generated from accrued `time_logs` and `activity_logs`; application retention is independently selected by each submitted form version. A missing retained application answer stays missing and is never inferred. | Grant/audit + applications owners |
| A35 | The participant cannot self-record the exit from the recovery screen. The recovery copy instructs them to ask staff to show/scan their badge; the backend accepts only the validated staff door `out`, the exact system-generated event-end `out`, or an expired H24 certainty window as a completion signal. | Event-operations + security owners |
| A36 | The pending-exit recovery deadline is captured once from the initiating authenticated session when available, or a bounded fallback for an admin/no-session initiation. Signing in again does not extend it; expiry lets the worker finalize even if a raw door session remains open, because the latest accrued presence window no longer proves current presence. | Security + event-operations owners |
| A37 | During pending exit, ordinary participant, meal, judging, badge and notification writes are blocked. Only authenticated recovery/status/cancel and the operational exit path may use the transient identity; offline synchronization must be rejected or tombstoned after finalization. | Operations + mobile/security owners |
| A38 | GPUL is the responsible organisation/data controller for the GPUL-operated hackOS instance; “HackUDC” names the event, not the operator. The participant-facing Privacy Policy and Terms therefore identify GPUL and link to event policies published by GPUL. | GPUL/privacy owner |
| A39 | Synthetic reviewer accounts, their marked projects/challenges/queues and synthetic anonymous rows are isolated QA fixtures within the same deployed API and primary database. The API uses persisted marker/pointer predicates to exclude them from ordinary admin/staff reads, day-to-day scanner rosters, statistics, exports, grant/audit data and the permanent anonymous dataset; a separate fixture database is not part of this change. | Release + operations owners |
| A40 | The current fixture generation contains four scenarios: full deletion before accreditation, anonymization outside the venue, anonymization pending exit inside the venue, and a synthetic exit-capable operator. The outside fixture owns the participant-facing judging queue; future scenarios must create and clean up their own marked graph. | Release + product owners |
| A41 | A synthetic operator has ordinary capability checks plus a marked-subject boundary and may act only on synthetic accounts. Real administrators and staff cannot discover or mutate those subjects by changing an ID in a normal endpoint. | Security + operations owners |
| A42 | The configured static deletion PIN is accepted only for marked synthetic accounts. Verified real accounts require an emailed one-time PIN; no universal real-user bypass is implemented. | Security/product owner |
| A43 | The admin fixture status signal records only the current generation, synthetic email and last successful sign-in time. It is not proof of scenario completion and does not retain secrets, failed-attempt details, IPs, user agents or participant answers. | Security + release owners |
| A44 | No production database is in scope for this branch. Migrations are validated from a fresh schema; applied migration checksums remain immutable after first deployment and later corrections use a new migration. During development, a fresh flat schema may be rebuilt rather than preserving harmful legacy adaptations. | Release/DB owner |
| A45 | The current credential-retirement denylist stores stable keyed HMAC digests, not raw badge/ticket values and has no expiry path. It prevents late offline credential replay, while ordinary physical badge reuse is governed by the server-side assignment timestamp fence. | Security + event-operations owners |
| A46 | Legal copy may describe synthetic accounts as authorised testing/quality-assurance fixtures, but it must not name a specific review channel. The detailed fixture procedure belongs in the private/operational runbook. | GPUL/privacy + release owners |
| A47 | The schema is authoritative for presence-event shape: only `time_logs.kind IN ('in', 'out')` is valid. The final `0730` migration installs the strict check on the fresh schema; no reader-side exception or legacy repair path is retained for this branch. | Event-operations + release/DB owners |
| A48 | The server-side `users.badge_assigned_at` timestamp is the authoritative boundary for offline badge-event replay. Presence, activity and meal paths reject timestamps before the current assignment both at enqueue/lookup and under the locked owner row; the timestamp is not exposed to clients. | Logistics + security owners |
| A49 | The fresh-schema final state is authoritative. Runtime paths do not preserve malformed presence kinds, expired scanner tombstones, or mutable-form fallbacks for historical responses. The H54 development chain is represented by one `0730` baseline; any populated upgrade needs a separately reviewed migration. | Release/DB + domain owners |

## Release recommendation

Merge only after the reviewer confirms A01–A05, A09, A12, A18 and A20, and
after operations documents provider/cache/log/backup retention. The code is
safe to review now: it removes the old identity bridge, provides direct web
and mobile actions, revokes access before asynchronous cleanup, and does not
retain identity merely to preserve certificates or implementation
convenience. The remaining high risks are deliberately visible rather than
hidden behind a success response.
