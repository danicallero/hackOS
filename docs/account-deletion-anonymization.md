# H54 — account deletion and irreversible anonymization audit

**Review date:** 2026-08-26  
**Scope:** `apps/api`, `apps/mobile`, `apps/web`, Postgres migrations, object
storage references, offline scanner paths, notification workers, audit/export
paths, and the account/privacy copy.  This is a code and data-lifecycle audit,
not a legal opinion.

## Executive result

The branch implements two server-selected outcomes:

```text
active --(no operational history)--------------------> full deletion
active --(operational history)--> removal_pending ----> anonymous participant
                                      |                       |
                                      +-- sessions/accounts --+-- users row deleted
                                          revoked immediately     no mapping table
```

The mobile and web clients call `GET /api/me/removal-eligibility` and do not
infer the mode from a badge, cached profile, or client boolean.  `DELETE
/api/me` is accepted only for a fresh account.  `POST /api/me/anonymize` is
explicit and requires `{ "confirm": true }`.  Admin equivalents are
capability-gated under `/api/users/:id`.

The authoritative implementation is `getAccountRemovalEligibility()` and the
locked preflight in `apps/api/src/modules/identity/removal.ts`.  The primary
physical boundary is an accreditation row in `check_in_logs`; the implemented
conservative boundary also treats any door log, activity log, current badge,
or badge history as operational history.  Acceptance, applications, tickets,
wallet passes, permissions, and notifications alone do not force anonymous
retention.  This broader rule is an explicit product assumption (A01), not a
client decision.

After anonymization the `users` row, credentials, service relationships,
personal files, direct identifiers, and raw operational scan rows are deleted.
Before those rows are destroyed, the verified attendance total is calculated
and stored on a new `anonymous_participants.id` generated with
`crypto.randomUUID()`; no deterministic input and no mapping table is used.
The anonymous row contains only the seven intended audit attributes plus its
creation timestamp.  The guarantee is scoped precisely: the retained record
has no identity mapping in the hackOS Postgres database.  Provider copies,
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

The old implementation on `origin/main` (`anonymizeUser()` in
`apps/api/src/modules/identity/anonymize.ts`) changed a user in place to an
`anonymized+<id>@deleted.invalid` row.  That left the original numeric row and
all its foreign-key relationships available as an identity-shaped audit
subject.  This branch keeps `anonymize.ts` only as a compatibility export and
moves the implementation to `removal.ts`.

### Removal request

1. The authenticated client reads the server preflight.
2. `prepareAccountRemoval()` locks the permission graph and target user,
   re-evaluates the boundary, rejects a live open venue session, and commits
   `account_state = 'removal_pending'` with the selected action.
3. Sessions, Better Auth accounts, and push tokens are removed in that
   transaction. Wallet rows are marked voided while external invalidation is
   attempted.
4. S3/MinIO uploads, DSR exports, and provider wallet artifacts are cleaned
   outside the database transaction. A failure returns `503
   removal_storage_pending`, keeps the account inaccessible, and queues a
   bounded retry.
5. `finalizeAccountRemoval()` takes a new transaction, computes the verified
   attendance total before destroying activity rows, creates the random
   anonymous subject where required, scrubs relationships, and deletes the
   `users` row. The final operation is idempotent through the pending state and
   self-service completion idempotency record.

### Client flows

- Web: `apps/web/src/app/(app)/settings/profile/danger-zone.tsx` renders the
  server-selected “Delete account” or “Anonymize my data and close account”
  action, shows retained fields and event/proof consequences, confirms with an
  accessible modal, sends `Idempotency-Key`, clears app-owned browser storage,
  signs out, and redirects even when the response is ambiguous after the
  server has revoked access.
- Mobile: `apps/mobile/components/account-screen.tsx` performs the same
  preflight, warning and confirmation flow, sends the authenticated API
  request, clears native app data and scanner cache, signs out, and explains
  that a storage/network error may still have completed server-side.
