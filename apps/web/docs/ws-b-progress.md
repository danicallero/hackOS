# WS-B — Queue & Judging panel (H29-H40) progress

Owner: Codex · Status: ✅ implementation complete

## Built

- `apps/web/src/app/(app)/queue/page.tsx`
  - Now the operations dashboard: all room queue snapshots, live counts, room
    assignment summaries for admins, and manual queue generation for all tagged
    challenges.
  - `/queue` is no longer the judging surface; it points to operations only.
- `apps/web/src/app/(app)/judging/page.tsx`
  - The room-specific judging/controller surface copied from the former combined
    panel. It keeps room selector, queue actions, presentation/review controls,
    progress and CSV export links.
  - Reworked to mirror the old `hackOS copy` judging structure after reviewing
    `QueuePanel`, `PresentationCard`, `ScoringForm`, `TeamInfoSection`,
    `DynamicFormField`, and `StatChip`: top room controls + compact stats,
    waiting-room queue on the left, current project/presentation in the center,
    scoring/progress on the right.
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
- `pnpm exec biome check ...` on touched web files — clean.
- `pnpm --filter @hackos/api typecheck` — clean.

## Remaining

- Runtime E2E against a seeded API/database was not performed in this session.
