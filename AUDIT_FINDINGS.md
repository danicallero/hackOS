# hackOS Code Quality & Maintainability Audit

Status: COMPLETE — all 4 sub-audits landed.

## Table of Contents

1. [apps/api](#apps-api) — status: DONE (clean)
2. [apps/web](#apps-web) — status: DONE
3. [apps/mobile](#apps-mobile) — status: DONE
4. [packages/shared, deploy/, infra/, scripts/, e2e/](#shared--deploy--infra--scripts--e2e) — status: DONE (clean)
5. [Cross-cutting recommendations](#cross-cutting-recommendations) — status: DONE

---

## apps/api

**Result: clean.** No dead code, no legacy/abandoned code, no unused dependencies.

- All 11 modules under `src/modules/` are registered in `src/modules/index.ts`.
- All `src/lib/*.ts` exports (audit, capabilities, errors, queues, sse, storage, etc.) have live external references.
- All `apps/api/package.json` dependencies (incl. `archiver`, `csv-parse`, `i18next`, `prom-client`, `@aws-sdk/*`, `@better-auth/expo`) are imported somewhere in `src/`. `yauzl` is used only in `test/applications/files-export.test.ts` as a real-parser verification for zip export — legitimate test dependency, not dead.
- All `scripts/*.ts` are wired into `package.json` scripts or imported as shared helpers (e.g. `default-database-url.ts` used by four scripts).
- No `FIXME`/`XXX`/`@deprecated` markers in `src/`. The only `TODO`-like grep hits were false positives (Spanish "TODOS" = "all", in H21 bulk-enrollment comments in `src/modules/projects/{routes,service}.ts`).

**Gap acknowledged by auditor:** duplicate-logic/overly-complex/redundant-query analysis would require a deeper per-module read (diffing SQL shapes inside each `modules/*/service.ts`) — out of scope for the structural pass performed. Flagged as unexplored, not as "nothing to find."

---

## apps/web

Overall: disciplined codebase. Single canonical `components/common` widgets per README convention, no forked variants, no dangling feature flags, no orphaned CSS, every page/component reachable from `lib/nav.ts` or a colocated route. No `TODO`/`FIXME`/`XXX`/`HACK` markers, no commented-out code blocks.

### Dead code

- **`components/common/donut-chart.tsx`** (99 LOC), **`trend-chart.tsx`** (108 LOC), **`usage-meter.tsx`** (44 LOC) — zero importers outside their own files (the one `UsageMeter` hit elsewhere is a doc-comment example, not real usage). These are the *only* consumers of the `recharts` npm dependency and of the shadcn `components/ui/chart.tsx` wrapper.
  - Impact: **medium** (~251 LOC + a large transitive dependency once fully unwound)
  - Risk: low — verified via `git log` and full-tree grep, no live call sites
  - Action: delete all three, then re-check `components/ui/chart.tsx` and `recharts` in `package.json` — once these three are gone, both become fully dead and should be removed too (regenerate `chart.tsx` via `shadcn add` later if a chart is ever needed again).

- **`components/ui/input-otp.tsx`** (77 LOC) — no `InputOTP`/`input-otp` reference anywhere else in `src/`. The `input-otp` npm package has no other importer.
  - Impact: low; Risk: low (vendored shadcn file, never wired in)
  - Action: delete file + remove `input-otp` dependency from `apps/web/package.json`.

- **`components/ui/scroll-area.tsx`** (58 LOC) — no `ScrollArea`/`scroll-area` reference anywhere else.
  - Impact: low; Risk: low
  - Action: delete (regeneratable via `shadcn add` if needed later).

No unused exports in `lib/*.ts`, no unused hooks (all 12 have real call sites), no unused components in `layout`/`public`/`projects`/`applications`/`legal`/`logistics`, no orphaned `app/` route segments.

### Duplicate logic

- **Duplicated raw multipart-upload boilerplate**, ~15-20 LOC each:
  - `app/(app)/enterprises/[id]/enterprise-cards.tsx:366-380` (enterprise logo upload)
  - `components/common/file-upload-field.tsx:78-92` (application file upload)
  - Both legitimately bypass `lib/api.ts`'s `apiFetch` (which always JSON-stringifies the body, so it can't carry `FormData` — not a convention violation) but hand-roll identical `FormData` construction, `fetch(..., {credentials:"include"})`, and error-envelope unwrapping.
  - Impact: low-medium (~30-40 duplicated LOC; any future upload-error-handling fix needs to be made twice)
  - Risk: low-medium — response shapes differ slightly (one expects `{key}`, other just checks `res.ok`), so a shared helper needs a generic return type
  - Action: factor out `apiUpload<T>(path, formData)` next to `apiFetch` in `lib/api.ts` (or a sibling `lib/api-upload.ts`).
  - Note: other raw `fetch()` calls (`wallet-buttons.tsx`, `brand.tsx`) are each justified inline (scoped-token wallet URLs must omit the session cookie; brand SVG fetch is a static asset) — not duplication, leave as-is.

No other duplicate-component/fetch patterns, no unused UI components beyond the above, no overly-complex implementations, no redundant API calls, and no disconnected files were found.

**Summary:** small, low-risk cleanup — delete 5 files (~386 LOC total: `donut-chart.tsx`, `trend-chart.tsx`, `usage-meter.tsx`, `input-otp.tsx`, `scroll-area.tsx`), drop `recharts` + `input-otp` deps once their sole consumers are gone, optionally consolidate the two upload call sites.

---

## apps/mobile

Overall: unusually well-maintained. Expo Router tree in `app/` matches `lib/tabs.ts`/`lib/overflow-tabs.ts` route registries exactly; rest of `lib/`/`components/` actively cross-referenced (198 source files swept). Most apparent "complexity" (QR frame/stability gating, scanner cache split, pseudo-tab navigation) is deliberate/documented, not accidental debt. No duplicate logic or orphaned routes found.

### Dead code

- **`components/scan-screen.tsx`** (633 LOC) — zero references anywhere in the app; fully superseded by `components/general-scanner-screen.tsx` (per `docs/mobile.md`, all scanner capabilities route through `GeneralScannerScreen`). Received drive-by edits in later commits (e.g. `85f15844`) suggesting it was mistakenly kept alive during refactors instead of deleted.
  - Impact: **high** (633 LOC removed, one less scanner implementation to keep in sync)
  - Risk: **low** — no dynamic `require`/deep-link references found via grep
  - Action: delete file.

- **`components/ExternalLink.tsx`, `components/StyledText.tsx` (`MonoText`), `components/useClientOnlyValue.ts` + `.web.ts`** — unmodified Expo Router template boilerplate, never imported by app code.
  - Impact: low (~46 LOC) but reduces starter-kit clutter
  - Risk: none — no wiring into routing
  - Action: delete.

### Unused dependencies

- **`@react-native-masked-view/masked-view`** and **`expo-linear-gradient`** in `apps/mobile/package.json` — zero source references; not a peer requirement of any config plugin found in `app.json`/patches.
  - Impact: low direct LOC, trims native dependency surface (both require native rebuilds when present)
  - Risk: low — verify with `expo-doctor` and a full native rebuild before removing (in case something transitively expects the module in `ios`/`android` folders)
  - Action: remove from package.json after native-rebuild verification.

---

## shared / deploy / infra / scripts / e2e

**Result: no significant dead code or doc debt.**

- **packages/shared**: every `CAPABILITIES.*`, `EVENTS.*`, `SSE_TOPICS.*` constant referenced somewhere under `apps/`. `activity-kinds.ts`, `wallet-pass-labels.ts`, `questions.ts`, `ui-test-ids.ts`/`.json` all have live consumers. `SPONSOR_PORTAL` capability is explicitly commented as a deprecated no-op kept for compatibility/repair reporting — intentional, not dead code.
  - **Open decision (flagged, not investigated further):** whether to fully retire sponsor-portal code paths or keep the compat shim. Worth a product call.
- **deploy/**: `deploy/scripts/gen-secrets.sh` referenced from `deploy/README.md`, `.env.instance.example`, `docs/env-vars.md` — not orphaned. `deploy/services/*/docker-compose.yml` use shared YAML anchors (`x-app-env`) rather than duplicated blocks — no consolidation opportunity.
- **infra/postgres-init**: `01-test-db.sql` referenced by root `docker-compose.yml` — not orphaned.
- **scripts/**: `check-copy.mjs`, `check-page-size.mjs` both wired into root `package.json` (`lint`, `check:copy`, `check:pages`) — used.
- **env-vars doc sync**: no actual doc debt (initial ~30-var mismatch was a false positive from a regex that mis-split comma-separated table rows in `docs/env-vars.md`; manually confirmed all vars documented).
- **e2e/**: small suite — `auth.spec.ts`, `judging-queue.spec.ts`, `fixtures.ts` (Playwright); `auth.e2e.js`, `critical-flows.e2e.js` (Detox) — all wired into `playwright.config.ts`/`detox.config.cjs` and root `package.json` scripts. No stale/orphaned test files.

---

## Cross-cutting recommendations

**Overall verdict:** this is an unusually clean, well-maintained codebase for its size. `apps/api` and `shared/deploy/infra/scripts/e2e` came back fully clean — no dead code found. `apps/mobile` and `apps/web` each have a small, low-risk pile of dead files, mostly leftover scaffolding (Expo template boilerplate, unused shadcn/chart primitives from `add` commands that were never wired in) rather than rot from active development.

### Recommended cleanup PR (single PR, low risk)

1. **apps/mobile**
   - Delete `components/scan-screen.tsx` (633 LOC, superseded by `general-scanner-screen.tsx`)
   - Delete `components/ExternalLink.tsx`, `components/StyledText.tsx`, `components/useClientOnlyValue.ts`(+`.web.ts`)
   - Remove `@react-native-masked-view/masked-view`, `expo-linear-gradient` from `package.json` — **verify with `expo-doctor` + a full native rebuild first**
2. **apps/web**
   - Delete `components/common/donut-chart.tsx`, `trend-chart.tsx`, `usage-meter.tsx`
   - Delete `components/ui/input-otp.tsx`, `components/ui/scroll-area.tsx`
   - Once the chart components are gone, remove `components/ui/chart.tsx` and the `recharts` dependency; remove the `input-otp` dependency
   - Optional follow-up (separate, slightly riskier PR): factor out a shared `apiUpload<T>()` helper for the two duplicated multipart-upload call sites (`enterprise-cards.tsx`, `file-upload-field.tsx`)

### Items requiring a human/product decision, not pure deletion

- **`SPONSOR_PORTAL` capability** in `packages/shared` — an intentionally-kept deprecated no-op shim for compatibility/repair reporting. Decide: fully retire sponsor-portal code paths, or keep the shim indefinitely. Not touched in this audit.

### Gaps / not investigated (flagged by sub-auditors, worth a follow-up pass if desired)

- `apps/api`: no deep per-module duplicate-SQL-pattern analysis was done (would require reading each `modules/*/service.ts` individually rather than repo-wide grep).
- No runtime/production profiling was done anywhere — "redundant DB queries" and "redundant API calls" findings above are limited to what's visible via static analysis (grep/import-graph), not observed request traces.

### Net impact if the recommended PR is applied

- ~1,020+ LOC removed across mobile + web dead files
- 3 npm dependencies removed (`@react-native-masked-view/masked-view`, `expo-linear-gradient`, `recharts`, `input-otp` — actually 4)

---
---

# Round 2 — Deep audit (post-cleanup)

**Status: COMPLETE.** Round 1 above (dead code + reuse/simplification/efficiency/altitude) is applied and merged into this branch (PRs/commits `203dc203` deletions, `c182dddb` refactors — see `git log`). This round is a deeper, research-only pass (no edits made) against the current branch state, covering complexity, legacy code, DB/API efficiency at depth, dependency/config health, and documentation-vs-plan drift. Findings below do **not** repeat anything already fixed in Round 1.

## 1. Executive summary

hackOS is a well-disciplined codebase for its size — no orphaned modules, no dead routes, capability-based auth is applied consistently, and documentation is largely in sync with code. After Round 1's deletions, remaining technical debt is concentrated in three places: (a) two real N+1/serial-broadcast patterns in `apps/api/src/modules/projects/service.ts`'s bulk-enrollment path (the highest-value fix — H21's "enroll ALL projects" is precisely the large-N case), (b) five near-identical hand-rolled clipboard-copy implementations and one more missed `initials()` duplicate in `apps/web`, and (c) one oversized multi-concern component in `apps/mobile` (`team-operations-screen.tsx`, 1700 lines / 23 `useState`s) that would benefit from the same local-hook extraction pattern already proven in Round 1. Dependency hygiene has one real gap (`apps/web` pinned to TypeScript 5 while the rest of the monorepo is on 6) and one doc gap (`CLAUDE.md` says stories run H1–H55; `plan/historias-hackos.md` actually goes to H59). Nothing found in this round rises to "architectural" — nothing in Phase 5.

## 2. Highest-value cleanup opportunities

Ranked by impact × safety:

1. **`projects/service.ts` bulk-enroll N+1** (`bulkAddRepoChallenge`/`bulkRemoveRepoChallenge`, lines 1508-1543, 1553-1580) — per-repo redundant scope checks plus a locked-read-per-row inside a transaction holding row locks. Directly hits H21's bulk path at its largest N. See §7.
2. **`announceQueueOutcomes` sequential broadcast loop** (`projects/service.ts:1624-1635`) — the exact anti-pattern Round 1 already fixed in `queue/service.ts`, left untouched here; `notifyChallengeQueueChanged` re-queries the same `challenge_id` once per outcome instead of once per call. See §7.
3. **Clipboard-copy duplicated 5×** in `apps/web` (`invite-links-card.tsx`, `active-invitations-modal.tsx`, `user-invite-links-section.tsx`, `invite-dialog.tsx`, `qr-code.tsx`) — one of the five (`invite-dialog.tsx`) has no error handling at all, a real (small) UX gap the duplication caused. See §5.
4. **`user-menu.tsx` `initials()` reimplementation** — Round 1 consolidated `initials()` in `users/page.tsx` but missed this higher-traffic surface (every authed page's top bar). See §5.
5. **`apps/web` pinned to TypeScript 5** while api/mobile/shared are on 6 — a real semantic-drift risk since `@hackos/shared` is consumed raw via `transpilePackages`. See §6.

## 3. Safe deletion list

Nothing new. Round 1 already deleted everything in the codebase that was verifiably unreferenced (mobile: `scan-screen.tsx` + Expo template boilerplate; web: chart/OTP/scroll-area components). This round's research-only pass found no additional dead files, exports, or components.

## 4. Verify-before-deletion list

- **`CAPABILITIES.SPONSOR_PORTAL`** (`packages/shared/src/capabilities.ts:48`) — confirmed still intentional: it's a deprecated compatibility no-op, never checked as an authorization grant anywhere in `apps/api`, explicitly excluded from permission templates (`identity/routes/permissions.ts:166`, `apps/web/.../permissions/helpers.ts:51`), and exists to support `docs/access-control-audit-plan.md`'s legacy-grant reporting. **Not dead code — do not delete without a product decision to fully retire sponsor-portal history.** Carried over from Round 1, reconfirmed this round.
- **`eslint` + `eslint-config-next` + `apps/web/eslint.config.mjs`** — none of the checked scripts (root `lint`, web's own `lint`) invoke eslint; only `biome check .` is wired in. Whether Next 16's `next build` still auto-invokes eslint by default was not independently confirmed. **Verify with a real `next build` run (check for an eslint pass in the output) before removing** — if it's a no-op leftover, drop both the devDependencies and the config file; if `next build` still uses it, keep it and document why two linters coexist.

## 5. Consolidation/refactoring opportunities

**apps/web:**
- Add a `useCopyToClipboard()` hook (or a plain `copyToClipboard(value, t)` helper) and replace all 5 call sites: `enterprises/[id]/invite-links-card.tsx:126-133`, `users/active-invitations-modal.tsx:141-148`, `users/user-invite-links-section.tsx:153-160`, `users/invite-dialog.tsx:122-125` (currently has no error toast — this fixes a real gap), `components/common/qr-code.tsx:52-55`.
- `components/layout/user-menu.tsx:19-23` reimplements `initials()` with a different (positional-args) signature and a `"?"` fallback the canonical version lacks. Point it at the shared `initials()` in `app/(app)/users/[id]/shared.ts:34-38` instead.

**apps/mobile:**
- `components/team-operations-screen.tsx` (1700 lines, 23 `useState` + 5 `useEffect` in one component) — extract the "add challenge" state/handlers and the "link participant" state/handlers into two local hooks (`useChallengeEnrollment`, `useMemberLinking`), following the exact pattern Round 1 already used for `useMemberCandidateSearch` in the same file.
- `components/schedule-form-modal.tsx:702-729` and `components/announcement-form-modal.tsx:760-786` define byte-identical `ToggleRow` components (both files' own comments say they're meant to mirror field-for-field). Move `ToggleRow` into `components/native-ui.tsx` alongside the other shared row primitives (`InfoRow`/`Section`).
- `components/general-scanner-screen.tsx:82-97` — four nearly identical `useEffect`s subscribing to four logistics SSE events, each calling the same `loadRoleStats`. Collapse into one effect iterating an event array. Cosmetic, low priority.

**apps/api:**
- No new consolidation opportunities beyond the DB/API items in §7 — `projects/service.ts`/`applications/service.ts`/`queue/service.ts` are long but the length is mostly repeated raw-SQL CRUD/audit/broadcast boilerplate inherent to the module pattern (per `CLAUDE.md`), not accidental duplication. `runBatch` (`applications/service.ts:1374-1390`) looks parallelizable at a glance but each op does its own capacity check inside its own transaction — the sequential loop is required for correctness, not a smell.

## 6. Dependency cleanup

- **`apps/web/package.json` — `typescript: "^5"`** vs. `^6.0.3` everywhere else (root, `apps/api`, `apps/mobile`, `packages/shared`). Bump to match; verify no TS6-only diagnostics break the web build.
- **`apps/web/package.json` — `@types/node: "^20"`** vs. `apps/api`'s `^26.1.0`, and the repo-wide `engines.node: ">=22"`. Bump to `^22`+ to match the actual runtime.
- **`eslint` / `eslint-config-next`** in `apps/web` — see §4, verify-before-deleting.
- Nothing else flagged: all other dependencies across `apps/api`, `apps/mobile`, `packages/shared`, and root `package.json` were checked against usage and script wiring with no further findings (extends Round 1's clean result for apps/api and shared/deploy).

## 7. Database/API efficiency improvements

- **FIXED** — `apps/api/src/modules/projects/service.ts:1508-1580` — `bulkAddRepoChallenge`. `enqueueRepoOnChallenge` now takes optional `challengeMarker`/`allocatePosition` params; the bulk caller computes `assertQueueChallengeScope` once and locks the group's bottom position once via `nextBottomPosition`, then hands out positions from an in-memory counter for the rest of the loop. The initial `FOR UPDATE` lock is held for the whole transaction, so serialization against a concurrent bulk-add on the same `queue_group` is unchanged — verified by inspection (each outcome, insert or revival, increments the active-entry count by exactly 1, which is what the original per-call `nextBottomPosition` recomputation also relied on). The 4 other `enqueueRepoOnChallenge` call sites (single add, `createRepoNative`'s per-challenge loop, etc.) omit the new params and get byte-identical behavior to before. `bulkRemoveRepoChallenge` was already correctly batched (single `FOR UPDATE`, single `compactQueueGroupPositions`) — no change needed there.
  - **Caveat:** this sandbox's Docker daemon is non-functional, so the live Postgres-backed integration suite (`test/projects/bulk.test.ts`) could not be executed to confirm this at runtime — verified via typecheck + careful reasoning about the locking/serialization invariants only. Run `pnpm --filter @hackos/api test test/projects/bulk.test.ts` before merging.
- **FIXED** — `apps/api/src/modules/projects/service.ts:1624-1635` — `announceQueueOutcomes`. Broadcasts now run via `Promise.all`; `notifyChallengeQueueChanged` is now called once per distinct `challenge_id` (deduped with a `Set`) instead of once per outcome.
- No other N+1s, redundant queries, or missing-batching patterns were found in this round's per-module read of `apps/api` beyond what Round 1 already fixed (`wallet-sync.ts`, `queue/service.ts` broadcasts).

## 8. Documentation/comment cleanup

- **`CLAUDE.md:7`** says the functional source of truth covers "user stories H1-H55" — `plan/historias-hackos.md` actually contains stories through **H59** (verified: real H56-H59 headers present). `docs/README.md` already correctly says "H1–H59." Since `plan/` is the read-only source of truth per `CLAUDE.md`'s own rule, this is `CLAUDE.md` that needs the one-line fix (H55 → H59).
- **`docs/DESIGN.md` §3** claims the only raw (non-`SectionCard`) `Card` usages left in `app/(app)` are the auth-style confirmation card and the my-queue ticket stub. Two more exist and aren't listed: `app/(app)/schedule/page.tsx:33,366` (a titled search/filter panel — exactly `SectionCard`'s use case) and `app/(app)/verify-secondary-email/page.tsx:9,97` (a full auth-style confirmation card living under `(app)` instead of `(auth)`). Either update the doc's exception list to name both, or migrate `schedule/page.tsx`'s card to `SectionCard` and reconsider whether `verify-secondary-email` belongs under `(auth)`.
- **`docs/mobile.md`** doesn't name two real, widely-used shared components by name even though it describes their behavior in prose: `components/stale-data-banner.tsx` (used in 7 places for offline-UX fallback) and `components/session-state.tsx` (renders the auth-flow "session progress" screen described in the doc's Auth section). Minor discoverability gap, not an inaccuracy — add a one-line component-name reference in each relevant section.
- No stale `TODO`/`FIXME`/`HACK` comments were found anywhere in `apps/api`, `apps/web`, or `apps/mobile` in this round (all grep hits were legitimate prose comments or H21 Spanish-language doc comments, not markers of incomplete work).

## 9. Suggested cleanup sequence

**Phase 1 — zero/very-low-risk deletions:** none remaining; Round 1 already completed this phase (see above).

**Phase 2 — dependency and duplicate cleanup:**
- Bump `apps/web`'s `typescript` to `^6.0.3` and `@types/node` to `^22`+ to match the rest of the monorepo; run full typecheck/build afterward.
- Add `useCopyToClipboard()` in web and replace all 5 call sites (§5).
- Point `user-menu.tsx`'s `initials()` at the shared helper (§5).
- Move `ToggleRow` into `components/native-ui.tsx` in mobile (§5).
- Fix `CLAUDE.md`'s H55→H59 story-count reference (§8).

**Phase 3 — simplification refactors:**
- Extract `useChallengeEnrollment`/`useMemberLinking` hooks out of `team-operations-screen.tsx` (§5).
- Collapse the four logistics-event effects in `general-scanner-screen.tsx` into one (§5).
- Verify whether `eslint`/`eslint-config-next` in `apps/web` is actually invoked by `next build`; remove if not (§4/§6).

**Phase 4 — database/API optimization:**
- **DONE** — bulk-enroll N+1 in `projects/service.ts` (§7, item 1) fixed; needs the live integration suite run before merge (Docker was unavailable in the sandbox that made this change).
- **DONE** — `announceQueueOutcomes`'s sequential broadcast loop (§7, item 2) fixed.

**Phase 5 — larger architectural technical debt:**
- Nothing found in this round rises to this level. The one open architectural/product question carried from Round 1 remains: whether to fully retire `SPONSOR_PORTAL`'s compatibility shim (§4) — a product decision, not a code-quality finding.
- Fix `docs/DESIGN.md`'s raw-`Card` exception list and `docs/mobile.md`'s missing component references (§8) — low effort, can be folded into Phase 2 if preferred; separated here only because it's pure documentation, not code.
- No API surface, route, or user-facing behavior changes — every deleted file is unreferenced
