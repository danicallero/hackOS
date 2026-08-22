# Notifications & announcements

The `notifications` module (`apps/api/src/modules/notifications/`) covers two
related things: **announcements** (H50 — staff-authored content that can be
shown on screens, delivered as a notification, or both) and the generic
**notify/outbox/dispatch** pipeline every other module uses to send a
notification (H51 preferences, H52 email delivery, H53 audit).

## The announcement model

An announcement (`announcements` table) has three mostly-independent axes:

1. **Screen placement** — `screen_placement`: `none | embedded | fullscreen`.
   Governs whether/how it appears on the venue's TV walls
   (`docs/tv-screens.md`) via the anonymous public feed
   (`GET /api/announcements/public`, `listAnnouncementsPublic`).
2. **Delivery** — `notify_users`: whether it also fans out as a notification
   (inbox/email/push) to its resolved recipients.
3. **Targeting** — who a delivery reaches, when `notify_users` is true.

These are set independently: a purely informational screen banner
(`notify_users = false`) needs no targeting at all; a pure notification
(`screen_placement = 'none'`) needs no screen config.

### The visibility window vs. the notify fire time

`publish_at`/`expires_at` is the **screen's** visibility window — when a
screen-placed item appears and disappears on its own, unattended (H50: "la
cena está lista" now, gone in 30 minutes). This window is unrelated to
delivery: it still governs `listAnnouncementsPublic` regardless of
`notify_users`.

A **notify-only** announcement (`screen_placement = 'none'` and
`notify_users = true`) has no such window — it fires once at `publish_at` (or
immediately if null) and that's it. `expires_at` is rejected for that specific
combination, both by a DB `CHECK` (`announcements_no_expiry_when_notify_only`,
migration `0722`) and by Zod validation
(`schemas.ts`). A `screen_placement = 'none'` row that *isn't* a notification
(`notify_users = false`) can still carry an `expires_at` as an ordinary
content-feed window — the constraint only tightens the notify-only case.

When an announcement is **both** screen-placed and a notification, nothing
special happens: the window still governs the screen, and the notify fan-out
is a one-shot side effect of the row becoming visible for the first time —
`fanned_out_at` (set once, checked by `fanOutIfVisibleNow` and the
publisher's claim query) guarantees it never repeats, even though the row
stays on-screen for the rest of its window.

### Targeting

Delivery reaches one of three mutually exclusive audiences, resolved by
`resolveRecipients` in `announcements-service.ts`:

- **Everyone** (default): `audiences = []` and no `announcement_recipients`
  rows.
- **Audience tags**: `audiences` (`text[]`, values `sponsor | participant |
  mentor`) — the same vocabulary as schedule's H59 audiences
  (`docs/schedule-categories.md` doesn't cover this; see
  `apps/web/src/app/(app)/schedule/schedule-model.ts`'s `SCHEDULE_AUDIENCES`).
  `sponsor` implies `participant`, matching schedule's own rule. Resolved in
  one SQL query against `manual_attendee_roles`, `application_responses` /
  `applications`, and `sponsors` — no per-user round-trips.
- **Specific recipients**: an explicit list in the `announcement_recipients`
  join table (`announcement_id, user_id`). Rejected together with `audiences`
  (choose one), and rejected together with a non-`none` `screen_placement` —
  the TV wall is anonymous, so "screen-placed and only visible to some
  accounts" isn't a real state.

Picking specific recipients needs an account search: `GET
/api/announcements/recipient-candidates` (`listAnnouncementRecipientCandidates`)
is gated by `ANNOUNCEMENTS_MANAGE` alone, deliberately not the broader
`USERS_READ` — same reasoning and shape as schedule's own
`/api/schedule/owner-candidates` (H59). Don't point the recipient picker at
the generic `/api/users` (that one requires `USERS_READ`, a capability an
announcements manager may not hold).

### Channels

`channels` (`text[]`, values from `in_app | email | push`) is the
**candidate** set staff picks at creation time — not a bypass. Each
recipient's own H51 preferences still filter it further via
`resolveChannels()` in `service.ts`; a category can only bypass preferences
entirely by being `queue` (operational queue notifications, H51 — unrelated
to announcements). `channels` is stored as plain `text[]` rather than an
array of the `notification_channel` enum: node-postgres has no array parser
for custom enum OIDs out of the box (only `text[]` and other built-in array
types deserialize to a JS array automatically), so a `CHECK` constraint
(`announcements_channels_valid`) plus Zod enforce the allowed values instead
— the same pattern `audiences` already uses.

## The generic notify pipeline (H51/H52/H53)

Any module can send a notification via:

```ts
import { notify } from "../notifications/service.js";
await notify(client, { userId, category: "application.decision", payload: {...} });
```

`notify()` expands the requested candidate channels through
`notification_preferences` (`resolveChannels`) and inserts one
`notification_outbox` row per resulting channel — it never sends anything
itself. Two background workers do the actual work:

- `notifications-outbox` (`dispatcher.ts`, every 5s) drains queued/due
  outbox rows with `FOR UPDATE SKIP LOCKED`, dispatches per channel
  (`channels/{email,in-app,push}.ts`), and retries with exponential backoff.
- `announcements-publisher` (`announcements-publisher.ts`, every 15s) polls
  announcements whose visibility window just opened and haven't fanned out
  yet, and fans them out — the counterpart to the immediate fan-out that
  happens at create/update time when a row is already visible.

`STATIC_CATEGORIES` (`service.ts`) lists the categories every user sees in
their preferences matrix even with zero override rows; `queue` is the one
mandatory (non-optional) category (H51).

## Web admin UI

`apps/web/src/app/(app)/announcements/` — a list page
(`page.tsx`) that opens `AnnouncementFormModal`
(`announcement-form.tsx`) for both create and edit, mirroring the schedule
module's modal pattern (progressive sections, a 3-way targeting selector
instead of two independently-toggleable blocks so the audience/specific-user
exclusivity is visible in the UI, channel checkboxes, and a publication
section whose fields change shape depending on `screenPlacement`/targeting
mode). There are no dedicated `/announcements/new` or `/announcements/[id]`
routes.

## Mobile admin UI

Reached from the Notifications tab (`apps/mobile/app/(tabs)/notifications.tsx`):
holding `ANNOUNCEMENTS_MANAGE` adds a third "Manage" segment next to
Messages/Preferences, with a header Add button and
`ManageAnnouncementsView` (`components/announcement-manage-view.tsx`) — a
swipeable list (`ScheduleSwipeRow`, reused from the Schedule tab) whose
edit/Add actions open `AnnouncementFormModal`
(`components/announcement-form-modal.tsx`), which mirrors the web admin
form field-for-field, same as `ScheduleFormModal` does for schedule items.
`lib/announcements-admin.ts` holds the admin API client, including
`fetchAnnouncementRecipientCandidates` against the `ANNOUNCEMENTS_MANAGE`-scoped
candidates endpoint above.
