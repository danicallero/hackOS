# H54 remediation program

This file is the live work plan for resolving the PR #584 account-deletion and
anonymization findings on `danicallero/account-deletion-anonymization`.

## Baseline

- PR: #584 (`feat(H54): implement account deletion and anonymization`)
- Base: `067d783befc732fc625fd4a8bd3c0b4ad046733f`
- Review head at intake: `5059ff81a5076c3b070c2b8d013be90f461bb0d4`
- Working mode: same active worktree, coordinated Luna-max workers, no blind
  resets or destructive history rewriting.
- Prior raw orchestration messages: `/tmp/pr584-orchestration-messages.json`.
- Prior validation: lint, web typecheck/tests, mobile tests, and CI run
  `33100380561` passed; local API integration was unavailable because the
  PostgreSQL/worker setup was not running.

## Assumptions requiring verification

| ID | Assumption | Effect if false | Owner/status |
|---|---|---|---|
| A1 | Migrations `0730`–`0746` have never shipped outside this development branch. | Do not rewrite names/checksums; design a separately verified upgrade path. | Release/DB — pending |
| A2 | A pending account may retain only the minimum short-lived exit-operational state until a physical exit. | If the product accepts broader temporary retention, document the exception; otherwise scrub/redesign the pending envelope. | Identity/product — pending |
| A3 | A pending user may perform only recovery/status/cancel/sign-out plus a valid current-badge exit. | Better Auth and all ordinary domain writers must remain blocked. | Identity/security — pending |
| A4 | `users.badge_assigned_at` is the authoritative stale-scan fence. | Do not weaken timestamp checks or replace it with client time. | Logistics/security — pending |
| A5 | Fixture accounts/resources must never cross ordinary account/resource scopes. | Any exception needs an explicit fixture capability and tests. | Domain owners — pending |
| A6 | Form versions are immutable and every response has a valid version. | Preserve an explicit compatibility policy instead of nullable fallbacks. | Applications — pending |
| A7 | Admin-originated pending removal cancellation is either intentionally allowed or source-restricted. | Persist initiator/source and enforce the chosen policy. | Product/security — decision needed |

## Work items

| ID | Area/task | Status | Assumption/acceptance evidence |
|---|---|---|---|
| C1 | Web queue cleanup must be owner-scoped; never clear another account's local queues. | pending | A5; cross-account browser test |
| C2 | Serialize web offline queue load/enqueue/replay persistence. | pending | A4; lost-update/concurrency test |
| C3 | Guard web queue loads/saves across account switches. | pending | A5; A→B epoch test |
| C4 | Terminalize `badge_scan_before_assignment` on web and share the code contract. | pending | A4; stale replay test |
| C5 | Fix mobile corrected-clock retry result classification. | pending | Retryable failures stop replay; terminal failures are acked |
| C6 | Guard native roster snapshot replacement by owner/generation. | pending | A5; sign-out/switch race test |
| C7 | Make pending-removal web polling resilient to transient refresh failures. | pending | A3; visible retry, no false redirect |
| C8 | Make pending-removal mobile refresh bounded, retryable, and error-visible. | pending | A3; expiry/5xx tests |
| C9 | Make pending-removal UI Dynamic-Type/large-text safe. | pending | Accessibility/manual test |
| C10 | Align deletion copy with `integrityWarning` and pending states. | pending | A2; es/gl/en parity |
| I1 | Enforce pending-state allowlist around Better Auth generated routes. | pending | A3; route matrix test |
| I2 | Parse the actual Better Auth session cookie and bind exact expiry. | pending | A3; multi-session test |
| I3 | Close cancellation deadline race and add cancellation idempotency. | pending | A7; row-lock/retry tests |
| I4 | Reject/handle pending-account writes in all identity mutation paths. | pending | A2/A3; direct SQL and API tests |
| D1 | Block application reviews/staff mutations against pending targets. | pending | A3; user-first lock-order test |
| D2 | Make DSR worker failure transition durable and retryable. | pending | A3; failure-after-removal test |
| D3 | Enforce fixture markers in project/repository/challenge graph mutations. | pending | A5; mixed-graph tests |
| D4 | Enforce fixture scope in notifications, sponsors, queue writes, and SSE. | pending | A5; read/write/broadcast tests |
| D5 | Preserve hidden fixture visibility after DSR subject scrubbing. | pending | A5; post-scrub listing test |
| DB1 | Squash H54 migrations into one dependency-safe final `0730` migration. | in progress | A1; fresh install and ledger checks |
| DB2 | Install active-user reference triggers after all final FKs; cover `time_logs`. | in progress | A3; catalog/behavior tests |
| DB3 | Enforce non-null/versioned application responses and regenerate DBML. | in progress | A6; composite-FK tests |
| DB4 | Remove temporary scanner DDL and broad fresh-schema cleanup DML. | in progress | A1; separate populated upgrade if needed |
| DOC1 | Rewrite stale account-removal, fixture, module, worker, and migration claims. | pending | Must match final code/schema |
| DOC2 | Update PR body/checklist and legal/copy metadata inconsistencies. | pending | CI/checklist reflects actual state |
| T1 | Add regression coverage for races, pending allowlist, fixture isolation, and migrations. | pending | Tests listed beside each fix |
| T2 | Run lint, typechecks, web/mobile tests, API tests where DB permits, and diff/schema audits. | pending | No unresolved P1s; record blockers |

## Coordination rules