- Email is a secondary support/privacy link only. It is not the mechanism that
  starts deletion or anonymization.

## 2. Data-flow map

```text
external registration / acceptance
              |
              v
users <---- accounts, sessions, tokens, push, wallet, ticket
  |
  +--> application_responses --> uploaded objects / DSR exports
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
| F03 | High | confirmed code problem; operational risk | Removal must race check-in, presence, notification, wallet and invite writes. The pending state, user-row locks, active-state filters, and migration `0733` FK triggers reject new direct user references after pending begins. The event-end closer was additionally changed to lock and re-check each candidate so one removal cannot abort the whole worker tick. |
| F04 | High | requires legal/product confirmation; operational risk | There is no single `checked_in` column. The code uses check-in as the primary physical boundary but conservatively includes door/activity/badge history. Confirm whether badge assignment or a non-presence activity alone should force anonymization. |
| F05 | High | confirmed code problem; operational risk | Object deletion and final DB deletion are separate phases. A storage or final-transaction failure leaves access revoked and `removal_pending`, with bounded retry. Operators must monitor and replay pending rows if the queue is unavailable. |
| F06 | High | confirmed code problem; privacy/security risk | Staff offline meal queues contain badge credentials and must be encrypted, owner-bound, cleared on closure, and rejected when stale. Native scanner records are encrypted and tombstoned; an offline staff device can still retain encrypted data until reconnect/expiry. |
| F07 | High | operational risk; requires legal/product confirmation | Installed Apple/Google Wallet passes and copies already delivered to a device are outside the database. The server voids rows, sends provider invalidation/update signals where configured, and revokes scanner credentials for a short window; provider/device expiry and delivery must be verified operationally. |
| F08 | High | privacy/security risk; requires legal/product confirmation | Application logs, web-server logs, analytics, database backups, object-store versioning, and provider logs are not retention systems represented in this repository. Production operations must confirm their subject lookup, retention and purge controls before claiming system-wide erasure. |
| F09 | High | confirmed code problem; optional hardening | The destructive routes require a current authenticated session, but no recent-reauthentication step exists. Add a recent-auth challenge if the deployment threat model requires protection against an unattended unlocked session. |
| F10 | Medium | confirmed code problem; privacy/security risk | Demographic extraction is heuristic over application-template labels. Unknown or newly translated labels become null rather than being guessed. Product should map the seven canonical fields to stable field keys before relying on the values for grants. |
| F11 | Medium | privacy/security risk; requires legal/product confirmation | Age, gender, university, degree, graduation year and origin city can identify a person in a rare cohort. Do not publish small-cell combinations; confirm disclosure/aggregation rules with the data owner. |
| F12 | Medium | confirmed code problem; privacy/security risk | The first H54 implementation retained raw check-in/door rows under the anonymous UUID, exceeding the approved seven-field dataset. Corrective migration `0734` deletes converted raw rows and removes the anonymous FK columns; finalization retains only the calculated guaranteed minutes. |
| F13 | Medium | operational risk | A no-key destructive request remains backward-compatible but has no durable replay handle if its HTTP response is lost. Current mobile/web clients always send a high-entropy key; make the header mandatory once all supported clients are upgraded. |
| F14 | Medium | confirmed code problem; operational risk | Offline stale submissions can reach the server after anonymization. Revoked badge/ticket tombstones and active lookups reject them, and clients remove terminal stale queue items. Devices that never reconnect cannot be remotely wiped; set an operational expiry and document the residual window. |
| F15 | Medium | privacy/security risk; requires legal/product confirmation | Shared public repositories, Devpost content and external documents can contain a person's identity independently of hackOS rows. The service removes the subject's personal submission/member link and deletes solo projects, but preserves a shared project for remaining members. Confirm the external-content policy. |
| F16 | Low | confirmed code problem; optional hardening | `time_logs_kind_check` is `NOT VALID` so malformed legacy rows remain reviewable; all new/edited rows are constrained and calculators ignore malformed kinds. Schedule a one-time legacy repair or explicitly accept the zero-credit behavior. |
| F17 | Medium | App Store review risk; confirmed code improvement | The prior mobile flow did not expose a direct, truthful account action. The current Account/Data control is visible in-app, mode-specific, authenticated, and explains irreversible retention and consequences. Reviewer access instructions must provide an accepted test account that can reach it. |
| F18 | Medium | App Store review risk; requires legal/product confirmation | “Delete” is reserved for full deletion; “anonymize” names the irreversible alternative. Privacy policy and App Store privacy disclosures must match actual operational retention and external-cache limitations. |
| F19 | Low | optional hardening | The branch has focused regression tests and a documented matrix, but provider deletion, lost-response, offline-device, backup and rare-cohort tests require deployment fixtures outside this repository. |

## 4. Authoritative deletion boundary

`getAccountRemovalEligibility()` is authoritative and is called again under a
`SELECT ... FOR UPDATE` lock before pending is committed. It currently returns:

| Condition | Result |
| --- | --- |
| No `check_in_logs`, `time_logs`, or `activity_logs`; no current badge; empty badge history | Full deletion (`DELETE /api/me`) |
| Any of those operational references exists | Irreversible anonymization (`POST /api/me/anonymize`) |
| The selected anonymization action has a latest valid `time_logs.kind = 'in'` at the current DB time | 409 `participant_inside`; staff must record an exit first |
| A ticket, wallet pass, acceptance, application, permission, notification or preference exists without operational history | Still full deletion eligible |

This is intentionally a backend fact, not a client-side `hasCheckedIn` flag.
`check_in_logs` is the best domain boundary for physical accreditation, while
the union prevents accidental full deletion of legacy/manual accounts whose
actual operational record was written elsewhere. A product decision may narrow
the rule, but it must change the server function and tests together.

## 5. Anonymous-account design

`anonymous_participants` has these permanent fields:

```text
id (random UUID), age, gender, university, degree, graduation_year,
origin_city, guaranteed_presence_minutes, created_at
```

The UUID is generated only at finalization with `randomUUID()` and is not
derived from the user ID, email, name, DNI, badge or a hash of any of them.
There is no bridge table, mapping column, reversible encryption key, or
idempotency response containing the original identity. The original `users.id`
is deleted. Raw check-in and time logs are used to calculate the aggregate,
then deleted; the schema has no anonymous foreign key for retaining them. A
final anonymous audit event contains the retained-field list but suppresses
request IP, user agent, and request-supplied reason text.

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

An anonymization request while the participant is inside is rejected until an
exit is recorded. Once finalization starts, the user row and dietary fields are
deleted, so food service and other identity-dependent event operations can no
longer continue for that person. Both clients state this before confirmation.
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
secures it. Expired provisional intervals, malformed kinds, and conflicts
receive zero credit. The total is floored to complete minutes and stored in
`anonymous_participants.guaranteed_presence_minutes` before raw activity rows
are deleted.

Edge behavior:

| Case | Behavior |
| --- | --- |
| Missing door-out | Provisional interval expires and contributes zero unless an in-window activity secured it; an open current session also blocks anonymization until exit. |
| Duplicate rapid `in` | Live scanner rejects it; legacy/manual `in → in` is marked conflicting and credits zero for the affected window. |
| Manual correction | Manual rows use the same calculator; invalid ordering is visible to staff and cannot manufacture guaranteed time. |
| Accreditation before first door scan | Check-in crosses the removal boundary, but it contributes no presence minutes until an interval is secured. |
| Participant still inside | Finalization returns `participant_inside`; no anonymous row is created. |
| Event still running | Client warning includes immediate access/service/proof loss; server still requires exit and then can anonymize. |
| Event-end closer | It inserts one system `out` at `event_ends_at` for a current open session, under a user lock, and audits the action. |

Raw check-in and time history is not retained after anonymization. The
calculated guaranteed minutes on `anonymous_participants` are the permanent
presence evidence; F12 records the corrective migration that enforces this
minimization boundary.

## 8. Mobile and web UX changes

Both clients use an Account/Data danger zone and server preflight:

| State | Primary action | Required explanation |
| --- | --- | --- |
| Fresh account | “Delete account” | Permanent deletion of the account, credentials, tokens, profile, files and related non-operational data; event spot/services end. |
| Operational history | “Anonymize my data and close account” | Identity is destroyed and operational attendance remains only under a random anonymous subject with the listed seven fields. |
| Live open venue session | Action disabled/409 until exit | The participant must leave/record exit first; the app does not silently destroy a live logistics relationship. |
| Any anonymization | Confirmation warning | Access, ticket/QR/Wallet, judging/team operations and food service may stop immediately; named certificates, ECTS evidence and identity-linked participation proof cannot be issued later. |

The modal is keyboard/screen-reader reachable on web, uses native confirmation
on mobile, and has English/Spanish/Galician strings. On success or an
ambiguous network/5xx/storage response, local account data is cleared and the
session is ended; the UI tells the user that server processing may still be
retrying. A normal business conflict leaves the page in place so the user can
correct it.

## 9. Backend/API changes

| Surface | Implementation |
| --- | --- |
| Preflight | `GET /api/me/removal-eligibility`; admin `GET /api/users/:id/removal-eligibility`. |
| Full delete | Authenticated `DELETE /api/me`; admin `DELETE /api/users/:id`; both re-evaluate and reject operational history. |
| Anonymize | Authenticated `POST /api/me/anonymize` with `{confirm:true}`; admin `POST /api/users/:id/anonymize`; admin requires `ADMIN_ALL` and cannot target self. |
| Authentication | Active-user guard rejects `removal_pending`/deleted users; sessions, Better Auth accounts and push tokens are removed during preparation. |
| Authorization | `/me` avoids caller-supplied target IDs; admin routes use capability guards and self-protection. |
| Idempotency | Clients send keys; self completion is moved to an identity-free scope before deleting `users`; stale in-flight records can be reclaimed. |
| Storage | Exact subject upload path, response-derived upload prefixes, DSR export prefixes and known storage keys are deleted; S3 deletion errors are surfaced and retried. |
| External identity | Google Wallet objects are expired where configured; Apple Wallet push invalidation is attempted; unregistered passes are already gone. |
| Writers | `0733` installs active-user reference triggers for every direct FK to `users`; domain writers also use active filters and row locks. |
| Audit | Removal deletes identity-bearing subject/actor audit rows rather than preserving a hidden identity bridge. The final anonymous event has no IP/user-agent. |

## 10. Database and migration changes

- `0730_account_deletion_anonymization.sql` adds lifecycle columns, the
  anonymous table, nullable subject/actor references, legacy conversion and
  identity cleanup.
- `0731_account_removal_scanner_tombstones.sql` adds short-lived badge/ticket
  revocations for disconnected scanners.
- `0732_account_removal_meal_inbox.sql` makes meal inbox `badge_id` nullable so
  terminal results can be minimized.
- `0733_account_removal_reference_guards.sql` adds active-user FK triggers and
  a `NOT VALID` `time_logs` kind check. It is a corrective writer-safety
  migration and must remain separate from already-applied migration blobs.

Migration policy is checksum-enforced by `apps/api/scripts/migrate.ts`. There
is no production database in scope for this branch, so the H54 migrations
`0730–0734` are validated as a fresh install and the raw-presence correction is
explicitly represented by `0734`. Once any environment applies a migration,
preserve its checksum and put later corrections in a new migration rather than
rewriting that environment's applied file (A18).

## 11. Offline caches and external copies

### Native staff scanner

`apps/mobile/lib/scanner-db.native.ts` stores the roster encrypted with
AES-256-GCM and scopes queues/sync state by signed-in owner. A successful
snapshot is replace-all, revoked badge/ticket tombstones are included, and
sign-out wipes the roster. Closure wipes the local account/cache. A queue item
rejected as `not_found`, `badge_unknown`, or `badge_revoked` is deleted rather
than retained indefinitely. An offline device that never reconnects cannot
receive a tombstone; it must be covered by device management/expiry policy.

### Web staff scanner

`apps/web/src/components/logistics/offline-queue.tsx` stores pending meal
scans as AES-GCM ciphertext in browser `localStorage`, with a non-extractable
per-owner key in IndexedDB and the owner ID authenticated as additional data.
The legacy plaintext key is removed rather than migrated or replayed. Queue
loads/syncs are owner-scoped, account closure removes the envelope and key,
and stale participant rejections discard the queued credential. A browser
that stays offline cannot receive a central tombstone and there is no remote
wipe or expiry for an unreachable browser; that is an operational residual
window, not a hidden identity mapping. `clearWebAccountData()` also clears
the app-owned local/session-storage namespace during closure.

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
        |          +--> direct-FK triggers reject new identity references
        |
        +--> external cleanup (retryable)
        |
        +--> lock user; compute/migrate audit evidence; scrub; delete user
```

