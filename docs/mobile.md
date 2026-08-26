# Mobile app (`apps/mobile`)

Native Expo Router client for hackOS: Better Auth session continuity,
capability-driven tabs, participant-facing screens, authenticated realtime,
and offline SQLite scanners for accreditation, badge rotation, presence,
meals, and registrable activities.

For development builds, prebuild/CNG, EAS profiles, signing, certificates,
store assets, submission, and the release checklist, see
[`mobile-release.md`](./mobile-release.md).
The browser/native UI test framework and device prerequisites are in
[`ui-testing.md`](./ui-testing.md).

The pre-pilot Detox fixture and complete critical-flow command are documented
there. Device coverage drives accreditation, meals, and recordable activities
through stable IDs from `@hackos/shared/ui-test-ids`; ordinary CI remains on
the hardware-free native screen suite.

## Contents

- [Story index](#story-index)
- [Backend changes](#backend-changes)
- [Navigation & tabs](#navigation--tabs)
- [Auth flow](#auth-flow)
- [Participant screens](#participant-screens)
- [Operator screens](#operator-screens)
  - [Queue operations](#queue-operations)
  - [Scanner](#scanner)
  - [Activities](#activities)
- [Scanner cache encryption & isolation](#scanner-cache-encryption--isolation)
- [Realtime & notifications infrastructure](#realtime--notifications-infrastructure)
- [Other infrastructure](#other-infrastructure)
- [UI testing](#ui-testing)
- [Scanner state transitions](#scanner-state-transitions)

## Story index

Quick lookup from a user story to where it's implemented; each area is
documented in full in its own section below.

| Story | Area | See |
| --- | --- | --- |
| H4 | Session continuity, offline-tolerant `/api/me` | [Auth flow](#auth-flow) |
| H55 | Capability-driven tab bar, no-reinstall permission changes | [Navigation & tabs](#navigation--tabs) |
| H38 | Queue status/ETA, pre-alert, call notice | [Participant screens](#participant-screens) |
| H29–H31 | Queue operations: rooms, called teams, re-notification | [Queue operations](#queue-operations) |
| H51 | Notification channel preferences per category | [Participant screens](#participant-screens) |
| H50 | Announcement admin CRUD (audience/recipient targeting, channels, screen placement) | [Participant screens](#participant-screens) |
| H59 | Horario admin CRUD, audience filter, category notifications | [Participant screens](#participant-screens) |
| H28 | Apple & Google Wallet, badge-rotation invalidation | [Participant screens](#participant-screens) |
| H22 | Accreditation scanner | [Scanner](#scanner) |
| H23 | Badge replacement, offline-first, deferred revocation sync | [Scanner](#scanner) |
| H24 | Presence (door in/out) scanner, manual back-dated entries | [Scanner](#scanner) |
| H25 | Meals scanner, repeat-serving confirmation | [Scanner](#scanner) |
| H26 | Registrable-activity scanner | [Scanner](#scanner), [Activities](#activities) |

## Backend changes

**Schema.** One new column-free addition: `push_tokens` (already existed,
`apps/api/db/migrations/0001_initial.sql`) is now actually written to, via the
route below. No migration needed.

**Endpoints / hooks.**
- `POST /api/me/push-tokens` (`apps/api/src/modules/notifications/routes/push-tokens.ts`)
  — upserts the caller's Expo push token; re-registering the same
  token (app restart, re-login) reassigns it rather than duplicating rows.
- `expo()` plugin on the Better Auth instance
  (`apps/api/src/modules/identity/auth.ts`), paired with the client's
  `expoClient()` (`apps/mobile/lib/auth-client.ts`) — overrides the Origin
  header on the app's auth requests to `MOBILE_APP_SCHEME://` (config env var,
  default `hackos`), which must be in `trustedOrigins` for mobile sign-in to
  pass Better Auth's origin check.
- `dispatchPush` (`apps/api/src/modules/notifications/channels/push.ts`) now
  includes `category` and `template` alongside the template `vars` in every
  push message's `data` field, so a client can route a tap or decide whether
  to refetch without guessing from the vars shape. `notifyTeamPreCall`
  (`apps/api/src/modules/queue/notify.ts`) was rewritten to go through the
  shared `notify()` helper with a real `queue.precall` template (it previously
  inserted a templateless, push-only outbox row directly — the pre-alert had
  no rendered subject/body and never reached in_app/email).
- The app also calls these existing endpoints:
  `GET /api/me` (capabilities + language + badgeId), `GET /api/public/activities`
  (schedule), `GET /api/queue/me` (H38 status), `GET /api/me/ticket` (including
  the active account-specific Apple Wallet serial number for each purpose) +
  `GET /api/me/wallet/apple/:purpose.pkpass` + `GET /api/me/wallet/google/:purpose`
  (H28), `GET`/`PUT /api/me/notification-preferences` (H51).
- `GET /api/scanner/snapshot` — capability-guarded, replace-all seed for the
  device SQLite store. It contains only the lightweight person cards, ticket
  and current/revoked badge mappings, scannable activities, meal/activity
  scan counts, and last door state needed by H22-H26. A full snapshot
  is deliberate: badge-history values have no individual timestamp, and a
  complete replacement guarantees convergence after any missed refresh.
  Accounts in `removal_pending` and deleted/anonymized accounts (H54,
  `users.account_state`) are excluded, so an erased profile never syncs to a
  scanner and never resolves through
  `/api/logistics/people/search` — even by a still-active badge or ticket.
- `GET /api/logistics/scan-log` (`apps/api/src/modules/logistics/scan-log.ts`)
  — paginated, most-recent-first feed unioning accreditation check-ins,
  presence door-scans, and activity/meal scans by the *actor* who performed
  them (extends H22-H27; not a new story). Defaults to the caller's own
  scans; a scan-capable operator without `LOGISTICS_STATS` may only request
  their own `staffId`. Backs the mobile "scan history" screen
  (`components/scan-log-screen.tsx`), reachable through a route in the stack
  that launched it: `app/(tabs)/others/scan-log.tsx` from Account and
  `app/(tabs)/scan/scan-log.tsx` from the device-queue popup. Keeping both
  thin routes prevents Account from switching to the Scanner tab and leaves
  each history screen with a working native back action (issue #574).
- `GET /api/me/logistics/stats` — the caller's own accreditation/presence/
  activity scan counts, shown on Account for operators. `GET
  /api/logistics/stats/by-staff` is the `LOGISTICS_STATS`-gated cross-staff
  ranking (web `/logistics/stats`, "Staff ranking" section), and `GET
  /api/exports/staff-scan-stats.csv` (`exports:run`) exports the same data.
- `GET /api/scanner/role-stats` — Confirmed/Accredited/Inside counts for the
  scanner home screen's stats tiles, broken down by the same role
  classification `/api/scanner/snapshot` uses (`apps/api/src/modules/logistics/stats.ts`).
  "Confirmed" means accreditation-eligible, not the raw application
  `confirmed` flag: staff/admins/sponsors are always eligible, participants/
  mentors only once their application is confirmed
  (`isAccreditationEligible` in `lib/scanner-group-filter.ts` mirrors this
  server-side rule for the offline fallback below). "Inside" reuses
  `occupancyEstimate()` rather than re-deriving presence semantics. It is a
  direct read from the authoritative API, so the client avoids pulling and
  recomputing from the full roster snapshot on every refresh. The scanner
  home screen (`components/general-scanner-screen.tsx`) also opens the
  existing `/api/logistics/stream` SSE topic
  (`lib/server-events.ts#startLogisticsEventStream`) and refetches on any
  `LOGISTICS_ACCREDITED`/`LOGISTICS_PRESENCE_SCAN`/`LOGISTICS_ACTIVITY_SCAN`/
  `LOGISTICS_MEAL_SCAN_BATCH` event, so one device's scan updates every other
  device's tiles within about a second without polling. If the request fails
  (offline), the screen falls back to computing the same three numbers from
  the local SQLite roster — an approximation, since a stale snapshot's
  `lastPresenceKind` can lag the authoritative server-side occupancy
  estimate. The screen also gained a persisted, multi-select role-group
  filter (participants/mentors/staff incl. admins/sponsors — a custom
  always-open-until-outside-tap panel next to the people-finder button, not
  a native menu; see the component's doc comments for why) that scopes which
  rows get summed into the tiles, saved via `expo-secure-store` so it
  survives app restarts.
- `idempotencyGuard` (`apps/api/src/lib/idempotency.ts`) now reclaims a
  first-execution record whose `response_status` has been NULL for more
  than 30s, instead of 409ing "still in flight" forever. Mobile scanners
  reuse the persisted local scan id as the `Idempotency-Key` on every retry
  (`lib/scanner-model.ts`), so an interrupted first attempt (dropped
  connection, backgrounded app, server restart) used to permanently jam
  that scan — and everything queued behind it, since
  `replayPendingScans()` replays in order and stops at the first
  unresolved error — with no way to recover short of a fresh scan.
  A 5xx from the first execution is never persisted as the replayed
  result either (`idempotencyOnSend` releases the record instead of
  storing it) — a transient server failure retries and can actually
  succeed on the next attempt, rather than replaying the same 500
  forever (issue #534).

## Navigation & tabs

The reusable component contract is documented in
[`docs/router-tabs.md`](./router-tabs.md). This section documents only the
hackOS adapter: capability policy, localized destinations, and the native
`Others` menu. Keeping those concerns separate is what lets the tab shell be
distributed to other Expo Router apps without importing hackOS code.

- `lib/tabs.ts` (`primaryTabs`/`overflowTabs`) — pure functions mapping
  `me.capabilities`, `me.badgeId`, and `me.hasQueueItems` to the custom tab bar;
  see `docs/navigation.md` for the
  full model. Every platform uses `components/opaque-router-tabs.tsx` through
  the reusable `components/router-tabs.tsx` shell: iOS 26+ renders Liquid
  Glass surfaces, while earlier iOS and Android use the same geometry with
  solid surfaces. Five total destinations are shown directly on compact
  layouts; tablet-width layouts can place up to six before using `Others`,
  whose bar surface and circle become 56pt instead of 64pt. With no
  scan capability, Schedule, Wallet, Notifications, and Account are direct;
  Queue joins them only after accreditation or when the account has an actual
  queue entry. For `ACCREDIT_SCAN`/`PRESENCE_SCAN`/`ACTIVITY_SCAN` (or the
  admin `*` wildcard) holders, the daily tools take the bar — Schedule,
  Scanner, Activities (for `ACTIVITY_SCAN`), Notifications — and Queue,
  Wallet, Account, and any secondary operations stay in Others. Queue-only
  operators instead get Queue operations in the primary bar; scanner
  operators with queue access find it in Others, preserving Scanner's direct
  placement.
  `app/(tabs)/_layout.tsx` — reads capabilities from a shared `/api/me` fetch
  (`lib/me-context.tsx`, `lib/use-me.ts`) and keeps the custom RouterTabs shell
  mounted while the profile revalidates. Every route stays registered in the
  hidden `TabList`; only the direct buttons and, when needed, the separate
  Others circle are capability-driven. The fetch refetches on app foreground, so a
  capability change made elsewhere (web admin) shows up without a reinstall
  (H55's explicit acceptance bar). `useMe` only surfaces `loading: true` for
  the *first* fetch (no cached profile yet, e.g. after sign-in); a foreground
  revalidation of an already-loaded profile — including the `inactive ->
  active` blip iOS sends when Control Center, Notification Center, or the app
  switcher briefly covers the app — refreshes quietly instead. The tab layout
  mirrors that split (`meLoading && !me`), so a background revalidation never
  flashes Schedule over the selected tab.

  The entries inside the native `Others` dropdown (Account for participants;
  eligible personal Queue, Wallet, Account, and Queue operations when a scanner
  operator has queue access — routes under `app/(tabs)/others/`) are intentionally
  pseudo-tabs (`lib/operations-navigation.ts`):

  - Selecting the pseudo-tab whose section is already on screen is a no-op.
  - Changing pseudo-tabs always uses `replace()`, never `push()`, so repeated
    selections do not stack duplicate queue/wallet/account screens.
  - Deeper screens inside a section (e.g. the person drill-downs) still push
    normally on top of that section's root.
  - Route matching must normalize Expo Router route groups first, because
    `usePathname()` may return `/others/...` while tests and typed hrefs still
    use `/(tabs)/others/...`.
  - `OVERFLOW_TAB_KEYS` plus the descriptor maps in `lib/overflow-tabs.ts` are
    the only destination registry. `lib/operations-navigation.ts` derives its route
    union and section matching from that registry; never duplicate the list or
    cast a new route into the helper. Exhaustive tests iterate every registered
    destination so a future pseudo-tab cannot silently inherit another
    section's `noop` behaviour.

  Do not re-implement these as plain `push()` calls or stack-style route
  launches. That regresses the back stack and duplicates overflow pages —
  earlier versions broke exactly this way.

## Auth flow

- `lib/auth-client.ts` — Better Auth client using `expo-secure-store` for
  session storage instead of a cookie jar (H4's explicit requirement).
- `lib/api.ts` — thin wrapper around the auth client's underlying fetch so
  every API call (not just `/api/auth/*`) carries the restored session.
- `app/(auth)/sign-in.tsx` — email/password only; no in-app registration. The
  anonymous event feed supplies the configured event name, while the task
  heading remains the localized "Sign in" label for visual and screen-reader
  orientation. Missing credentials are reported inline and focus moves to the
  first field that needs attention instead of hiding validation behind a disabled
  submit button. The password field has a 52-point, screen-reader-labelled reveal
  action, and password recovery keeps a 44-point hit target. At standard text
  sizes the composition does not scroll: the form stays vertically centred and
  a concise account/application note stays at the safe-area bottom. At
  accessibility text sizes the same screen permits scrolling rather than clip a
  field or action. The note shows the configured
  `EXPO_PUBLIC_EVENT_WEBSITE_URL` as selectable text but deliberately does not
  link out to account creation (see `docs/mobile-release.md`). The
  uncontrolled native credential fields use the username/current-password
  pairing so password managers can fill both credentials together after their
  provider sheet temporarily moves focus away from the app. Session
  revalidation after Passwords/Face ID returns never unmounts the auth
  navigator, so the native fields that receive the selected values remain the
  same instances; iOS additionally associates the domain through
  `webcredentials`.
  If authentication succeeds but the account lacks `mobileAccess`, the app
  revokes that device session and returns to sign-in with a native, modal
  access-denied alert. The route signal is consumed before presentation so
  VoiceOver does not hear the same denial again after a remount. `mobileAccess`
  is also part of the synchronous protected-stack guard: an ineligible account
  never mounts an event screen while its asynchronous sign-out is running.
  (accounts come from the web onboarding/invite flows, H10/H12).
- `app/(auth)/forgot-password.tsx` and `reset-password.tsx` share the same
  leading, task-first composition. Their primary actions remain discoverable,
  invalid values are explained beside the relevant field, and focus moves to
  the first correction. They stay fixed at standard text sizes and become
  scrollable only for accessibility text sizes.
- `app/_layout.tsx` keeps a neutral background while the authenticated profile
  restores. It only announces and renders the session progress state after a
  500 ms grace period, so a normal fast restore does not flash an intermediate
  screen; a persistent recovery error still shows retry and sign-out actions.

## Participant screens

- `app/(tabs)/schedule.tsx`, `queue.tsx`, `wallet.tsx`, `notifications.tsx`,
  `account.tsx` — the five participant screens. API-backed screens expose
  loading, retryable error, and empty states without leaking rejected promises.
  The account screen displays the shared `/api/me` profile, refreshes it, and
  provides a confirmed sign-out action for the device session. Its collapsed
  danger zone reads `GET /api/me/removal-eligibility`: eligible accounts can
  call `DELETE /api/me` after a native destructive confirmation, while
  accounts with retained operational history see the anonymization/retention
  explanation and a direct irreversible anonymization action (H54). For operators
  (any scan capability, `lib/tabs.ts`'s `isOperator`) it also shows a "My
  stats" section (`/api/me/logistics/stats`) and a link to the scan-history
  screen (`app/(tabs)/others/scan-log.tsx`, `/api/logistics/scan-log`, grouped by
  day into `Section`s with a native list look). It also carries a "Storage"
  section (`lib/storage-usage.ts`) showing the size of the offline API
  fallback cache (`lib/offline-cache.ts`) and of downloaded files sitting in
  the OS cache directory (wallet passes, and for operators the attendance
  roster), plus a confirmed "Clear cache" action. Clearing never touches the
  offline scan queue — the only record of not-yet-synced scans — or the auth
  session; see "Scanner cache encryption & isolation" below. `wallet.tsx`
  renders ticket/badge QR codes. After an eligible session is restored, a
  best-effort startup warmup stores the `/api/me/ticket` payload under an
  account-scoped cache key; the screen still refreshes online and falls back to
  that payload with a stale-data banner when the connection fails. Accepted
  spots also expose the existing authenticated decline endpoint after a final,
  destructive confirmation; success refreshes both ticket and profile state
  (H15). When an existing Apple pass is opened, the app
  passes both the shared pass type identifier and the selected account/purpose's
  serial number to PassKit, so another account's pass with the same type
  identifier cannot be selected at random. The Apple Wallet action is the system
  `PKAddPassButton` control (`@premieroctet/react-native-wallet`'s
  `RNWalletView`, iOS only) — per Apple's Add to Apple Wallet guidelines, the
  button must be the system control, not custom artwork — wired to
  `react-native-wallet-manager`'s `addPassFromUrl` (authenticated fetch of the
  `.pkpass` endpoint with the session cookie, then native
  `PKAddPassesViewController` presentation). The native button is mounted only
  on iPhone and iPad: an iPad-compatible build running on macOS is reported by
  `expo-device` as `DeviceType.DESKTOP`, where PassKit cannot create the button
  and the wallet dependency would otherwise crash while force-unwrapping it.
  On macOS the screen instead downloads the authenticated `.pkpass` and opens
  the system share/save handoff, matching the web wallet's download behavior.
  Google Wallet still goes through
  the existing `saveUrl` endpoint via `Linking.openURL`.
  `queue.tsx` refetches immediately on a "queue" push
  (below) and also polls `GET /api/queue/me` every 15s while focused as a
  fallback. `notifications.tsx` pages past the initial 20 inbox messages on
  demand, allows an expanded message to be deleted after native confirmation,
  and mirrors the web activity/kind reminder preferences. A third "Manage"
  segment (`ANNOUNCEMENTS_MANAGE` only) adds announcement administration —
  `components/announcement-manage-view.tsx` lists admin announcements with
  the same swipeable edit/delete rows as Schedule
  (`components/schedule-swipe-row.tsx`, reused as-is), and both the header
  Add button and a row's swipe-to-edit open
  `components/announcement-form-modal.tsx`, which mirrors the web admin's
  `AnnouncementFormModal` field-for-field (H50, DELTA 0722) — same
  audience/specific-recipient targeting exclusivity, per-announcement
  channel candidates, and the notify-only-vs-screen-placed window
  distinction. The recipient picker hits
  `GET /api/announcements/recipient-candidates`
  (`lib/announcements-admin.ts`'s `fetchAnnouncementRecipientCandidates`),
  scoped to `ANNOUNCEMENTS_MANAGE` rather than the broader `USERS_READ`,
  mirroring `/api/schedule/owner-candidates`.
- `app/(tabs)/schedule.tsx` — the participant agenda, grouped by day. On first
  load it opens (unanimated) on whatever is happening now — the active card, or
  the "Now" divider drawn between entries when nothing is running — instead of
  at the top of a multi-day schedule. Tapping the Schedule tab while it is
  already open animates back there; switching back from another tab leaves the
  list where you left it. Two details of `SectionList` make this fiddly and are
  easy to regress: `scrollToLocation`'s `itemIndex` counts the section header as
  0 (so a row at data index N is `N + 1`), and the call is a silent no-op while
  the target sits past the list's highest measured row — hence the
  `onScrollToIndexFailed` handler, which jumps to the estimated offset to force
  measurement before re-issuing the exact scroll. The tab listener must be
  registered on the *screen's* own navigation object: "tabPress" is emitted
  targeted at that route's key, so a listener on the tab navigator never fires.
  There is no in-place
  expansion: every card always opens `app/schedule/[id].tsx` for the full
  detail. Cards whose copy is long (`isScheduleCardTruncated`: a multi-line
  description, >90 characters of it, or a >60-character title) clamp title
  and description to two lines, capping the card's height; the chevron
  affordance sits in the card's bottom-right corner (where the old "Show
  more" toggle used to be). The timeline gutter draws one continuous line
  per day: tight
  spacing (`TIMELINE_GAP_AFTER_LABEL`) right after a time label, wider
  spacing (`TIMELINE_GAP_BEFORE_LABEL`) as it approaches the next one, so
  each label reads as anchored to the line above it with a beat of
  anticipation before the next. Adjacent overlapping entries get a warning
  glyph in the time gutter (`entriesOverlap`, `lib/schedule.ts`). The
  reminder bell sits absolutely positioned in the card's top-right corner
  (`hitSlop` — a 44pt touch box stretched the row and pulled the bell off the
  title, H374) and toggles the H59 per-category notification model
  **straight from the list** via `lib/use-schedule-notifications.ts`;
  filled/accent means on, outline/grey off. The header branches on
  `isRealLiquidGlassAvailable()` (`components/glass-view.tsx`): on iOS 26+ it's
  a real native header (`app/(tabs)/schedule/_layout.tsx` gives this tab its
  own Stack so `navigation.setOptions` can drive one) with a compact
  left-aligned title, `Stack.Toolbar.Button` pair for notifications/filter —
  real adjacent `UIBarButtonItem`s the OS groups into one Liquid Glass capsule
  on its own, no manual divider or shadow to get wrong — and Apple's own
  integrated search button (`headerSearchBarOptions`, which owns its
  expand/collapse animation and Cancel affordance). Everywhere else (iOS
  <26, Android) the shared `LegacyScreenHeader` from
  `components/native-ui.tsx` renders the original hand-rolled header in the
  screen body instead: a title row with a glass bell+filter pill and a
  separate glass search button that swaps the row for an inline text field
  with a Cancel button. Activities and People Finder reuse the same component
  so their fallback search transition and 44-point hit targets stay identical.
  On Android, their roster/activity filters use the shared `AndroidFilterMenu`
  modal fallback so the trigger and each option remain independently tappable;
  iOS keeps the native `MenuView` path.
  `ScheduleFilterPanel` (also in
  schedule-filter-button.tsx) is the dropdown for both paths, rendered as a
  `Modal` so it isn't clipped by either header's bounds — kind filter open to
  everyone, audience filter only to `schedule:manage` holders. The custom tab
  bar is an absolute overlay, so the screen keeps its full-height content and
  the list can pass behind the translucent Liquid Glass surface (opaque on
  Android and earlier iOS). Its direct surface is one native gesture
  surface: the selection lens follows the finger from touch-down and
  navigation commits on release to the tab cell under the finger, while the
  separate Others circle remains the native dropdown. On the native-search path,
  `allowToolbarIntegration` is disabled so `integratedButton` stays in the
  header instead of being adopted by the custom bottom bar. The tab shell
  publishes `useRouterTabBarInsets()` from `lib/router-tabs-inset.ts` (the
  reusable shell contract is documented in
  [`router-tabs.md`](./router-tabs.md)):
  `contentBottomInset` is the reusable safe clearance for scroll endings and
  `tabBarHeight`/`tabBarBottomPadding` can position floating controls above the
  bar. Scroll views that retain iOS automatic inset adjustment use
  `useRouterTabBarScrollBottomInset()` so UIKit's bottom safe area is not counted
  twice. The Add button
  (admin only) is a
  floating glass FAB pinned bottom-right, mirroring the edit FAB on
  `app/schedule/[id].tsx` and the scanner screen's torch button, rather than
  living in the header row. Admin rows are swipeable to reveal edit/delete
  (`components/schedule-swipe-row.tsx`); both the swipe's edit action and the
  Add button open `components/schedule-form-modal.tsx`, which mirrors the web
  admin's `ScheduleFormModal` field-for-field (including the
  responsible-person picker). Covered by `test/ui/schedule-list.test.tsx`.
- `app/schedule/[id].tsx` — a real native large-title nav bar
  (`headerLargeTitle` + `headerTransparent` on the `schedule/[id]`
  `Stack.Screen` in `app/_layout.tsx`, `contentInsetAdjustmentBehavior=
  "automatic"` on the `ScrollView`) replaces an earlier hand-rolled
  pinned-header overlay that had no opaque background of its own and let
  scrolled content show through the title. Staff details follow the schedule
  rules: staff-only items omit scan/visibility/publish fields, and
  already-visible items omit the spent publish date. The reminder bell is a
  proper `headerRight` item; back reads "Horario" via `headerBackTitle`.
  Admins get a floating glass pencil (bottom-right, clear of the home
  indicator) that opens the same `ScheduleFormModal` as the list's
  swipe-to-edit.

## Operator screens

### Queue operations

`components/queue-operations-screen.tsx` — Queue operations is available to
`queue:operate`, `queue:admin`, and `*`. It first lists only the caller's
authorized rooms, then loads each protected room view. Each card keeps the
presenting team, teams called to the door, and the first waiting team easy
to scan. `operations/_layout.tsx` and `others/operations/_layout.tsx` wrap
it in its own `Stack` so it can use the same native
`headerLargeTitle`/`headerSearchBarOptions` search bar as
`people-directory-screen.tsx`; both use iOS 26's `integratedButton`
placement with toolbar integration disabled, so the inactive search control
stays a compact native button in the header on regular-width iPads instead of
moving into the custom bottom bar or expanding into a full trailing field. Queue
operations also pairs that search action with the same native filter pattern
as People Finder, offering all, live, and paused rooms. Typing a query swaps
the filtered room grid for a flat, sorted list. The results include
every matching queue entry (by team name or member name/email) across every
challenge that team is in, each rendered as the
participant's own My Queue card, under a result count ("3 results" / "No
results"). `lib/queue-search.ts`'s `findQueueEntries()` does the matching
and folds the repeats `roomView` returns — its `next` list is the whole
challenge queue, so every room sharing a challenge repeats the same waiting
entries — into **one card per queue entry** that lists all of its possible
rooms as chips, the same way the participant's My Queue card does. Tapping a result — or any team already
shown on a room card — pushes `components/team-operations-screen.tsx`
(`/(tabs)/others/team/[entryId]`), a detail view built on the same layout as
the participant's own queue card but with the extra context only an
operator needs: full member emails, their membership origin (automatic
primary-email match, verified secondary-email match, staff link, unmatched,
or staff-added), repo/Devpost/demo links, and the entry's `queue_history`
timeline. A caller with `projects:edit` (or `*`) can search the
project-edit candidate directory (live typeahead), add a selected account,
and remove a member after native confirmation. Team rows now also support
swipe-to-reveal destructive actions (notification center style): "Remove
member" for manual links and "Unlink secondary account" when the match came
from a verified secondary email. Queue access alone never exposes those
controls. Imported Devpost participants are removed through the Devpost
participant endpoint; staff-added members use the repository-member
endpoint, so a correction preserves the imported-record audit trail.
Re-notification uses the existing
idempotent `notify-enter` transition with a React Native-safe generated
key. On top of the existing 10s poll, the screen opens
`lib/server-events.ts`'s `startQueueEventStream()` (the authenticated,
capability-gated `GET /api/queue/stream` topic) while focused, so
`QUEUE_TEAM_CALLED` / `QUEUE_ENTRY_CHANGED` / `QUEUE_ROOM_CHANGED` refresh
the board immediately and mark the newly-called room/entry with an accent
border and a "Just called" badge for ~12s. The native client sends the
Better Auth restored session cookie on every initial connection and reconnect,
and it stops the loop as soon as the screen loses its queue capability.
`notifyTeamCalled` (apps/api) also pushes the
existing opt-in `queue.staff` push category (same mechanism as
`notify-enter`'s staff alert) so an operator with a backgrounded app still
gets a device notification. The layout is one column on phones, two from
680 px, and three from 1100 px.

### Scanner

`app/(tabs)/scan/index.tsx` — thin wrapper around the shared
`GeneralScannerScreen` (camera/manual scanners selected by capability:
accreditation, badge replacement, door presence, meals, and activities),
a dedicated primary tab for operators (see `docs/navigation.md`). Its
person/people drill-down routes live under `app/(tabs)/scan/*`. Screen-level
actions use `AdaptiveToolbarButton`: real Liquid Glass runtimes promote
navigation actions into UIKit's top toolbar; iOS <26 and Android use the same
44-point opaque glass buttons inline on the camera surface. The camera preview
is non-interactive so it cannot steal those hit targets on older iOS. Activity
scanning uses a balanced second row with equal-width glass and queue-sync
containers, followed by the statistics; the general scanner's queue-sync
capsule sits directly below the adaptive tab bar. Scanner and activity
people-directory actions use the same person-with-magnifier symbol. On iOS
26+, People Finder keeps the native large-title contract: its title starts
left-aligned, collapses to the centred compact title while scrolling, and uses
UIKit's automatic list inset with a transparent header so the title is not
painted over by a separate opaque layer. On older iOS and Android it uses the
shared fallback header with a custom back button, filter menu, and search
transition. Because `react-native-screens` can attach an
asynchronously populated iPad `FlatList` at its compact scroll edge, the two
people directories and Queue operations render their regular-width heading
as the list's first item while keeping back, filter, and search in native
toolbar chrome. This guarantees the heading is visible on initial entry;
compact-width iPhone keeps the native large-title presentation.
Camera-owned torch/manual-entry buttons and modal-owned close/save actions
remain attached to their surfaces rather than moving into navigation chrome.
The local `modules/camera-capabilities` Expo module reads the back camera's
actual torch support from AVFoundation/Camera2. Flash-capable devices keep
manual entry at bottom-left and the torch at bottom-right. Devices without a
torch (including supported iPads and the iPad app running on Mac) omit the
non-functional torch action and place manual entry in its bottom-right slot,
directly below the People action.

**QR scan gating (`components/QrCamera.tsx`).** Only `barcodeTypes: ["qr"]`
is accepted, and a raw `onBarcodeScanned` hit is gated behind two independent
checks before `onValue` fires: a geometric frame test (`lib/qr-frame.ts`) and
a temporal stability test (`lib/qr-scan-stability.ts`).

- *Frame test.* `getBarcodeFrameObservation` rejects the read unless every
  corner point falls inside the centered 264px frame square, the viewport's
  center point falls inside the code's polygon (rules out edge-of-frame
  partial reads), and the code's area is at least 15% of the frame's area
  (`MIN_BARCODE_TO_FRAME_AREA_RATIO`) — this forces the operator to bring one
  QR deliberately into the foreground instead of auto-firing on whatever
  passes through the background.
- *Stability test.* `advanceQrScanCandidate` then requires 3 consecutive
  detections of the same data (`REQUIRED_DETECTIONS`), spanning at least
  100ms (`MIN_STABLE_DURATION_MS`) with no gap over 400ms
  (`MAX_DETECTION_GAP_MS`), while the code's center drifts by no more than
  0.08 frame-widths (`MAX_CENTER_SHIFT`) and its area changes by no more
  than 25% (`MAX_AREA_CHANGE_RATIO`) between detections — this rejects a
  still-focusing or still-moving frame.
- A confirmed scan locks the camera for 1200ms and resets the candidate on
  blur, viewport resize, or `scanningEnabled` toggling off.
- *Android quirks.* `expo-camera` does not guarantee the same `cornerPoints`
  ordering, mirroring, or presence as iOS (it can report
  horizontally-mirrored points, or omit `cornerPoints` in favor of an
  axis-aligned `bounds` box) — `qr-frame.ts` normalizes for this by
  re-ordering points around their centroid (`orderPoints`, via `atan2`)
  rather than trusting platform order, and falls back to `pointsFromBounds`
  when fewer than 4 corner points are reported.

**Offline queue & sync.** `lib/scanner-db.ts` (native: `scanner-db.native.ts`)
owns two WAL-mode SQLite files — see "Scanner cache encryption & isolation"
below — and `lib/scanner-sync.ts` replays in creation order with the
persisted scan id as `Idempotency-Key`, then installs the latest server
snapshot/revocation set.
A scan rejected as "timestamp must be in the past" (device clock running
ahead of the server's) is corrected once by the measured clock skew — read
from the API's `Date` response header in `lib/api.ts` — and retried before
being failed permanently, instead of looping forever on the same stale
timestamp; the "Device queue" sheet (`ScannerQueueStatus` in
`components/scanner-transaction-status.tsx`) shows a clock-skew warning
banner when this is happening. A permanently rejected scan expands into a
`ManualLogDetails` block with every field (person/badge/user IDs, method,
reason, timestamp, activity, etc., resolved against the local
`scanner_people`/`scanner_activities` cache where possible) an operator
needs to log the transaction by hand in the web admin panel; swiping that
row left (`react-native-gesture-handler`'s `Swipeable`, OS notification
center-style — the row's `GestureHandlerRootView` wrapper lives in
`app/_layout.tsx`) reveals a delete action that discards it (`deleteScan`
in `lib/scanner-db.ts`) on the follow-up tap — always a manual, per-scan
gesture, never automatic or triggered by attempt count alone.

### Activities

`components/activities-screen.tsx` (`app/(tabs)/activities/index.tsx`) — the
operator's list of scannable activities, read straight from the local
`scanner_activities` cache. On iOS 26+ its native header follows Schedule: a
compact left-aligned title, a native `Stack.Toolbar.Menu` kind filter, and
Apple's integrated Liquid Glass search button. On iOS <26 and Android,
`LegacyScreenHeader` in `components/native-ui.tsx` supplies the same opaque
fallback, including the inline magnifying-glass search transition and native
`MenuView` filter. Both controls narrow the list together, and the pure
filtering/marker helpers sit in `lib/activity-list.ts`
(`lib/activity-list.test.ts`). Each row shows its start time and its real
kind pill (`scheduleTypeLabel`, so a talk no longer reads "Activity"), and
the activity closest to the current time is outlined and labelled
"Now"/"Next" — "Now" only while it started within the last two hours, since
the scanner snapshot carries no end time. Two things kept the list visibly
flickering and snapping back under the large title: the `RefreshControl` was
wired to `sync.syncing`, so the background 15s scan-queue tick opened the
spinner on its own, and every reload committed a brand-new array even when
nothing had changed. The spinner is now driven by a local `refreshing` flag
set only by pull-to-refresh, and reloads keep the previous array identity
when `sameActivities` says the data is unchanged.

## Scanner cache encryption & isolation

Staff/scanner devices carry two distinct local caches, split into separate
SQLite files with different lifetimes, encryption keys, and OS backup
treatment (`lib/scanner-crypto.ts`, `lib/scanner-db.native.ts`). The
repository has focused adapter tests for the encryption/isolation paths;
physical iOS/Android and EAS verification remains a release-gate task in
`docs/mobile-release.md`.

- **Attendance roster** (`hackos-scanner-roster.db`, `scanner_people` +
  badges/activities/scan-count tables) — every field beyond the plaintext
  `ticket_token`/`badge_id` lookup keys (name, email, role,
  `food_intolerance_notes`, `notes`, presence state) is AES-256-GCM encrypted
  as one JSON blob per person under a single roster key
  (`expo-crypto`'s `AESEncryptionKey`, persisted in `expo-secure-store`).
  The database file itself lives in the OS cache directory
  (`Paths.cache` from `expo-file-system`), which iOS/Android exclude from
  iCloud/Google auto-backups by default — no config plugin or native code
  needed. The whole roster is disposable: `wipeAttendanceRoster()` deletes
  every table and retires the roster key, called from
  `components/account-screen.tsx`'s sign-out handler and its "Storage" →
  "Clear cache" action (`lib/storage-usage.ts`'s `clearAllCaches`, operators
  only), and a fresh `GET /api/scanner/snapshot` fully reconstructs it on
  next sign-in. Since
  encrypting `name`/`surname`/`email` rules out pushing search into SQL,
  `listScannerPeople` decrypts the (event-sized) roster once per call and
  filters/sorts in JS instead.
- **Offline scan queue** (`hackos-scanner-queue.db`, `pending_scans`) — the
  only record of a not-yet-synced transaction, so it stays in the default
  (non-cache, backed-up) document directory and is not wiped on ordinary
  sign-out or by the account screen's "Clear cache" action. It is wiped for
  the signed-in account during account closure. Every row is
  encrypted with its own `created_by_user_id`'s key
  (a distinct `expo-crypto` key per staff member, also in `expo-secure-store`,
  marked `WHEN_UNLOCKED_THIS_DEVICE_ONLY` on iOS so a restored backup can't
  carry a usable key to a different device). `pendingScans`,
  `replayPendingScans`, and `retryFailedScans` are always scoped to the
  currently signed-in user's own rows: a different staff member signing in
  on the same device cannot list, decrypt, or replay a predecessor's still-
  queued scans (replaying under the wrong session would also misattribute
  the action server-side). The same user signing back in later recovers
  their own queue, conflicts included, exactly as they left it — the queue
  is keyed by owner, not by session. The pre-split `hackos-scanner.db` cannot
  be safely migrated: its plaintext pending rows have no owner column, and
  assigning them to the first authenticated operator could misattribute a
  scan. On first authenticated queue access the app retires that app-owned
  file and its SQLite `-wal`, `-shm`, and `-journal` sidecars without importing
  any row; staff must re-record scans that existed only in the old queue. If
  the OS refuses deletion, queue initialization fails closed and retries on a
  later authenticated call. Devices that remain offline can still retain a
  stale identity until reconnect/expiry or a device wipe; central tombstones
  prevent that stale scan from being accepted or re-uploaded.

## Realtime & notifications infrastructure

- `lib/push.ts` — best-effort Expo push token registration, called once after
  sign-in from `app/_layout.tsx`.
- `lib/notifications-setup.ts` — the actual delivery handling: configures
  Expo's foreground notification handler (shown even while the app has
  focus — the default suppresses it), sets up the Android notification
  channel, and wires `addNotificationReceivedListener`/
  `addNotificationResponseReceivedListener`. Both re-emit the notification's
  `category` on `lib/notification-events.ts` (a tiny in-process pub-sub); a
  tapped `category: "queue"` notification also navigates to the queue tab.
  Wired once for the app's lifetime from `app/_layout.tsx`.
- `lib/server-events.ts` — native authenticated SSE reader. It takes the
  restored cookie from Better Auth's Expo plugin, parses the RN fetch stream,
  reconnects after interruption, and emits personal queue/wallet events.
- `lib/notification-events.ts` — `subscribeToCategory`/`emitCategory`, unit
  tested in `lib/notification-events.test.ts`. Lets a mounted screen react to
  a push the moment it arrives instead of waiting out its poll interval.

## Other infrastructure

- `lib/i18n.tsx` — react-i18next wrapper (`useLocale()` keeps the original
  `{ language, setLanguage, t }` shape) reading `packages/shared/locales/
  {en,es,gl}/{mobile,common}.json` — mobile-specific strings plus the subset
  shared verbatim with `apps/web/src/lib/i18n.ts`, synced to `me.language`
  from `/api/me`. `mobile.json` is intentionally smaller than the web app's
  `web.json`: it covers scanner and participant controls, not the full web
  admin surface.
- `lib/haptics.ts` — best-effort Expo Haptics feedback for custom controls and
  meaningful outcomes. Selection/light feedback is used for custom toggles,
  segmented choices, scanner capture and retry actions; success/warning/error
  feedback is reserved for confirmed mutations and scanner outcomes (H22-H26,
  H51). Native `Switch`, segmented `Picker`, Wallet controls and system menus
  keep their platform-provided feedback, and passive navigation/QR frame
  detection stays silent.
- `expo-network` is installed as a required peer of `@better-auth/expo`; it
  lets the auth client refresh session state when the device regains network
  connectivity. As with every native dependency change, an existing dev client
  must be rebuilt rather than only reloading its JavaScript bundle.

## UI testing

`test/ui/` contains fast React Native Testing Library flows
rendered through `renderMobile`, including the shared H4 sign-in contract.
`renderMobile` (`test/ui/render.tsx`) wraps every screen in a
`GestureHandlerRootView` and a `SafeAreaProvider` with fixed test insets, so
components using `useSafeAreaInsets()` or gesture-handler's
`GestureDetector`/`Swipeable` don't need a per-test workaround. `jest.setup.js`
mocks `react-native-reanimated`, `react-native-worklets`, and
`react-native-gesture-handler` at the root — real gesture recognition and
worklet scheduling aren't meaningful under jest, so `Gesture`/`GestureDetector`
are no-op pass-throughs and `Swipeable` renders its `renderLeftActions`/
`renderRightActions` statically instead of waiting for a simulated drag.
Cross-surface hooks come from `@hackos/shared/ui-test-ids` and are wired to
web `data-testid` and native `testID` attributes. Detox scenarios in
`e2e/mobile/` cover the same contract against a built simulator/emulator app;
run them with the root `test:ui:native` commands described in
[`docs/ui-testing.md`](./ui-testing.md). Neither layer proves what a screen
*looks* like, so a PR that changes a screen's appearance also carries
screenshots from a running simulator — see
[`docs/ui-testing.md`](./ui-testing.md) § Screenshots on UI PRs for the
build/drive/capture recipe and the local-port and
`mobileAccess` traps that eat time on the first attempt.

## Scanner state transitions

A scan is inserted in SQLite before any network
request: `pending -> acknowledged` only after a 2xx response (including an
idempotency replay), or `pending -> failed` for an explicit 4xx business
rejection. Network failures leave it `pending` and stop ordered replay until a
later foreground/15s/manual sync. Failed items stay visible and can be reset to
`pending`. Accreditation never applies its badge mapping locally before the
acknowledgement. Badge rotation, presence, meals, and activities apply local
operational feedback immediately, then the post-replay full snapshot converges
them to server truth.