1. Workers use Luna max only and stay inside their assigned file boundaries.
2. Workers report exact files, tests, assumptions, and any blocker before
   stopping. A worker terminal is either actively progressing or closed; no
   stale/rate-limited panes remain.
3. No migration rewrite is treated as safe until A1 is verified. If A1 fails,
   preserve deployed filenames/checksums and split upgrade work from the fresh
   schema.
4. `program.md` is updated at each completed wave and before the final merge
   recommendation.

## Received-message digest

The complete raw review archive is `/tmp/pr584-orchestration-messages.json`.
The rate-limited review wave produced the following actionable message groups;
the individual messages remain in that archive and the current worker inbox:

- Client review: web queue deletion must be owner-scoped and serialized; guard
  account-switch races; terminalize `badge_scan_before_assignment`; mobile
  corrected-clock retries must distinguish terminal from transient failures;
  native roster replacement needs an owner/generation fence; pending-removal
  refresh must show retry state; large text and all three locales must remain
  usable.
- Identity review: restrict Better Auth generated routes for pending accounts;
  parse the actual signed session cookie and bind the initiating expiry; close
  cancellation-deadline races; add cancel idempotency; reject pending identity
  mutations; decide and enforce the admin-origin cancellation policy; do not
  let a late `202` overwrite a finalized `200`.
- Domain review: lock users before application decisions/expiry; make DSR
  failures durable and retryable; isolate project/challenge/repository,
  notification, sponsor, queue and logistics fixture graphs; preserve hidden
  fixture visibility after subject scrubbing; sanitize logistics SSE and
  pending-exit responses; close pending sessions at event end or expiry.
- Migration/docs review: the development-only H54 chain must be flattened;
  install final active-user triggers after all foreign keys, including
  `time_logs`; make application response form versions non-null and
  same-application; use keyed scanner denylist digests; remove stale migration
  references and overconfident deletion claims from docs.
- Final contract audit (`task_f138457866da` / `ctx_911d7131f24f`) reported and
  fixed pending-exit identity-less response contracts, collision-proof session
  row IDs, fixture-scoped presence aggregates and Devpost prize mappings, and
  restored all real attendee roles to scanner snapshots. Web/API typechecks,
  lint/copy/page checks, mobile scanner tests, and the web suite passed; API
  integration remained blocked by the unavailable/resetting local PostgreSQL
  service on port 5433.

The current Luna-max remediation assignments are:

| Task | Orca task / dispatch | Terminal | Boundary |
|---|---|---|---|
| Client C1–C10 | `task_0d915065b06b` / `ctx_8df30fb8aed4` | `term_7af73a39-37e2-43ba-8992-d6ffd72b25ef` | web/mobile and client tests |
| Identity I1–I4 | `task_baa929b4817e` / `ctx_944e85b10af2` | `term_d35800db-2dd2-4f22-bfa0-69b0a19c8e7f` | API identity/auth and identity tests |
| Domain D1–D5 | `task_800af7e1d910` / `ctx_8757843fcfa7` | `term_d8effabb-d4a9-4b0b-9d40-55c4e8fc3a32` | API domain code/tests outside identity/migrations |
| Final contract audit | `task_f138457866da` / `ctx_911d7131f24f` | `term_a67f02ea-1dc1-43a7-af78-a590cd9b6cbf` | pending-exit contracts, scanner scope, Devpost fixture reads |
| Queue fixture SSE audit | `task_36bf90626c45` / `ctx_8cf9abcfc93d` | `term_d56cdf6e-3563-4af2-a1d6-b0db6bc81707` | queue/project broadcasts and stream topic isolation |
| Migration/docs final audit | `task_d4ca8403635b` / `ctx_5f42fc884e5c` | `term_c58c595f-0ab2-448e-bf9c-2d1cae872fde` | squashed DDL, DBML, documentation and migration tests |

All three use `gpt-5.6-luna max`, share this worktree, were told not to commit,
and must send exactly one `worker_done` before their terminal is closed. The
coordinator is `term_d22851bc-ee04-441c-aaa9-ff22ee0f213e`; no Terra worker is
part of the active wave. Stale terminals are closed after their evidence is
captured.

## Continuation prompt

Use this prompt if another coordinator must resume:

> Continue PR #584 remediation on `/Users/dani/orca/workspaces/fablehackos/skipjack`, branch `danicallero/account-deletion-anonymization`. Read `AGENTS.md`, `CLAUDE.md`, `plan/historias-hackos.md`, `plan/07-datos-relevantes-ers.md`, `docs/README.md`, and this `program.md`. Use the Orca `orchestration` skill and Luna max workers only; inspect current task/terminal state before dispatching anything. Treat the current worktree as shared and preserve all uncommitted changes. First collect `worker_done`/escalation messages for `task_0d915065b06b`, `task_baa929b4817e`, and `task_800af7e1d910`; close each worker terminal only after completion evidence. Review their diffs for correctness before updating statuses. Finish remaining root-owned work: pending-identity exposure in logistics reads/SSE, DSR/fixture marker races, migration trigger cleanup, docs/schema consistency, and any type/lint/test regressions. Run `git diff --check`, API/web/mobile typechecks, focused tests, `pnpm lint`, and the fresh migration suite with an available Postgres/Valkey setup. Do not call the goal complete while any C/I/D/DB/DOC/T item is unresolved; update this tracker after every wave with tests, assumptions, blockers, and exact file paths. At the end verify `orca terminal list --json` contains only the coordinator and no stale/rate-limited panes, then report the final fix list and remaining external release-gate tests.