The following races are covered:

- check-in vs removal: the first transaction holding the user row wins; the
  other either becomes part of history before pending or receives an active
  state conflict;
- door scan vs removal: presence writers lock/filter active users and `0733`
  rejects a late FK insert;
- meal scan vs removal: active badge/ticket lookup and tombstones reject stale
  scans; terminal inbox data is minimized;
- judging/teams/notifications: readers exclude closed users; direct FK writes
  are guarded; notification dispatch locks the user before sending;
- event-end closer vs removal: candidate user rows are locked and rechecked;
- push and export jobs: active checks, request-owned export prefixes and
  finalization cleanup prevent post-closure delivery/resurrection;
- repeated request: locked pending action cannot change from delete to
  anonymize or vice versa; self completion replay is identity-free;
- partial failure: pending state prevents access restoration, storage deletion
  is idempotent, and retry jobs are bounded.

Remaining non-transactional limits are offline devices and external providers.
The web queue has an owner-bound encrypted storage path, but an offline browser
cannot receive a central tombstone until it reconnects; its expiry/closure
behavior is covered as an operational control rather than a hidden identity
mapping.

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

## 14. Required data-lifecycle analysis

“Delete” below means remove the subject's rows/values or detach the subject's
actor FK. “Anon” means retain only if explicitly stated; it never means keep a
synthetic identity-shaped `users` row.

