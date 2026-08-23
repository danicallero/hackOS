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
  mentor | staff`) — the first three reuse schedule's H59 vocabulary
  (`docs/schedule-categories.md` doesn't cover this; see
  `apps/web/src/app/(app)/schedule/schedule-model.ts`'s `SCHEDULE_AUDIENCES`);
  `staff` is announcement-specific and means "holds at least one capability"
  — the same definition `getEffectiveCapabilities`/`computeDerivedRole` use,
  inlined as a recursive CTE over `permission_group_members` +
  `permission_group_includes` + `group_capabilities` (unlike schedule, where
  staff always sees everything and is never a *stored* tag — here it has to
  be storable since it's a delivery target, not a visibility rule).
  `sponsor` implies `participant`, matching schedule's own rule. Resolved in
  one SQL query against `manual_attendee_roles`, `application_responses` /
  `applications`, `sponsors`, and the capability CTE — no per-user round-trips.
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

## Automatic translation (optional)

`translations` (`title`/`body` per `es | gl | en`) can be filled by hand, or
staff can write the content in whichever of the three languages comes
naturally and hit "Translate automatically" to machine-translate the rest —
both frontends detect the first non-empty language as the source and only
fill languages that are still empty, never overwriting a manual edit.

The provider is fully optional and isolated behind
`modules/notifications/translate/`: `translateFields()` /
`isTranslationAvailable()` in `translate/index.ts` are the only functions
anything else calls, dispatching on `TRANSLATE_PROVIDER` to either the
Google Cloud Translation v2 adapter (`translate/google.ts`,
`GOOGLE_TRANSLATE_API_KEY`) or a self-hosted LibreTranslate adapter
(`translate/libretranslate.ts`, `LIBRETRANSLATE_URL` +
`LIBRETRANSLATE_API_KEY`, see `docs/env-vars.md`) — mirroring the
`MAIL_PROVIDER` adapter split in `channels/email-adapters/`. `translateFields`
is field-shape-agnostic (announcements pass `{title, body}`, schedule passes
`{title, description}`) so a third translatable entity needs no provider
change. `GET /api/announcements/translate-availability`
lets both frontends hide/disable the action when unset instead of offering
one that will 503; every translation surface keeps working with manual-only
entry regardless of whether a provider is configured. Exercised in tests via
a stubbed `global.fetch`, never a live network call (same convention as the
Resend email adapter).

### Schedule item translation (H50 extension)

Schedule items (`logistics/schedule.ts`) get the same treatment, but with the
challenges (H44) per-field `_i18n` jsonb-column convention instead of
announcements' single blob: `schedule.title_i18n` / `schedule.description_i18n`,
keyed by locale, so a title and description can be filled independently.
`schedule.primary_language` records which language `title`/`description` were
authored in — the canonical columns are that language's mirror, not a fixed
English lock. **There's no language picker in either client**: the main
Title/Description field always resolves into the *viewer's own* account
language, not a fixed "primary" — editing an item authored in another
language shows/edits that viewer's translation (blank if none exists yet),
never a foreign-language value under a mismatched label
(`scheduleItemToForm`/`scheduleItemToTranslations` on both frontends).
Saving from the full edit form re-anchors `primary_language` to the editor's
own account language server-side (`reanchorPrimaryLanguage` in
`updateScheduleItem`): the *previous* primary language's canonical text is
preserved as a normal translation entry rather than lost, and the new
canonical text (in the editor's own language) is dropped from the i18n map so
it isn't duplicated in both places — mirrored onto the linked `activities`
row the same way. This only fires when the request actually includes `title`
(the full edit form always does; a partial patch — reschedule, audience
toggle, drag-to-a-new-day — never touches language anchoring). `createScheduleItem`
sets `primary_language` the same way, from the author's own account language
at creation (`getUserLanguage`). Every translate call passes `source: "auto"`
down to the provider (`translateFields` in `translate/index.ts`; Google's v2
API auto-detects when `source` is omitted, LibreTranslate accepts the literal
`"auto"`), so what actually gets translated is whatever was typed, not an
assumption pinned to the account language.

Translation is content-scoped, not id-scoped: `POST /api/schedule/translate`
(`translateScheduleContent`) takes a title/description directly and returns
translations without touching the database, so both the create and edit forms
can call it before the item is even saved. Automatic translation only ever
fills a **blank** locale — callers are responsible for excluding any locale
that already has translated text (mirrors announcements' "only fill languages
that are still empty" rule); to redo one, clear it by hand first. Creating a
schedule item (`createScheduleItem`) also auto-translates in the background
right after insert whenever a provider is configured — this is what makes the
manage table's quick "New item" row (title-only, no UI for translations of
its own) come out translated with no extra client-side wiring. `PUT
/api/schedule/:id/translations` (`saveScheduleTranslations`) persists
whatever it's given unconditionally (manual edits are trusted input, not
subject to the blank-only rule) and mirrors the result onto the item's linked
`activities` row (`name_i18n`/`description_i18n`) — the same mirroring
`updateScheduleItem` already does for the canonical title/description, so the
H25/H26 scanner station and activity tracker see translated labels too, with
no separate translate action of their own.

Every schedule read (`listSchedule`, `listScheduleForAudiences`) returns
`primaryLanguage` + `titleI18n`/`descriptionI18n` so every viewer — not just
an editor — can resolve their own display text: preferred language, else
English, else `primaryLanguage`'s canonical text. `resolveScheduleText`
(`apps/web/src/lib/logistics.ts`, `apps/mobile/lib/schedule.ts`) implements
that fallback client-side; every viewer-facing schedule read (web
`/timetable`, `/horario`, the TV display; mobile's Schedule tab and detail
screen) resolves through it before handing items to their renderers, so those
renderers keep reading plain `item.title`/`item.description` unchanged.
`ScheduleFormModal` (both frontends) labels Title/Description with the
viewer's own account language (no control to change it) plus a translations
panel — collapsed by default, an auto-translate action stays visible either
way — covering the other two locales (only the still-blank ones are
requested; a locale with translated text is never silently overwritten) or
hand-edit. Staged locally in create mode and persisted right after the item
is created; in edit mode it's pre-populated from the item's existing
translations plus its previous primary-language text (now just another
locale from this viewer's perspective), and persisted alongside the
re-anchoring save.

Known gap: the mobile scan-station UI (`components/activities-screen.tsx`,
`activity-scanner-screen.tsx`) reads `ScannerActivity` from the offline SQLite
sync snapshot (`scanner-sync.ts`/`scannerSnapshot()`), a separate pipeline
from `scannableActivities()` above — the snapshot schema doesn't carry
`primaryLanguage`/`nameI18n`/`descriptionI18n` yet, so those two screens don't
show translated activity names even though the underlying `activities` row
does. Wiring that through the offline sync schema is unstarted follow-up.

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
candidates endpoint above, plus `fetchTranslateAvailability`/`translateAnnouncement`
for the same optional auto-translate action as web. Each language's Title
field has `returnKeyType="next"` chained to its own Message field
(`bodyRefs`) — a multiline field's own return key inserts a newline instead,
so the chain stops there rather than trying to jump languages.
