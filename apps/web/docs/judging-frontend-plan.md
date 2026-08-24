# Judging / Project-Import / Queue-Visualization — Frontend Build Plan

**Shared coordination doc.** Multiple agents work from this file. If you are an
agent picking this up mid-flight: read §0 (status board) first, claim a
workstream in the board, then read that workstream's section. Update the board +
progress log (§9) as you go so the next agent can continue if the current one
stops (rate limit, crash, handoff).

Story source of truth: `plan/historias-hackos.md` (H-numbers). Hard invariants:
`plan/07-datos-relevantes-ers.md`. Project conventions: `CLAUDE.md`.

---

## 0. Status board

Legend: ⬜ not started · 🟨 in progress · ✅ done · 🔵 review needed

| WS | Area | Owner | Status | Notes |
|----|------|-------|--------|-------|
| 0  | Foundation (SSE hook, queue API client, nav, shared bits) | orchestrator | ✅ | Interfaces stable — see §5 committed files |
| A  | Devpost import + Projects UI (H16–H17, repos read) | agent + codex | ✅ | progress → `ws-a-progress.md`; detail + unmatched routes added |
| B  | Queue operations + Judging panel (H29–H40) | codex | ✅ | `/queue` ops dashboard + `/judging` panel; room assignments + generate-queues wired |
| C  | TV screens (H41–H42) | discarded | ⏹ | removed on request |
| D  | Participant "my queue" (H38) | agent (bg) | ✅ | progress → `ws-d-progress.md` |

> Per-workstream agents keep their own `ws-{a,b,c,d}-progress.md` next to this
> file (avoids write collisions on the shared board). The orchestrator owns this
> board + §9 log; check the per-WS files for live detail.

**WS0 committed (import these; do not redefine):**
- `@/hooks/use-event-source` → `useEventSource(path, {events,onEvent,enabled})`,
  `useLiveQuery(fetcher, streamPath, eventNames)` (fetch + debounced refetch on SSE).
- `@/lib/queue` → types (`RoomView`, `ChallengeProgress`, `RoomPace`,
  `MyQueueEntry`, `QueueEntry`, `Room`, `QueueStatus`, …) + wrappers
  (`getRoomView`, `getChallengeProgress`, `getMyQueue`, `callNext`,
  `pauseRoom`/`resumeRoom`, `entryAction(entryId, action, body?, idemKey?)`,
  `getReview`/`saveReview`/`openSession`/`searchTeams`, `exportUrls`, …).
- `@/lib/projects` → `ImportPlan`, `RepoWithExtras`, wrappers (`previewImport`,
  `confirmImport`, `listUnmatched`, `linkParticipant`, `listRepos`, …).
- `@/components/common/queue-status-badge` → `<QueueStatusBadge status=… />`.
- `nav.ts`: "Queue operations" (`/queue`), "Judging" (`/judging`) and
  "Projects" (`/projects`) live.
- Idempotency: pass `crypto.randomUUID()` as the idem key on critical POSTs.

