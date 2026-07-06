# WS-D — Participant "my queue" status (H38)

Owner: WS-D agent · Branch: `feature/judging` · Status: ✅ built, verified in scope

Participant-facing live view of `GET /api/queue/me` + `GET /api/queue/me/stream`.
No capability gate — auth only (placed under `(app)`, per plan §8).

## Files

- **`apps/web/src/app/(app)/my-queue/page.tsx`** (new) — the page.
- **`apps/web/src/lib/nav.ts`** (edited, minimal) — added `TicketIcon` import and
  a "My queue" (`/my-queue`) nav item next to "My applications" in the first
  section (participant-facing, no capability). Only nav.ts edit for WS-D.

Imports only WS0/shared pieces — nothing redefined:
`useEventSource` / `useLiveQuery` / `SseEnvelope` (`@/hooks/use-event-source`),
`getMyQueue` + `MyQueueEntry` (`@/lib/queue`), `QueueStatusBadge`
(`@/components/common/queue-status-badge`), `PageHeader` / `SectionCard` /
`EmptyState` / `Spinner`, `ApiError`, `textForDisplay` (challenges/shared).

## What works

- **Live list** via `useLiveQuery(getMyQueue, "/api/queue/me/stream",
  [USER_QUEUE_CALLED, USER_QUEUE_PRECALL])` — fetch on mount, debounced refetch
  on each per-user event and on reconnect (plan §4 recovery contract).
- **Per row**: challenge title (rendered via `textForDisplay` — the API's
  `challenge.title` may be a string OR an `{es,en}` i18n record; WS0 types it as
  `string`, so we cast to `TranslatedText`), repo name, `QueueStatusBadge`,
  position `#n` and ETA (only while `waiting`), and room (once assigned).
- **Called → prominent notice**: a `success`-toned banner per called entry —
  "It's your turn — head to <room>". Names the room from the SSE `roomName`
  (the read model only exposes `roomId`; we cache `roomId → roomName` from the
  `user.queue.called` payload and fall back to `room #<id>`).
- **Pre-call → heads-up**: a `warning`-toned banner for entries still `waiting`
  whose challenge received a `user.queue.precall`. Pre-call is an event, not a
  read-model field, so we track precalled challenge ids in local state and clear
  one when its `called` event arrives.
- **Toasts (sonner)**: `toast.success` on call (12s), `toast(...)` on pre-call;
  de-duped per entry id via a ref so debounce/StrictMode don't double-fire.
- **EmptyState** when the user has no queued projects; error surfaces the
  `ApiError.message` verbatim via `toast.error`.

## Design notes / decisions

- Tones only, no hardcoded hex — banners use `success`/`warning` theme tokens
  (`border-success/40 bg-success/10 text-success`, etc.), matching `tones.ts`.
- Two SSE subscriptions to `/api/queue/me/stream`: one inside `useLiveQuery`
  (data refetch, as the task specified), one via `useEventSource` (toasts +
  room-name/pre-call capture, which `useLiveQuery` doesn't expose). Both are the
  designed-for composition of the WS0 hooks; per-user topic, low volume.

## Verification

- `npx tsc --noEmit` (apps/web): **no errors in `my-queue` or `nav.ts`**.
- `npx @biomejs/biome check --write "apps/web/src/app/(app)/my-queue"
  apps/web/src/lib/nav.ts` → clean (fixed import ordering once).

## Left / not in scope

- No live runtime click-through (no dev server / seeded queue exercised here) —
  logic verified by types + read-model/event contract review.
- TV mode / operator control was discarded after the handoff; WS-D does not
  depend on it.