| Data / table and participant fields | Before check-in | During event | After anonymization | Permanent anonymous audit record | Reason |
| --- | --- | --- | --- | --- | --- |
| `users`: id, email, verification, image, name, surname, DNI, secondary email, language, UI prefs, timestamps | Full account data | Active profile/service identity | Delete | No | Direct identity/auth profile. |
| `users`: badge_id, badge_id_history | Credential before use | Active badge operations | Delete; short-lived unlinked tombstone | No | Credential is not audit data. |
| `users`: food_intolerances, food_intolerance_notes, dietary_data_state, shirt_size | May be edited | Operational catering/badge data | Delete at finalization | No | Dietary data is live operational data only. |
| `users.university_id` / `universities.name` | Profile dimension | May support services/audit extraction | Copy university name, then detach/delete subject link; catalog survives | University text | Seven-field demographic requirement; catalog is shared. |
| `accounts`: provider/account IDs, access/refresh/ID tokens, password | Auth credential | Auth credential | Delete | No | Credentials and provider identifiers must not survive. |
| `sessions`: token, IP, user agent, expiry | Login session | Login/session | Delete immediately in preparation | No | Session and associated metadata are direct access data. |
| `verifications`: identifier/value | Temporary email/reset state | Temporary auth state | Delete by email/ID match | No | No user FK; identifier is a hidden identity copy. |
| `email_verification_tokens`: token, email, user_id, groups | Claim/confirmation | Acceptance/account claim | Delete | No | Token and email are direct credentials/identity. |
| `push_tokens`: token, platform, user_id | Device delivery | Push delivery | Delete in preparation | No | Delivery credential/device identifier. |
| `notification_preferences`: category/channel/enabled | Personal preference | Service preference | Delete | No | Not required for audit. |
| `notification_outbox`: payload, recipient FK, status/errors | Pending welcome/service message | Operational delivery | Delete subject rows; active filters prevent new rows | No | Payload may contain identifying notification data. |
| `announcement_reads` / `announcement_recipients`: user FK, timestamps | Personal delivery/read state | Personal delivery/read state | Delete | No | Not an audit requirement. |
| `tickets`: user FK, token | Unused ticket | QR/ticket credential | Delete; short-lived unlinked ticket tombstone | No | Credential must not regain access. |
| `wallet_passes`: user FK, serial/auth token/provider object ID | Wallet credential | Venue ticket/pass | Delete after void/provider notification | No | Apple/Google copies are external residuals. |
| `wallet_pass_devices`: device library identifier/push token | Wallet device registration | Wallet updates | Delete with pass | No | Device/pass delivery identifiers. |
| `wallet_access_tokens`: scoped wallet token | Acceptance/wallet retrieval | Wallet retrieval | Delete | No | Temporary credential. |
| `applications`: template, labels, intake configuration | Shared form definition | Shared form definition | Survive | No | No subject row; may define demographic extraction. |
| `application_responses`: user FK, answers, status, decisions, referrers | Application identity/data | Acceptance/participant logistics | Delete subject response; null subject referrers | No | Answers include free text, dietary data and identity. |
| `applicant_reviews`: response/author, score, notes | Review workflow | Selection workflow | Delete subject response reviews and subject-authored reviews | No | Identity/free text; not audit requirement. |
| Application upload objects: `responses` file keys, `uploads/<app>/<user>/...` | Personal file | Review/operations | Delete exact keys/prefixes | No | Personal files and identifying object paths. |
| `data_subject_requests`: subject/requester, reason, key, error | DSR workflow | Export/delete workflow | Null subject/requester and clear reason/key/error; delete objects/prefix | No | Request metadata can identify the person. |
| `user_email_history`: user FK, historical/current email | Transient cleanup aid | Profile email changes | Delete by `users` cascade before identity finalization; never copy to anonymous subject | No | Finds old denormalized email copies without becoming a permanent identity bridge. |
| `check_in_logs`: user/staff/badge/notes/time/method | Empty | Accreditation record | Calculate any required aggregate, then delete subject rows | None; represented by aggregate verified minutes | Physical participation evidence without retaining raw identifiers/timestamps. |
| `time_logs`: user/scanned_by/kind/time/notes | Empty | Door presence and corrections | Calculate guaranteed minutes, then delete subject rows | `guaranteed_presence_minutes` only | Verify guaranteed venue time; malformed legacy kinds ignored. |
| `activity_logs`: user/logged_by/activity/time/device/scan ID/notes | Empty | Activity/meal/presence confirmation | Delete subject rows; detach subject actor | Only derived minutes | Raw activity can contain device/scan identity and is not needed long-term. |
| `activities` / `schedule`: names, categories, times, locations | Shared config | Event service definition | Survive | No | Shared operational catalog. |
| `meal_scan_batches`: activity/device/submitter/status | Empty | Meal ingestion metadata | Null subject submitter; terminal counts/status only | No | Device/submitter history is operational, not permanent audit. |
| `meal_scan_batch_items`: badge, client ID, result/error/times | Empty | Offline meal retry | Clear/delete badge and identity-bearing result/error; keep only terminal operational count/status | No | Badge is transient credential; dietary data excluded. |
| `audit_log`: actor, entity ID/type, JSON before/after, reason, IP/UA | May contain setup actions | Staff/action history | Delete rows that can identify subject; detach unrelated actor; suppress final IP/UA | Anonymous completion event only | Audit accountability cannot justify an identity bridge. |
| `idempotency_keys`: scope, request hash, response body | Request replay | Critical mutation replay | Delete identity-bearing rows; move current self key to identity-free completion scope | Boolean completion only, short-lived | Prevent replay from keeping user identity. |
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
| `scanner_revoked_badges` / `_tickets`: revoked credential, expiry | Empty | Offline safety | Survive unlinked until expiry, then purge | No | Tombstone is intentionally not a mapping. |
| `wallet/provider payloads`, provider logs | External credential | Wallet/notification | Provider-specific revocation/expiry | No | Outside Postgres; operations confirmation required. |
| Browser/native/offline queues | Empty | Offline logistics | Encrypt and owner-scope web/native queues; wipe on closure; stale items reject/delete; unreachable devices retain until reconnect/expiry | No | Device copies need an operational control; ciphertext at rest is not a remote wipe. |
| Reverse-proxy/app logs, analytics, error logs, DB backups/WAL, S3 versions | Infrastructure | All operations | Repository has no purge implementation; apply retention/purge policy | No | Not silently claimed deleted. |

