# WS-B — Queue & Judging panel (H29-H40) progress

Owner: Codex · Status: 🔵 MVP built, review needed

## Built

- `apps/web/src/app/(app)/queue/page.tsx`
  - Live room selector and challenge selector.
  - Room pause/resume (H35) and pace display (H39).
  - Queue panel for called + next teams with call-next, notify-enter, bring-in,
    requeue, no-show and skip actions (H29-H34).
  - Search/manual recovery by project/repo/entry with manual-call to `called` or
    `in_room` (H37).
  - Presentation panel with start/complete/send-back controls (H32-H33).
  - Scoring form from `judging_panel_criteria`, review draft save, submit, and
    active judging session presence (H36).
  - Challenge progress tab and CSV export links (H40).
- `apps/web/src/app/(app)/queue/rooms/page.tsx`
  - Room CRUD, queue settings, room queue state edits, and assignment forms
    for room challenges and judges, plus authoritative assignment lists from
    the backend read surface (H46).
- `apps/web/src/lib/queue.ts`
  - Corrected `callNext` signature to backend `{ force? }`.
  - Added idempotency headers to pause/resume wrappers.
  - Typed review/session/search wrappers and fixed session join body.
  - Added room/admin and queue-settings wrappers used by `/queue/rooms`.

## Verification

- `pnpm --filter @hackos/web typecheck` — clean.
- `npx @biomejs/biome check ...` on touched web files — clean.

## Remaining

- Runtime E2E against a seeded API/database was not performed in this session.