**Claim protocol:** set your name in Owner + flip to 🟨 before writing code.
One agent per workstream. WS0 must reach ✅ before A–D merge (they may start
against WS0's committed interfaces once those files exist).

---

## 1. Mission & current state

Build the **frontend** (Next.js app at `apps/web`) for the judging vertical. The
**API is already built and complete** for the MVP scope — do not re-implement
backend logic. Your job is the UI + realtime wiring.

- Backend modules live in `apps/api/src/modules/{queue,projects,challenges}`.
- The web app is Next.js 16 / React 19 / Tailwind 4 / radix-ui (shadcn-style),
  recharts, sonner, react-hook-form + zod. Client components, `credentials:
  include` cookie auth via `@/lib/api`.
- **No frontend exists yet** for queue/judging/projects/TV. Nav has a `soon`
  placeholder for "Queue & judging" (`apps/web/src/lib/nav.ts`).
- **No SSE consumption exists yet** in the web app — WS0 builds the hook.

Scope note (backend reality): **H18–H19 (create projects in hackOS,
participant-created projects) are intentionally NOT in the backend yet** (see
comment in `apps/api/src/modules/projects/routes.ts`). H21 now has a real
read/write surface. WS-A ships H16–H17 (Devpost import + unmatched resolution)
and read-only project views. Do not build UI for endpoints that don't exist;
leave `soon`-style placeholders.

---

## 2. Conventions to follow (match existing web code)

Model your code on `apps/web/src/app/(app)/challenges/page.tsx` and
`enterprises/`. Concretely:

- **Client components** (`"use client"`). Fetch in `useEffect` / event handlers
  via `api` from `@/lib/api` (`api.get/post/patch/delete`). Errors are
  `ApiError` with `.code`/`.message`; surface `.message` verbatim in a
  `toast.error(...)` (sonner).
- **Capability gating:** `useSessionContext()` (`@/lib/session`) exposes the
  user's capabilities; use `<CapabilityGate capability={...}>` from
  `@/components/common/capability-gate` and/or nav gating. Capability constants:
  `@hackos/shared/capabilities` → `CAPABILITIES.*`.
- **Shared UI:** prefer existing pieces before making new ones —
  `@/components/common/{page-header,section-card,stat-card,status-badge,
  data-table,empty-state,modal,spinner,submit-button,duration-input}` and
  `@/components/ui/*` (button, card, select, tabs, table, dialog, sheet, badge,
  progress, tooltip, scroll-area, separator, sonner…). Full list:
  `ls apps/web/src/components/{ui,common}`.
- **Tones/colors:** `@/lib/tones.ts`. Datetime: `@/lib/datetime.ts`. i18n
  helper: `@/lib/i18n.ts` (challenge titles are `{es,en}` records — use the
  existing display/fallback helpers in `challenges/shared.ts`).
- **Story traceability (CLAUDE.md §1):** every commit and each non-obvious
  comment references its H-number, e.g. `feat(web/queue): judge panel (H32,H36)`.
- **Do not** add `localhost` literals — API base is `@/lib/env` `API_URL`.
- Run `pnpm --filter @hackos/web typecheck` and `pnpm --filter @hackos/web lint`
  before marking a WS ✅.

---

## 3. API catalogue (all already implemented)

Base = `API_URL`. All credentialed. Error envelope: `{ error: { code, message,
details } }`. `:params` are path params. Exact request/response Zod lives in each
module's `schemas.ts`; **read the module before wiring** to get field names right.

### Queue reads (feeds panels + TV) — `queue/reads.ts`, `reads.routes.ts`
- `GET /api/queue/challenges/:challengeId/progress` → `{ challengeId, waiting,
  called, inProgress, evaluated, disqualified, other, byStatus }` (H40)
- `GET /api/queue/rooms/:roomId/view` → `{ room, state, active, called[], next[] }`
  where each entry row includes `repo_name` (H41; TV data source)
- `GET /api/queue/rooms/:roomId/pace` → desired vs remaining vs pending +
  `effectiveMinutesPerTeam` (advisory timer target) (H39)
- `GET /api/queue/me` (auth only) → per-repo `{ challengeId, challengeTitle,
  repoId, repoName, status, position, etaMinutes, calledAt, roomId }[]` (H38)
- `GET /api/tv/rooms` (public) → array of roomView objects (H41)
- `GET /api/queue/stream` (SSE topic `queue`) · `GET /api/tv/stream` (SSE `tv`) ·
  `GET /api/queue/me/stream` (SSE per-user)
- `GET /api/tv/mode` · `POST /api/tv/mode` `{ mode, payload? }` (H42)

### Queue operate / rooms — `entries.routes.ts`, `rooms.routes.ts`, `service.ts`
- Rooms admin: `GET/POST /api/queue/rooms`, `GET/PATCH/DELETE /api/queue/rooms/:roomId`
- `POST /api/queue/rooms/:roomId/call-next` (H29/H30), `/pause` (H35), `/resume`,
  `GET /api/queue/rooms/:roomId/state`
- Room↔queue group: `GET /api/queue/groups`,
  `POST /api/queue/rooms/:roomId/queue-group`,
  `DELETE /api/queue/rooms/:roomId/queue-group/:queueGroupId` (H46)
- Judge roster: enterprise-scoped, `/api/enterprises/:id/judges` (H46) — the
  queue module has no room-scoped judge routes
- `POST /api/queue/challenges/:challengeId/enqueue` (generate/append queue, H21)
- Entry transitions (all POST, most `idempotencyGuard`):
  `/notify-enter`(H31) `/bring-in`(H32) `/start`(H32) `/complete`
  `/send-back`(H33 → back to called) `/re-enter`(H33) `/requeue`(H33)
  `/no-show`(H34) `/skip`(H30) `/cancel` `/disqualify`(H34)
  `/manual-call`(H33 recover forgotten team) ; `GET /api/queue/entries/:id/history`

### Judging (evaluate) — `judging.routes.ts`, `judging.ts`
- `GET /api/queue/entries/:entryId/review` → current draft/scores (H36)
- `PATCH /api/queue/entries/:entryId/review` → save draft (versioned, per-field
  audit trail) (H36); submitting closes the presentation (H36/H37)
- `GET /api/queue/entries/:entryId/review/versions` (H36 history)
- `POST/DELETE /api/queue/entries/:entryId/session` (open/close collaborative
  session; `GET .../sessions` lists who's editing) (H36 "at the same time")
- `GET /api/queue/challenges/:challengeId/search?q=` (H37 find by name/title/#)
- `GET /api/queue/challenges/:challengeId/export/queue.csv` &
  `/export/evaluations.csv` (H40, one column per criterion)
- `GET /api/queue/settings`

### Projects / Devpost — `projects/routes.ts`, `service.ts`, `plan.ts`
- `POST /api/devpost/imports/preview` body `{ projectsCsv, participantsCsv }`
  (raw CSV **text**) → `ImportPlan { repos[], prizes[], unassignedParticipants[],
  totals{...} }` — pure, read-only (H16)
- `POST /api/devpost/imports/confirm` (idempotent) same body → applies (H16)
- `GET /api/devpost/imports/unmatched` → `{ participants: UnmatchedParticipant[] }` (H17)
- `POST /api/devpost/imports/link` `{ repoId, email, userId }` (H17)
- `POST /api/devpost/imports/claim-email` `{ repoId, email }` (H6/H17)
- `POST /api/devpost/prizes/:prizeName/map` `{ challengeId }` (prize→challenge)
- `GET /api/repos` · `GET /api/repos/:id` → project read views (PROJECTS_READ)
- `GET /api/me/projects` (participant "my project", H20)
- Types: `apps/api/src/modules/projects/plan.ts` (`ImportPlan`, `PlannedRepo`,
  `PlannedMember`, `MemberMatchType`), `service.ts` (`RepoWithExtras`,
  `UnmatchedParticipant`).

### Challenges (already has UI) — reuse `challenges/shared.ts` types/helpers
- `GET /api/challenges`, `GET /api/challenges/:id` include the judging-panel
  criteria used by the scoring form (H36). Public: `GET /api/public/challenges`.

### Relevant capabilities (`@hackos/shared/capabilities`)
`PROJECTS_READ`, `PROJECTS_IMPORT`, `PROJECTS_EDIT`, `QUEUE_OPERATE`,
`QUEUE_ADMIN`, `JUDGE_PANEL`.

---

## 4. SSE contract (how realtime works)

Server framing (`apps/api/src/lib/sse.ts`): standard `text/event-stream`, lines
`event: <type>` / `id: <seq>` / `data: <json envelope>`. Envelope
(`packages/shared/src/events.ts`): `{ type, id, at, data }`. Event names in
`EVENTS`:
- `queue.entry.status_changed` — any entry transition (topic `queue`)
- `queue.room.state_changed` — pause/resume/settings (topic `queue`)
- `queue.entry.notify_enter` — H31 (topic `queue`)
- `tv.mode.changed` — H42 (topic `tv`)
- `user.queue.called` / `user.queue.precall` / `user.notification` — per-user
  topic `user:<id>` (H38)

**Recovery contract:** the payload is a *signal*, not full state. On any event
(and on reconnect), **refetch** the relevant read endpoint (`roomView`,
`challengeProgress`, `myQueueStatus`, `tv/rooms`). Keep it simple: debounce
refetch. Browser `EventSource` auto-reconnects and sends `Last-Event-ID`.

Note: `EventSource` can't send custom headers; these SSE routes are cookie-auth
or public, so `new EventSource(url, { withCredentials: true })` works. Point at
`${API_URL}/api/...`.

---

## 5. WS0 — Foundation (BLOCKING, owner: orchestrator)

Ship these shared files first; A–D import from them. Keep interfaces stable once
committed.

1. **`apps/web/src/hooks/use-event-source.ts`** — generic SSE hook.
   `useEventSource(path, { onEvent, events?, enabled? })` opening
   `new EventSource(API_URL+path, { withCredentials: true })`, dispatching by
   event name, auto-cleanup, reconnect tolerance. Plus a thin
   `useLiveQuery(fetcher, streamPath, eventNames)` helper: fetch on mount +
   debounced refetch on matching events (the §4 recovery pattern).
2. **`apps/web/src/lib/queue.ts`** — typed queue/judging API wrappers + shared
   types (RoomView, ChallengeProgress, MyQueueEntry, entry status union, room
   state) mirrored from the backend read shapes in §3. Thin wrappers over `api`.
3. **`apps/web/src/lib/projects.ts`** — typed Devpost import wrappers +
   `ImportPlan`/`RepoWithExtras`/`UnmatchedParticipant` mirrors.
4. **`apps/web/src/components/common/queue-status-badge.tsx`** — status → label +
   tone (waiting/called/in_room/presenting/completed/disqualified). Reuse
   `status-badge` + `tones.ts`.
5. **`apps/web/src/lib/nav.ts`** — remove `soon` from "Queue & judging"
   (`/queue`); add "Projects" (`/projects`, icon e.g. `FolderGitIcon`,
   `anyCapability: [PROJECTS_READ, PROJECTS_IMPORT]`). Add TV entry if desired
   (or leave TV as an unlinked public route).

Acceptance: typecheck + lint clean; A–D can `import` these without edits.

---

## 6. WS-A — Devpost import + Projects (H16–H17, H20)

Route dir: `apps/web/src/app/(app)/projects/`. Gate: `PROJECTS_READ` (list) /
`PROJECTS_IMPORT` (import flow).

Pages/flow:
- **`projects/page.tsx`** — project list (`GET /api/repos`): title, team size,
  challenges/prizes, matched/unmatched badge. DataTable + EmptyState.
- **`projects/import/page.tsx`** — wizard: (1) upload/paste the two Devpost CSVs
  (`file-upload-field` → read text client-side). (2) `POST .../preview`, render
  `ImportPlan`: totals, repos to create/update, members matched vs unmatched,
  `unassignedParticipants`. (3) Confirm → `POST .../confirm` (send an
  idempotency key header; see `apps/api/src/lib/idempotency.ts` for header name).
- **`projects/unmatched/…`** (or a tab) — H17: list unmatched, link to an
  existing user (`/link`) or send claim email (`/claim-email`). Prize→challenge
  mapping UI (`/prizes/:name/map`).
- **`projects/[id]/page.tsx`** — project detail: team, challenges, links, and
  H21 hot-edit membership/challenge controls.

Acceptance: full import happy path from two CSVs → preview → confirm; unmatched
resolution; business errors shown verbatim. Sample CSVs: see old project
`/Users/dani/hackathon-os/hackOS copy/projects.csv` + `registrants.csv` for
column shape reference (verify against `projects/plan.ts` parser).

---

## 7. WS-B — Queue & Judging panel (H29–H40) — the big one

Route dir: `apps/web/src/app/(app)/queue/`. Gate: `JUDGE_PANEL` /
`QUEUE_OPERATE` / `QUEUE_ADMIN`.

**Layout reference (liked by the user):** old project
`/Users/dani/hackathon-os/hackOS copy/frontend/app/judging/page.tsx` +
`frontend/features/judging/components/{QueuePanel,PresentationCard,ScoringForm,
StatChip,TeamInfoSection,DynamicFormField}.tsx`. Reproduce the **layout** (header
with room selector + pause + stat chips; 3-col grid: queue panel left / presentation
card + scoring form right) but with THIS repo's shared components and good
practices (no zustand stores — use the WS0 hooks; no bespoke ad-hoc CSS —
Tailwind + shared UI). Do NOT copy their code wholesale.

Break into components under `queue/_components/`:
- **Room selector + header** — pick room (assigned rooms for judges, all for
  admin), show challenge, pause/resume (H35), pace/timer state (H39).
- **QueuePanel** — waiting/called lists; call-next (H29), notify-enter (H31),
  bring-in (H32); no-show with time-called highlight + threshold (H34);
  requeue/send-back/skip (H33/H30). Live via WS0 `useLiveQuery` on `roomView` +
  `queue` stream.
- **PresentationCard** — the active team: project, team members with the
  inscription info relevant to the challenge (H32; e.g. rookie → year of study),
  challenges they present to. Start/complete + timer that recolours near the
  `effectiveMinutesPerTeam` limit (H39).
- **ScoringForm** — dynamic form from the challenge's judging-panel criteria
  (H36). Save draft (`PATCH review`, autosave), collaborative session
  (`POST/DELETE session`, show co-editors), submit (closes presentation),
  versions view. Reuse challenge criteria types from `challenges/shared.ts`.
- **Search (H37)** — `GET .../search?q=`; if unevaluated → bring in (manual), if
  evaluated → open existing review.
- **Operator progress view** (own page/tab, H40) — per-challenge progress
  (queued/evaluated/in-progress/disqualified) + CSV export buttons (queue /
  evaluations). Uses `challengeProgress`.
- **Rooms admin** (`queue/rooms/…`, QUEUE_ADMIN) — CRUD rooms, attach
  challenges, assign judges (H46), settings (waiting-room quota, desired
  minutes/team H39).

Acceptance: a judge can run a room end-to-end (call → notify → bring-in → start →
score → submit) against the real API with live updates; operator can pause,
no-show, requeue, export. Wire idempotency headers on the critical POSTs.

**This WS is large — split into B1 (operator queue panel + transitions), B2
(judge scoring form + sessions + search), B3 (rooms admin + progress/export) if
parallelizing across agents.** Track sub-status in §9.

---

## 8. WS-D — Participant queue (H38)

**WS-D** — participant view of `GET /api/queue/me` + `/api/queue/me/stream`
(`user.queue.called`/`precall`): per-challenge status/position/ETA, pre-call and
"go to room X" notices. Place under `(app)` — e.g. `my-queue/page.tsx` (add nav,
no capability gate, participant-facing) or integrate into `my-applications`.
Decide + record in §9.

---

## 9. Progress log (append-only; newest last)

- `2026-07-06` orchestrator: wrote this plan; API catalogue + SSE contract
  verified against source. Starting WS0.
- `2026-07-06` orchestrator: **WS0 done** ✅. Added `use-event-source.ts`
  (`useEventSource` + `useLiveQuery`), `lib/queue.ts`, `lib/projects.ts`,
  `queue-status-badge.tsx`; nav has `/queue` + `/projects` live. `pnpm --filter
  @hackos/web typecheck` + biome clean. A–D unblocked; import the §5 interfaces.
  Verified `listRooms` returns `Room[]` (not `{rooms}`) and `/rooms/:id` returns
  `room + queueState` (only `/rooms/:id/view` is a `RoomView`).
- `2026-07-06` codex: split the queue/judging surface. `/queue` is now the
  operations dashboard (all rooms, queue generation, admin assignment summary)
  and `/judging` hosts the room-specific panel. Added challenge `devpostTags`
  editing on the challenge forms, backend `POST /api/queue/challenges/enqueue-all`,
  and a reusable DevPost tags field.
- `2026-07-06` codex: verification update after the split — `pnpm --filter
  @hackos/web typecheck` and `pnpm --filter @hackos/api typecheck` are clean;
  `biome check` is clean on touched files. API vitest could not run because the
  test PostgreSQL instance at `localhost:5433` was not available in this
  environment.
- `2026-07-06` codex: resumed after Claude rate-limit. Removed stray generated
  `</content>`/`</invoke>` markers from WS-C TV files. `pnpm --filter
  @hackos/web typecheck` clean afterward.
- `2026-07-06` codex: implemented WS-B MVP at `apps/web/src/app/(app)/queue/page.tsx`.
  Includes live room selector, room pause/resume, queue called/next panels,
  call-next/notify/bring-in/requeue/no-show/skip/manual-call actions, search,
  presentation start/complete/send-back, review draft/submit with session
  presence, progress counts and CSV export links. Also corrected `@/lib/queue`
  wrappers for `callNext`, pause/resume idempotency headers, typed reviews,
  sessions and search results. Remaining WS-B follow-up: dedicated room-admin
  CRUD/assignment/settings screens (QUEUE_ADMIN).
- `2026-07-06` codex: added `/queue/rooms` admin page and queue admin wrappers
  for room CRUD, room queue state, queue settings, and assignment mutations.
  H46 now has a backend read surface for room challenge/judge assignments, so
  inspect-before-edit is available.
- `2026-07-06` codex: H21 project detail is now editable. `projects/[id]/page.tsx`
  can add/remove team members and attach/detach challenge queue entries, and
  the backend reads current team membership from `submissions` plus active
  queue memberships from `queue_entries`.
- `2026-07-06` codex: per user request, discarded the TV route tree (`apps/web/src/app/tv`)
  and deleted the WS-C progress doc. `/tv` now 404s again.
- `2026-07-06` codex: completed missing WS-A routes that the progress file listed
  but the filesystem did not contain: `projects/[id]/page.tsx` read-only detail
  and `projects/unmatched/page.tsx` for H17 manual link, claim email, and
  prize→challenge mapping.
- `2026-07-06` codex: verification: `pnpm --filter @hackos/web typecheck` clean;
  `npx @biomejs/biome check ...` clean across touched web routes/libs/docs. Note:
  `pnpm --filter @hackos/web lint` currently fails because the package script is
  `next lint`, which Next 16 treats as an invalid project directory; use root
  `pnpm lint`/Biome until that script is updated.
- `2026-07-06` codex: reviewed the old judging implementation in
  `/Users/dani/hackathon-os/hackOS copy/frontend/features/judging/components`
  (`QueuePanel`, `PresentationCard`, `ScoringForm`, `TeamInfoSection`,
  `DynamicFormField`, `StatChip`) and reworked `/judging` to mirror that
  structure with current hackOS components: room controls + compact stats at
  the top, waiting-room/challenge queue on the left, current presentation in the
  center, and scoring/progress on the right. Backend room views now include repo
  links, description, and team-member metadata for that presentation card.

<!--
Agents: append dated bullets here. Record decisions (e.g. where WS-D lives),
committed interface signatures other WS depend on, blockers, and % done per WS.
-->
