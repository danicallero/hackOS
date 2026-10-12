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

Delivery reaches one of three mutually exclusive targets, resolved by
`resolveRecipients` in `announcements-service.ts`:

- **Everyone** (default): no `roleIds`, no `intoleranceIds`, and no
  `announcement_recipients` rows.
- **Roles, optionally narrowed by food intolerances**: `roleIds` selects the
  current holders of one or more active H8 roles; `intoleranceIds` further
  narrows that set to people whose `users.food_intolerances` overlaps the
  selected dictionary IDs. Either filter can stand alone. Both are resolved in
  one query at fan-out time, so scheduled notices follow current role
  assignments and dietary declarations rather than a stale recipient snapshot.
  The role picker gets its minimal catalogue from
  `GET /api/announcements/targeting-options`, scoped to
  `ANNOUNCEMENTS_MANAGE` rather than `PERMISSIONS_MANAGE`; intolerance choices
  come from the existing public food-intolerance dictionary.
- **Specific recipients**: an explicit list in the `announcement_recipients`
  join table (`announcement_id, user_id`). Rejected together with role/dietary filters
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
(`announcements_channels_valid`) plus Zod enforce the allowed values instead.

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

Application re-accepts (`POST /api/responses/:responseId/re-accept`, H14/H15)
use this same pipeline with category `application` and the candidate channels
`in_app`, `email`, and `push`. The user's preferences still filter those
optional channels. The payload is the `application.decision` template and the
acceptance email contains the fresh confirm/decline links for the new token.
The route accepts `Idempotency-Key`, so a client retry replays the state change
without creating another set of notification rows. Batch re-accept uses the
same contract for the whole request.

Push batches are sent to every current token for the user. A batch is marked
`sent` when at least one Expo ticket succeeds; that only means Expo accepted
the message, not that FCM/APNs delivered it to the device. When either
diagnostic logging flag is enabled, the worker performs a short best-effort
receipt poll and logs provider errors. A `DeviceNotRegistered` ticket or
receipt removes that token from `push_tokens`.

When ticket logging is enabled, every provider ticket and available receipt is
logged by the worker with its status, ticket ID, category, and platform. In
this redacted mode, token values and notification content are never logged.
This avoids retrying a push to a device that already received it, while still
showing partial failures in the worker log.

Ticket logging is disabled by default. Set `LOG_EXPO_PUSH_TICKETS=true` on the
API in inline-worker mode and on the worker in production when investigating
delivery; restart the relevant process after changing it. The log includes only
redacted provider metadata, so notification tokens and message content remain
out of logs. Receipt errors such as FCM credential failures are included.

Push-token registration logging is separately disabled by default. Set
`LOG_EXPO_PUSH_TOKENS=true` on the API to log successful registrations with the
user ID, platform, and a short token suffix hint. The full token is never
logged.

For a deliberately unsafe, full-debug trace, set
`LOG_EXPO_PUSH_UNSAFE_DEBUG=true` on the API in inline-worker mode and on the
worker in production. This logs the complete device token, message payload,
Expo request/response, receipt response, user ID, and ticket details. It is
disabled by default and should be turned off immediately after debugging,
followed by a process restart. A receipt may still be pending when the short
poll finishes; Expo can make receipts available later.

## Automatic translation (optional)

`translations` (`title`/`body` per `es | gl | en`) can be filled by hand, or
staff can write the content in whichever of the three languages comes
naturally and hit "Translate automatically" to machine-translate the rest —
both frontends detect the first complete language as the source and only
fill languages that are still empty, never overwriting a manual edit.
Saving only requires one complete language; when the other languages are blank,
that language becomes the canonical fallback and is delivered to recipients
whose language has no translation. Partial language entries still need both
title and body before saving.

