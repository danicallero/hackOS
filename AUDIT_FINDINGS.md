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
- No API surface, route, or user-facing behavior changes — every deleted file is unreferenced