## 15. Tests and validation matrix

Implemented or updated in this branch:

| Scenario | Coverage |
| --- | --- |
| Deletion before check-in | `apps/api/test/identity/profile.test.ts`: accepted/unaccepted/confirmed-but-unaccredited cases. |
| Deletion immediately before concurrent check-in | User-row lock plus `0733` active-FK guard; add a production-load concurrency fixture before rollout. |
| Anonymization after check-in | Admin and self-service profile tests. |
| Anonymization while inside venue | Eligibility/open-session conflict path; self-service request remains active. |
| Anonymization after exit | Self-service test verifies two logs are used to calculate and then delete while 60 verified minutes survive. |
| Repeated anonymization | Self-service idempotency replay test; pending action cannot change. |
| API/storage failure halfway through | Retry/error handling is covered by the service contract; provider-failure integration fixture remains a release-gate test. |
| Sessions, refresh credentials and push tokens | Self-service test inserts/deletes `accounts`, `sessions`, `tickets` and `push_tokens`; wallet rows are covered by deletion tests. |
| Stale offline staff cache / sync after anonymization | Native scanner sync tests and web stale badge rejection path; device-never-reconnects is an operational test. |
| Meal and dietary data | Meal inbox minimization tests; dietary fields are excluded from anonymous row. |
| Judging and team relationships | Project/queue cleanup tests and shared sponsor-anchor regression. |
| Venue presence calculations | `apps/api/test/logistics/estimate.test.ts` and presence tests cover secured, duplicate, expired and malformed paths. |
| Anonymous record generation | Profile tests assert random UUID differs from original ID and verified minutes survive without raw subject rows. |
| Inability to recover identity | Profile regression inserts an email-bearing audit `entity_id`, verifies it is removed, and searches anonymous JSON for original email/name/ID. |
| ECTS/participation-document request after anonymization | No ECTS/certificate endpoint or identity bridge exists in the repository; release test must assert any future named-proof endpoint returns no subject after anonymization. |

