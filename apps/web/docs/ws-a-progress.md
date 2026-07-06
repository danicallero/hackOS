# WS-A — Devpost import + Projects UI (progress)

Owner channel for WS-A. Stories: **H16** (Devpost import preview/confirm), **H17**
(resolve unmatched participants + prize→challenge mapping), **H20** (read-only
project views). Route dir: `apps/web/src/app/(app)/projects/` ONLY.

Do NOT edit `judging-frontend-plan.md`, `nav.ts`, or any WS0 file — this doc is
the WS-A channel.

## Status: implementation complete, verifying

## Files created
- `projects/shared.ts` — local view types + helpers. See "Interface note" below.
- `projects/page.tsx` — project list (H20 read). Gate `PROJECTS_READ`.
- `projects/import/page.tsx` — import wizard: upload/paste 2 CSVs → preview → confirm (H16). Gate `PROJECTS_IMPORT`.
- `projects/unmatched/page.tsx` — unmatched resolution + prize→challenge mapping (H17). Gate `PROJECTS_IMPORT`.
- `projects/[id]/page.tsx` — project detail + hot-edit membership/challenge
  controls (H20-H21). Gate `PROJECTS_READ` + `PROJECTS_EDIT`.

## Decisions
- **Import from `@/lib/projects`** wrappers (previewImport, confirmImport,
  listUnmatched, linkParticipant, sendClaimEmail, mapPrize, listRepos,
  getRepoById) and `@/components/common/queue-status-badge`. Did not touch WS0
  files or nav.
- **Confirm idempotency**: `confirmImport(projectsCsv, participantsCsv, crypto.randomUUID())`.
  The WS0 wrapper sends it as the `Idempotency-Key` header (matches
  `apps/api/src/lib/idempotency.ts`, which reads `idempotency-key`).
- **Wizard is a single page** (`import/page.tsx`) with 3 phases (upload → review
  plan → confirmed result) driven by local state — not separate routes. Unmatched
  is its own route (`/projects/unmatched`) so it can be reached after any import.
- **Prize→challenge mapping** lives on the unmatched page (it is the H17 "resolve
  after import" surface) using a challenge picker from `GET /api/public/challenges`.
- H18–H19 (create/participant-created projects) are still NOT backed by the API.
  H21 is now backed and the page includes hot-edit team/challenge controls.

## Interface note (important for reviewers)
The WS0 `@/lib/projects` types (`RepoWithExtras`, `UnmatchedParticipant`,
`PlannedMember`, `PlannedRepo`) are permissive approximations with
`[k: string]: unknown` index signatures, and some field names differ from the
real API (e.g. WS0 `UnmatchedParticipant.repoId` vs API `repo_id`; WS0
`PlannedMember.name/userId` vs API `firstName/lastName/matchedUserId/matchType`).
To render exact fields safely, WS-A defines **local view types** in
`projects/shared.ts` (`ProjectRepo`, `RepoMember`, `RepoChallenge`,
`UnmatchedRow`, `PlanMember`, `PlanRepo`, `UnassignedRow`) that mirror the
authoritative backend shapes (`apps/api/src/modules/projects/{plan,service,csv}.ts`)
and narrow the wrapper results via typed coercion helpers. This does NOT redefine
the WS0 wrappers — it only adds accurate view models on top of them. If WS0 later
tightens its types, these can collapse.

## Verified
- `pnpm --filter @hackos/web typecheck` — clean
- `npx @biomejs/biome check --write apps/web/src/app/(app)/projects` — clean

## Left / follow-ups
- No live end-to-end run against a seeded DB was performed (would need infra +
  seeded devpost data). Logic wired against the exact API shapes read from source.