The provider is fully optional and isolated behind
`modules/notifications/translate/`: `translateFields()` /
`isTranslationAvailable()` in `translate/index.ts` are the only functions
anything else calls, dispatching on `TRANSLATE_PROVIDER` to either the
Google Cloud Translation v2 adapter (`translate/google.ts`,
`GOOGLE_TRANSLATE_API_KEY`) or a self-hosted LibreTranslate adapter
(`translate/libretranslate.ts`, `LIBRETRANSLATE_URL` +
`LIBRETRANSLATE_API_KEY`, see `docs/env-vars.md`) — mirroring the
the email adapter boundary in `channels/email-adapters/`. `translateFields`
is field-shape-agnostic (announcements pass `{title, body}`, schedule passes
`{title, description}`) so a third translatable entity needs no provider
change. `GET /api/announcements/translate-availability`
lets both frontends hide/disable the action when unset instead of offering
one that will 503; every translation surface keeps working with manual-only
entry regardless of whether a provider is configured. Exercised in tests via
a stubbed `global.fetch`, never a live network call.

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
(the full edit form always does; a partial patch — reschedule, recipient
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

The mobile scan-station UI (`components/activities-screen.tsx`,
`activity-scanner-screen.tsx`) doesn't read `scannableActivities()` — it reads
`ScannerActivity` from the offline SQLite sync snapshot
(`scanner-sync.ts`/`scannerSnapshot()`), a separate pipeline built for
disconnected operation. That snapshot carries the same three fields
(`primaryLanguage`/`nameI18n`/`descriptionI18n`, mirrored from the linked
schedule item same as everywhere else) so those screens show translated
activity names too. On the wire this is JSON like anywhere else; on-device
the roster lives in encrypted SQLite (`scanner-db.native.ts`), where the two
jsonb maps are stored as `TEXT` columns (`JSON.stringify`/`JSON.parse` at the
read/write boundary — SQLite has no native map type) — `addScannerActivityI18nColumns`
widens a pre-existing `scanner_activities` table with `ALTER TABLE` the first
time a device that synced before this change reopens its roster db (the table
is otherwise `CREATE TABLE IF NOT EXISTS`, a no-op against an already-existing
table, and rows are always replace-all on every sync, but the *schema* itself
only ever gets created once). Both screens resolve the viewer's display text
through `resolveActivityText` (`lib/scanner-types.ts`, mirroring
`resolveScheduleText`'s fallback: preferred language, else English, else
`primaryLanguage`'s canonical `name`) before rendering.

## Web participant UI

The inbox renders each message as its own bordered row surface (unread rows get
a faint primary tint). Subjects lead each row, timestamps sit beside them on desktop
and below on narrow screens, and previews stay muted. Unread dots and subject
weight distinguish unread messages. Opening a row
marks it read and reveals selectable body text, optional payload details and a
delete action with confirmation. Preferences use one row per category with
a checkbox menu for the existing in-app, email and push channels. Queue calls
remain read-only and always enabled (H51): their row shows "always on" beside
the label and a lock in the same trailing gutter the menu rows use for their
caret, so values align down the column. Activity and kind reminders share a
separate open section. Its Add reminder action opens a dialog with searchable
activity and activity-kind comboboxes; selecting an option subscribes immediately
on the existing default channels and closes the dialog after success. Active
reminders retain their queued removal and retry flow.

## Web admin UI

`apps/web/src/app/(app)/announcements/` — a list page
(`page.tsx`) that opens `AnnouncementFormModal`
(`announcement-form.tsx`) for both create and edit, mirroring the schedule
module's modal pattern (progressive sections, a 3-way targeting selector for
everyone, role/dietary filters, or specific people so exclusivity is visible
in the UI, channel checkboxes, and a publication
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

## Transactional email theme (H7, H52)

Every email uses the common wrapper in `notifications/templates.ts`, aligned
with the active edition in `apps/web/src/styles/theme.css` and
[`DESIGN.md` §2](./DESIGN.md#2-foundation-tokens). Email clients need inline,
resolved colors rather than CSS variables: light mail uses a blue-tinted shell,
cream card, ink text, subtle borders and 8px surfaces. Primary actions
are red/cream pills in both themes; dark canvas, card, footer and borders
mirror the web's semantic pairs.
The header shares the card surface in both schemes, without a decorative top
rule. Its centered, responsive HackUDC 2027 marketing wordmark comes from the
supplied edition SVGs: red `logo_h-white.svg` for
light mail and cream `logo_h-white (4).svg` for supported dark-mode clients.
Original vectors and 720px-wide transparent PNG exports are hosted under
`public/email/hackudc-2027{,-dark}.{svg,png}`. PNGs preserve compatibility;
clients without dark-mode CSS use the red logo. The previous `brand-mark.png`
stays available for images in already-sent messages. The footer retains hackOS as the sending
platform. Edition red is the action accent, independent of admission outcome.

Body text uses an Inter/system sans stack; 24px regular Rockwell headings load
from the web's existing font asset and fall back to Georgia. Clients that block
webfonts retain readable system typography. Narrow layouts reduce padding and
expand action links, including long verification labels. The document language
and automated-message footer follow the recipient's es/gl/en language. The
footer warns recipients to ignore unexpected messages and avoid following
links, says the sender does not receive incoming messages, and links to the
organization at `hackudc@gpul.org`. This footer also appears in the outgoing
plain-text MIME part; inbox and push message bodies retain just the message.
Subject, preheader, escaping and action URLs are preserved.
These are transactional messages: campaign tracking and unsubscribe controls
from marketing templates do not belong in this shared wrapper.

Account-setup emails (H9/H10) identify the staff member sending or resending
access and the configured event. They explain how to complete account creation
without mentioning passwords, list the explicitly assigned roles (singular or
plural), and name the linked company for sponsors. Context is captured when
queued, using current active roles; the account claim remains the authority for
actual grants. The participant label alone does not promise form access.
Older queued invitations fall back to the localized organizers label and event
fallback without unresolved placeholders. All three languages share this copy.

### Message voice and admission decisions (H7, H14, H15, H52)

`eventName` identifies the configured event; `applicationName` identifies the
application form. The applications service supplies both independently for
acceptance and rejection. If no event name is configured, it uses the same
organization-name fallback as Wallet (`APPLE_PASS_ORGANIZATION`). Older queued
payloads without `eventName` also use that fallback rather than leaking an
unresolved placeholder.

Participant emails use a warm, direct voice. Rejection thanks the applicant,
acknowledges disappointment and welcomes interest in future editions without
inventing a reason, waiting list or promise of a place. Acceptance celebrates
with congratulations and a personal welcome, then explains that a place is
reserved pending confirmation, how to decline and the automatic release at
the deadline. Operational queue alerts and security instructions remain precise.

`application.decision` stays the outbox template name; the renderer selects
complete `accepted`/`rejected` subject/body variants in es/gl/en from the internal
decision variable, so raw status keys never appear in participant messages.
This also applies to existing queued decisions. Confirmation details and the
exact token expiry are localized when the applications service creates the
payload. The deadline includes day, month,
year, time and zone in the configured event timezone (UTC if unset), rather
than a relative duration that would become stale during delivery. Expiry and
zone are retained in the payload for traceability; existing queued acceptance
details retain their stored text.

Emails put the outcome first, then required actions/deadlines, then security
notes or a courteous sign-off. Authentication mail omits the repeated spam
advice. Admission rejection leads with a considerate, unambiguous outcome and
closes with thanks and an invitation to future editions. Email correspondence
uses edition red as a brand/action accent in both themes, not as a status color;
this is deliberately separate from the web's ink/blue primary control pairing.

### Scheduled pre-event entrance reminder

`event.reminder` is an email-only operational template scheduled from Event
settings (see [event configuration](./event-config-wallet.md#pre-event-email-reminder-h45-h52)).
The send adapter resolves event data and live ticket entitlement at dispatch,
formats the opening date/time in the recipient's language and event timezone,
and attaches the permanent entrance QR as inline `ticket.png` using
`cid:event-ticket@hackos`. Official Wallet badge PNGs are exports of the same
SVGs used in the web wallet. Revoked access or an event that has already opened
supersedes the queued email. The existing outbox handles delivery and retries.