The remaining release-gate fixtures are provider/object-storage fault
injection, concurrent transaction scheduling, offline device expiry and
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
- `apps/api/db/migrations/0730_account_deletion_anonymization.sql`, `0731`,
  `0732`, `0733`, `0734`: lifecycle, tombstones, meal minimization, FK race
  guard, raw-presence minimization, and transient email history.

### Clients and copy

- `apps/mobile/components/account-screen.tsx` and
  `apps/mobile/lib/{self-service.ts,scanner-db.native.ts,scanner-db.web.ts,scanner-sync.ts,storage-usage.ts}`.
- `apps/web/src/app/(app)/settings/profile/danger-zone.tsx`, admin
  `users/[id]/profile-header.tsx`, `lib/privacy-removal.ts`, and logistics
  offline scanner components.
- `packages/shared/locales/{en,es,gl}/{mobile,web}.json` plus legal copy in
  `apps/web/src/components/legal/{privacy-copy,terms-copy}.ts`.
- `docs/{modules-1-5,mobile,mobile-release,background-workers,api-reference,README}.md`.

## Assumptions ledger

These assumptions are intentionally recorded for PR review; none should be
silently converted into a legal conclusion.

| ID | Assumption | Confirmation/owner |
| --- | --- | --- |
| A01 | `check_in_logs` is the primary physical accreditation boundary; badge/history, door, and activity references are conservative legacy signals that also force anonymization. | Product + event-operations owner |
| A02 | Anonymization is blocked while the latest valid door event is an open `in`; staff can record the exit before finalization. | Product + event-operations owner |
| A03 | `event_config.event_starts_at/event_ends_at` define the live-event warning window; missing dates mean no live warning, not permission to bypass the boundary. | Product owner |
| A04 | The seven requested demographic fields are the complete permanent anonymous audit requirement. | Grant/audit owner |
| A05 | The existing H24 certainty-window algorithm is the approved definition of guaranteed/verified presence, including activity signals and minute flooring. | Event/audit owner |
| A06 | The approved permanent presence evidence is aggregate guaranteed minutes; raw check-in/time timestamps, kinds, methods, notes, and actor metadata are not retained after anonymization. | Audit/data-minimization owner |
| A07 | Rare combinations of demographics can be identifying; reporting will use small-cell suppression/aggregation where necessary. | Privacy/product owner |
| A08 | Shared public GitHub/Devpost content is external to the hackOS anonymous audit dataset; the app removes its direct participant link but does not rewrite third-party content. | Product/privacy owner |
| A09 | Production S3 versioning, reverse-proxy logs, analytics, error telemetry, PostgreSQL backups/WAL and provider logs have separate retention/purge controls. | Operations/security owner |
| A10 | The web `hackos*`/`queue-ops-*` namespace is the complete app-owned browser storage namespace; future features must register additional keys with `clearWebAccountData()`. | Web owner |
| A11 | Native offline scanner data must survive an ordinary staff account switch for operational continuity: shared roster data is wiped on sign-out, while each owner's encrypted pending queue remains recoverable only by that owner; closure wipes the affected owner's queue. | Mobile/logistics owner |
| A12 | Wallet-provider invalidation and pass expiry are best-effort external controls; installed device copies are not synchronously deletable by this repository. | Mobile/release + operations owner |
| A13 | Current authenticated session is sufficient destructive-action authentication for now; recent re-auth is optional hardening, not asserted as present. | Security/product owner |
| A14 | Supported clients send `Idempotency-Key`; no-key requests remain compatibility behavior and may not replay after a lost response. | API/client owners |
| A15 | Application-template label heuristics identify age/gender/university/degree/year/origin; stable canonical keys are preferred and must be mapped by the application owner. | Applications/data owner |
| A16 | Meal/activity/judging/project records are operational or shared content, not permanent personal audit requirements, unless the table's row is explicitly listed above. | Domain owners |
| A17 | “Irreversible” means no identity mapping in the hackOS database after the transaction; it does not overclaim deletion from external systems or prevent statistical inference. | Privacy/security owner |
| A18 | No production database is in scope for this branch; H54 migrations are validated from a fresh schema. After first deployment, preserve applied checksums and use a new corrective migration for later changes. | Release/DB owner |
| A19 | No current ECTS, certificate or named participation-proof endpoint exists in this repository; any future implementation must not use a hidden anonymous-to-user map. | Product/academic-services owner |
| A20 | App Review can access a seeded accepted participant/staff account and reach Settings → Account & Data without external registration. | iOS release owner |

## Release recommendation

Merge only after the reviewer confirms A01–A05, A09, A12, A18 and A20, and
after operations documents provider/cache/log/backup retention. The code is
safe to review now: it removes the old identity bridge, provides direct web
and mobile actions, revokes access before asynchronous cleanup, and does not
retain identity merely to preserve certificates or implementation
convenience. The remaining high risks are deliberately visible rather than
hidden behind a success response.
