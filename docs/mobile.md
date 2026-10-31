# Mobile app (`apps/mobile`)

Native Expo Router client for hackOS: Better Auth session continuity,
capability-driven tabs, participant-facing screens, authenticated realtime,
and offline SQLite scanners for accreditation, badge rotation, presence,
meals, and registrable activities.

**Build identification.** The installed-version footer in Account and Sign in reads
`v<version> · <commit>`: `app.config.ts` embeds the short commit the binary was built
from (`EAS_BUILD_GIT_COMMIT_HASH`, `GITHUB_SHA`, or the local checkout).

The Account connection warning appears below the profile identity header, before
the profile fields, so it stays outside the avatar’s cutout transition.

**Developer API mode.** Seven taps on the understated installed-version footer in Account
or Sign in reveals a confirmation that switches between production
(`api.hackudc.com`) and development (`api.dani.md`). The choice is persisted
in SecureStore. A switch clears the local session and all endpoint-specific
caches, downloaded passes, roster data, and every pending scanner queue before
enabling the new API. Revoking the old server session is best effort and never
blocks a switch while offline. Android's bare SQLite default-directory path is
converted to a `file://` URI before FileSystem reads the directory URI. That
native getter validates the path even when no roster exists, so the switch
could fail on a fresh installation before its first sign-in as well as during
an older roster migration. Cleanup runs from Sign in too; it does not require
a previous session or scanner use.
A fixed
red `DEV` badge overlays every screen while development is active. This is
intentionally undiscoverable during ordinary use.

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
- [Event diary (#935)](#event-diary-935)
- [Company tags (#935)](#company-tags-935)
- [Operator screens](#operator-screens)
  - [Queue operations](#queue-operations)
  - [Scanner](#scanner)
  - [Activities](#activities)
- [Scanner cache encryption & isolation](#scanner-cache-encryption--isolation)
- [Live Activities and Live Updates (#966)](#live-activities-and-live-updates-966)
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
| H38, H25/H26, H59, H19, H22 | Queue, staff-activity, attendee-activity, submission-deadline and accreditation-desk Live Activities / Live Updates (#966) | [Live Activities](#live-activities-and-live-updates-966) |

## Backend changes

**Schema.** The current schema uses the independent `roles.event_access`
flag, its `role_seed_defaults` snapshot, and the `user_event_access` canonical
read projection. A user is entitled only when
their account is active and non-anonymized and at least one assigned,
non-deleted role has the flag enabled; visibility and capabilities do not
change that result. The schema includes the role, user, ticket, and wallet-pass
state needed to keep already-approved app builds working. `push_tokens` is
defined in the consolidated baseline and is now also written via the route
below.

**Endpoints / hooks.**
- `POST /api/me/push-tokens` (`apps/api/src/modules/notifications/routes/push-tokens.ts`)
  — upserts the caller's Expo push token; re-registering the same
  token (app restart, re-login) reassigns it rather than duplicating rows.
  Sign-out calls `POST /api/me/push-tokens/unregister` (`lib/push.ts`, a
  sign-out listener) so queue calls, activity reminders and challenges fall back
  to email for someone with no device. Those categories' email is opt-in while a
  device is registered (see `docs/notifications.md`); the first-run sheet
  `/notification-onboarding` (`components/notification-onboarding-screen.tsx`,
  prompted from the root layout) asks once, and Account → Notifications has a
  row for queue calls (email only) and challenges.
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
  `GET /api/me` (capabilities + language + badgeId + canonical
  `visibleRoleName` + role-derived event access),
  `GET /api/public/activities`
  (schedule), `GET /api/queue/me` (H38 status), `GET /api/me/ticket` (including
  the active account-specific Apple Wallet serial number for each purpose) +
  `GET /api/me/wallet/apple/:purpose.pkpass` + `GET /api/me/wallet/google/:purpose`
  (H28), `GET`/`PUT /api/me/notification-preferences` (H51).
- `GET /api/scanner/snapshot` — capability-guarded, replace-all seed for the
  device SQLite store. It contains only the lightweight person cards, ticket
  and current/revoked badge mappings, scannable activities, meal/activity
  scan counts, last door state, and the current `eventAccess` entitlement
  needed by H22-H26. Ticket tokens are included only while the person's live
  role set grants event access. A full snapshot
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
  that launched it: `app/(tabs)/others/scan-log.tsx` from Statistics and
  `app/(tabs)/scan/scan-log.tsx` from the device-queue popup. Keeping both
  thin routes prevents Account from switching to the Scanner tab and leaves
  each history screen with a working native back action (issue #574). Each
  entry includes the person, exact timestamp, scan source, badge/method,
  activity/category, door direction, and operator notes where available.
  Tapping an activity or door entry opens that person's presence timeline with
  the exact log highlighted, where an operator with `presence:scan` can edit or
  delete it. The profile automatically scrolls the matching signal into view.
  The shared person screen is mounted in the stack that owns the
  history (`others/person/[id]` or `scan/person/[id]`), so Back returns to the
  filtered history instead of switching tabs.
- `GET /api/me/logistics/stats` — the caller's own accreditation/presence/
  activity scan counts plus total, distinct people, and most recent scan,
  shown in the operator Statistics operations hub. That hub also links to the
  full scan history. Local queue reconciliation has its own dedicated
  operations screen. `GET
  /api/logistics/stats/by-staff` is the `LOGISTICS_STATS`-gated cross-staff
  ranking (web `/logistics/stats`, "Staff ranking" section), and `GET
  /api/exports/staff-scan-stats.csv` (`exports:run`) exports the same data.
- `GET /api/scanner/role-stats` — Confirmed/Accredited/Inside counts for the
  scanner home screen's stats tiles, broken down by role and capability-holder
  status (people sharing a role remain separate buckets when only some hold
  capabilities), using the same role
  classification `/api/scanner/snapshot` uses (`apps/api/src/modules/logistics/stats.ts`).
  "Confirmed" means accreditation-eligible, not the raw application
  `confirmed` flag: it is the person's live role-derived `eventAccess` bit
  (`isAccreditationEligible` in `lib/scanner-group-filter.ts` mirrors this
  server-side rule for the offline fallback below). "Inside" reuses
  `occupancyEstimate()` rather than re-deriving presence semantics. It is a
  direct read from the authoritative API, so the client avoids pulling and
  recomputing from the full roster snapshot on every refresh. The scanner
  home screen (`components/general-scanner-screen.tsx`) also opens the
  logical logistics scope in the shared `/api/realtime/stream` transport
  (`lib/server-events.ts#startLogisticsEventStream`) and refetches on any
  `LOGISTICS_ACCREDITED`/`LOGISTICS_PRESENCE_SCAN`/`LOGISTICS_ACTIVITY_SCAN`/
  `LOGISTICS_MEAL_SCAN_BATCH` event, so one device's scan updates every other
  device's tiles within about a second without polling. If the request fails,
  the previous server counts are discarded and the screen falls back to
  computing the same three numbers from the local SQLite roster — an approximation, since a stale snapshot's
  `lastPresenceKind` can lag the authoritative server-side occupancy
  estimate. The scanner uses the same roster-derived role options and exact
  role matching as the People directory, including custom roles. Its persisted
  multi-select role filter stays open across taps, scrolls within the available
  screen height, and scopes which rows get summed into the tiles. The selection
  is saved via `expo-secure-store` so it
  survives app restarts. Scanner and personal scan statistics refresh on focus.
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
- Queued scans stop replaying after `SCANNER_REPLAY_MAX_AGE_DAYS` (6 days,
  `@hackos/shared/idempotency`), one day inside the server's 7-day
  `idempotency_keys` retention (#994). An older scan could re-execute once its
  key is purged, so `replayPendingScans()` fails it locally with
  `scan_replay_expired` without sending it; it stays in the sync queue for the
  operator to log manually or discard.

## Navigation & tabs

The reusable component contract is documented in
[`docs/router-tabs.md`](./router-tabs.md). This section documents only the
hackOS adapter: capability policy, localized destinations, and the native
`Others` menu. Keeping those concerns separate is what lets the tab shell be
distributed to other Expo Router apps without importing hackOS code.

- `lib/tabs.ts` (`primaryTabs`/`overflowTabs`) — pure functions mapping
  `me.capabilities` (including `queue:status`) and `me.hasQueueItems` to the
  custom tab bar;
  see `docs/navigation.md` for the
  full model. Every platform uses `components/opaque-router-tabs.tsx` through
  the reusable `components/router-tabs.tsx` shell: iOS 26+ renders Liquid
  Glass surfaces, while earlier iOS and Android use the same geometry with
  solid surfaces. Five total destinations are shown directly on compact
  layouts; tablet-width layouts can place up to six before using `Others`,
  whose bar surface and circle become 56pt instead of 64pt. With no scan
  capability, Schedule, Diary, and Account are direct; Queue
  joins them for accounts with `queue:status` even before the first queue
  entry so the empty state and tutorial are available. Other accounts see
  Queue only when they have an actual queue entry. `queue:status` is assigned
  through the configurable role-permission editor, never inferred from a role
  name. For
  `ACCREDIT_SCAN`/`PRESENCE_SCAN`/`ACTIVITY_SCAN` (or the
  admin `*` wildcard) holders, the daily tools take the bar — Schedule,
  Scanner, Activities (for `ACTIVITY_SCAN`) — and Queue,
  Diary, Account, and any secondary operations join them directly while five
  fit, moving to Others only beyond that. Wallet is not a tab: a
  back-button-sized glass circle at the top-left of Account's scrolling content
  (it scrolls away with the content, on both platforms) opens it as an
  overlay of Account (`components/account-wallet.tsx`, H28); the overlay
  carries its own close button in the same corner, so from the rest position
  the glyph morphs in place. Android's system back also closes it. The
  overlay avoids a pushed or modal route, which would slide or cover the corner.
  The wallet has no title: the Ticket/Badge control leads it.
  `app/(tabs)/others/wallet.tsx` remains for deep links, without a top bar and with an
  explicit close action that returns through available stack history or falls
  back to Account when opened directly. On iOS with native glass, the close
  action is a real toolbar symbol on a transparent, title-less header, so UIKit
  aligns it with other navigation controls and moves it into Duo's side column.
  Scroll content clears the native toolbar once; it does not reserve an extra
  floating-button row. Earlier iOS and Android retain the shared floating close
  control; Android also protects the status bar with the existing scrim. Queue-only
  operators instead get Queue operations in the primary bar; scanner
  operators with queue access find it in Others, preserving Scanner's direct
  placement.
  When the signed-in person has an account photo (#934), the direct Account
  tab shows it instead of the person symbol, with a ring in the tab tint when
  selected, and the Account screen header shows it in place of the initials.
  On a compact phone a participant's Account sits behind Others, so the Others
  circle shows the photo filling the whole circle, with no ring, while Account
  is open. The signed-in person's own photo is cached on disk (`persist` on
  `UserAvatar`/`useApiImage`, cleared on sign-out) so it still shows offline;
  every other person's photo stays memory-only.
  Tapping the Account avatar (or the one at the top of the networking profile
  editor) opens a native menu (#934): Take photo, Choose from library and, when
  a photo exists, Remove photo (`components/profile-photo-menu.tsx`, one hook
  `lib/use-profile-photo.ts`). The picker crops square (`allowsEditing`), then
  `lib/profile-photo.ts` re-crops the centre square, downsizes to 1024 px and
  re-encodes as JPEG at 0.8, far under the API's 2 MB cap, and posts it as
  multipart `file` to `POST /api/me/photo` (removal is `DELETE`), each attempt
  under its own `Idempotency-Key`. The avatar shows a spinner meanwhile and
  `/api/me` is refetched afterwards: the API answers a new `?v=` route, which is
  also part of the image cache key, so every avatar reloads. Failures show a
  localized alert (denied camera access, rejected image, account being removed
  = 409, generic); the API has no other profile lock. `expo-image-picker`
  (config plugin in `app.json`, iOS usage strings; Android needs no extra
  permission) and `expo-image-manipulator` provide the native pieces.
  `components/user-avatar.tsx` loads the private `/api/users/:id/photo` route
  with `expo-image` and the session cookie as a request header (`useApiImage`;
  React Native's own `Image` drops that header on Android, `expo-image` sends
  it) and keeps the initials until it has drawn or if it cannot load. The items inside the native `Others` dropdown
  keep SF Symbols: UIMenu/Android menu items accept symbol names, not an
  authenticated remote image.
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
  eligible personal Queue, Diary, Account, and Queue operations when a scanner
  operator has queue access — routes under `app/(tabs)/others/`) are intentionally
  pseudo-tabs (`lib/operations-navigation.ts`):

  - Selecting the pseudo-tab whose section is already on screen is a no-op.
  - Changing pseudo-tabs always uses `replace()`, never `push()`, so repeated
    selections do not stack duplicate queue/diary/account screens.
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

- **True top on iOS (#935).** Under `contentInsetAdjustmentBehavior="automatic"`
  a page rests at a negative offset (the status bar, plus any native header),
  but `useScrollToTop` scrolls to y 0, and iOS clamps programmatic and restored
  offsets to the raw `contentInset` (0). A tab re-press or a return to the app
  (e.g. back from the browser) therefore left the page that far below its top.
  Scroll-to-top screens use `useTrueTopScroll(ref)` (`lib/use-true-top-scroll.ts`)
  instead of `useScrollToTop(ref)` and spread its `scrollProps`: it learns the
  true top from the offsets seen before the first drag, scrolls there on
  re-press, sets `scrollToOverflowEnabled`, and moves a page iOS restored to
  y 0 back to its true top. Android rests at 0 and is unchanged. A guard test
  fails when a screen with the automatic inset calls `useScrollToTop` directly.

## Design system

Tokens (`theme/`: `colors`, `space`, `radius`, `type`, `motion`, `pressed`) and
the primitives `AppText` and `PressableFeedback` are specified in
[`DESIGN.md` §12](./DESIGN.md#12-mobile-specifics). `NavRow`, `RowButton`,
`ActionButton`, `ToggleRow` and `AuthButton` are migrated; remaining screens move
over as they are touched, guarded by `pnpm check:mobile-tokens` (H55, H59).
All screen text sizes now use `type.*` tokens, including conditional sizes;
bold text stops at 700 (#1165). The token guard has a zero font-size budget
and rejects 800/900 weights. Proportional avatar initials remain geometry-derived.
Primary row labels, names, and choices release their single-line limit at
accessibility text sizes (#1166); secondary metadata may stay truncated.
Fixed navigation titles and live-camera overlays retain the shared chrome cap
and navigation labels shrink to fit.

Responsive layout: `theme/layout.ts` (size-class gutters, readable widths),
`theme/layout-screens.ts` (scanner/operator column, stat block and action
layouts), `theme/layout-participant.ts` (`useParticipantLayout`: centred
form/list/grid columns) and `lib/pane-width.ts` (list pane share, column
counts, badge-beside-title rule). Pure functions, so every layout decision is
unit-tested; screens never branch on a device model.

## Foldables and large screens

One app that resizes, not a layout per device: nothing branches on a device model
or a fold posture, only on the window the app has right now (`lib/window-size.ts`).

- **Size classes.** `windowSizeClass(width)`: compact < 600 dp (phones, a folded
  cover display), medium < 840 dp (a Galaxy Z Fold inner display in portrait),
  expanded from 840 dp (Pixel Fold inner, tablets). `useWindowSizeClass()`
  re-renders on every resize and keeps nothing between renders.
- **Other breakpoints.** All live in `lib/window-size.ts`, named, each with the verified
  layout that keeps it off 600/840: `TABLET_TAB_BAR_MIN_WIDTH` (700, so the portrait Fold
  inner display at ~673 dp keeps the phone tab bar), `TABLET_LANDSCAPE_MIN_*` (1100 × 800,
  the labelled tablet rail; a Duo book at 951 dp keeps the 64 dp column) and
  `ANDROID_LIST_DETAIL_MIN_*` (640 × 600, two panes on the Fold inner display in portrait).
  `SideRegion.tabletRail` marks the labelled rail; nothing infers it from the column width.
  Android has no reserved-region API, so it reserves `ANDROID_RAIL_COLUMN_SIZE` (76 dp,
  the whole symbol bar plus a gap) in route content.
- **Hardware keyboard.** `modules/hardware-shortcuts` (iOS: iPad keyboard, Mac Designed for
  iPad) registers Command+1...9 for the destinations in visible order (direct cells, then
  overflow) and Command+, for Account, from `components/opaque-router-tabs.tsx`. React Native
  0.86 has no iOS key-event API, so this is a local Expo module (`UIKeyCommand` on the root
  view controller): it needs a native rebuild and is a no-op in older development clients.
- **Orientation.** `app.json` no longer locks portrait: the lock made Android
  12L+ letterbox the app on an unfolded display and Android 16 ignores it there.
  `lib/screen-orientation.ts` (`expo-screen-orientation`) locks portrait while the
  *physical display's* smallest side is under 600 dp and its long side is at least 1.6
  times the short one (an iPhone Duo panel is squarish), and unlocks it otherwise, and
  re-evaluates when the display changes (fold, unfold). It is decided on the
  display, not the window, so split-screen cannot flip it. iPhone keeps its portrait-only
  `Info.plist`; iPad lists all four orientations (`ios.infoPlist`). The module is a
  native dependency: a development client built without it applies no lock until it
  is rebuilt (the lookup fails soft).
- **Readable column.** `components/adaptive-frame.tsx` wraps the navigator in
  `app/_layout.tsx` and every `Modal` sheet (and, as `SheetFrame`, every native
  modal route). Compact/medium content is capped at 720 dp, expanded content at
  960 dp. Large landscape windows (at least 1100 × 800 dp) give the root
  navigator the whole window instead: navigation belongs at the display edge,
  not inside a centred reading column. Schedule uses a 420 dp list beside a
  detail pane capped at 760 dp; smaller expanded windows retain the 380 dp list.
  The Scanner uses the same list/detail rule (`lib/scan-pane.ts`): where
  `listDetailLayout().enabled`, the reader stays on the left and a scanned badge or QR opens that
  person's profile (`PersonOperationsScreen` with `embedded`) on the right instead of pushing
  `scan/person/[id]`; a new scan replaces the person, Android back clears the pane, and the person
  route hands a deep link or a people-list/history tap to the scanner as `personId` params. Compact
  windows still push the route.
  "View people" opens the people finder over the scanner pane only. On iOS the pane is its own
  native stack (`components/pane-people-stack.ios.tsx`, an independent react-navigation tree):
  its root bar carries the title, role filter and sync status, `People` is pushed with the native
  large title, back item, integrated search and filter, and the route's header is hidden
  (`headerShown: false`) because a native bar over the pane swallows touches on RN chrome drawn
  under it. Android and web use `PeopleFinderPane`, an RN panel with the same header.
  `lib/scan-pane.ts` holds the pure rules (`peopleDestination`, `backAction`, `collapseProgress`).
  An empty detail pane (no scan yet, no activity selected) shows `PanePlaceholder`, a
  ContentUnavailableView-style symbol, headline and line that fade out when a result replaces them.
  The scanner surface (`NfcScannerSurface`) never scrolls: it measures its own height and
  `surfaceFit`/`readerFit` (`theme/layout-screens.ts`) switch to a dense stats line and a row of
  icon-over-label actions, then shrink and hide the reader symbol, instead.
  Sheets retain their own content cap. The tree is identical at every width, so fold, unfold and window resizing never
  remount the navigator or lose a draft; `test/ui/adaptive-layout.test.tsx` covers it.
- **Asymmetric safe areas.** On a foldable iPhone the system status indicators and
  the Dynamic Island run down one side and the horizontal insets differ by pose, and
  a plain `ScrollView` never insets for them. Foreground content is padded per edge:
  root screens through `contentStyle` in `app/_layout.tsx`, each tab's Stack through
  `useTabStackScreenOptions` (`lib/navigation.ts`; the foldable `TabSlot` stays
  unpadded so the system can move its native bars into the column). The large
  tablet sidebar instead pads `TabSlot` itself, keeping native headers aligned
  with their content without double-padding screens, sheets through `SheetFrame` (which measures the
  sheet's own safe area). Backgrounds still fill the display. The DEV badge clears the
  same side.
- **Vertical tab bar.** Apple moves bars to the side wherever it reserves a column
  (outer display, inner display in landscape, the outer edge of a Split View half) and
  keeps horizontal bars on the inner display in portrait. The system only moves bars it
  owns, so the custom tab bar does it itself: a horizontal inset of at least 56 pt
  (`lib/side-region.ts`) puts `VerticalTabBar` in that column, on the same side,
  bottom-aligned below the indicators, symbol only (labels stay the accessibility
  names), with the overflow circle underneath; the number of direct tabs follows the
  height left below the indicators (`routerTabBarVerticalBudget`). Landscape iOS
  windows with at least 600 pt of height also reserve a leading rail. Large
  landscape windows (at least 1100 × 800 dp) use a 200 dp sidebar with labelled
  destinations; smaller windows keep the 64 dp symbol rail.
  Portrait and narrow split-screen windows restore the bottom bar without
  remounting the screen. A system-owned foldable column takes precedence.
  The rail is top-aligned below the title band on large landscape windows;
  smaller foldable windows keep the system-aligned bottom rail.
  iPad retains its native horizontal header controls; native navigation bars in foldable tab
  screens span the full window, so the system moves their icon items (back, bell,
  add, edit) into the same column, above the tab bar; custom views in a toolbar (the
  filter) stay horizontal.
- **System behaviour kept.** `MainActivity` already declares
  `configChanges="...|screenSize|screenLayout|smallestScreenSize|orientation"`, so
  resizing never recreates the activity, and `windowSoftInputMode="adjustResize"`.
  Insets come from `react-native-safe-area-context`, per edge.

**Bar colour.** The navigation theme paints the same page background behind
floating bars and sidebars, avoiding a visible seam with the navigation library's
default canvas on iPad and Duo. Activities, My Projects and Contacts paint their native header with the page colour
(`headerStyle.backgroundColor`), like Schedule: the system blur materials read whiter than the page. The
two-pane Schedule keeps per-column title bands, with `components/system-blur.tsx` (`expo-blur`, a native
dependency) behind the detail title.

**Fold and island (iOS 27.1).** `modules/fold-region` reads `UIView.reservedRegions(kind:)`
for the key window: `getDivisionRegion()` is the fold, `getOcclusionRegion()` the Dynamic Island,
both in window points, `null` before iOS 27.1 or when no region is active; `getVerticalBarEdge()` is
`traitCollection.verticalBarEdge`, the edge the system puts its vertical bar on. In Split View the
left app gets the column on its left edge while its safe-area insets stay 0, so `useSideInsets`
(`lib/vertical-bar-edge.ts`) folds a 64 pt column into the insets from that edge. The profile avatar's
collapse uses the island region as its morph target (it sits in the side column on a foldable
iPhone, not at the top centre). `lib/fold-region.ts` has `useDivisionRegion()` and `AdaptiveFrame` spans both pages of a vertical fold (book pose) and Schedule and Gallery put the list before the crease and the detail after it (`bookCrease()`, `listDetailLayout(..., crease)`). The pose is polled every 400 ms (`POSE_POLL_MS`) because moving the hinge changes neither the window size nor the traits, so the native event alone left the previous pose on screen. A horizontal
fold (laptop or tabletop) is not avoided: the whole display stays available so lists scroll to the real bottom edge. Schedule and Gallery
show list and detail side by side on expanded windows (840 dp and up). The module is a native dependency: it needs a
rebuilt development client, and without it every call reports "no region".

Other foldables (Android, Samsung, Pixel, Xiaomi, Honor): the size classes, the 720 dp
readable column, the orientation policy (no portrait lock on a 600 dp+ or squarish display),
per-edge content padding and the side-region tab bar are driven by window size and safe-area
insets, not by a device model, so they apply wherever the platform reports those values.
The iOS 26 toolbar items (`EntryBackToolbar`, symbol buttons) are iOS-only; Android keeps its
own headers. Untested on a device or emulator so far (no Android foldable run yet).

Not built: native `UITabBarController` tabs (the system would move them itself; the custom Liquid Glass shell is kept), a Jetpack WindowManager fold feature for Android (React Native exposes none; it would need a
native module over Jetpack WindowManager `FoldingFeature`), two-pane list/detail
layouts for expanded windows, and dual-screen devices that span a hinge (Surface Duo).
The iPhone Duo guidance in the third-party skills is iOS 27.1-specific and was used
only for its framework-neutral principles.

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
  sizes, the composition is centered. Opening the keyboard shifts only the
  form upward with a compositor transform; its layout and the account/application
  note anchored at the safe-area bottom do not move. The note shows the configured
  `EXPO_PUBLIC_EVENT_WEBSITE_URL` as selectable text but deliberately does not
  link out to account creation (see `docs/mobile-release.md`). The
  uncontrolled native credential fields use the username/current-password
  pairing so password managers can fill both credentials together after their
  provider sheet temporarily moves focus away from the app. Session
  revalidation after Passwords/Face ID returns never unmounts the auth
  navigator, so the native fields that receive the selected values remain the
  same instances. The app restores the field that opened the provider sheet
  once iOS settles its return transition, preventing a late AutoFill event
  from moving password focus back to email; iOS additionally associates the domain through
  `webcredentials`. The mobile root uses one authoritative, repeatable-read
  `GET /api/me` snapshot for session validity, role-derived event access,
  profile and navigation facts. A background revalidation retains the existing
  snapshot reference when its JSON data is unchanged, avoiding context-wide
  screen updates while still publishing changed labels, profile data, and
  capabilities. Input-heavy authentication screens consume the separately
  stable session-action context instead, so profile changes never re-render
  their native credential fields;
  Better Auth remains the cookie/sign-in/sign-out transport and does not run a
  second session probe on startup.
  If authentication succeeds but the account lacks role-derived `hasEventAccess`, the app
  revokes that device session and returns to sign-in with a native, modal
  access-denied alert. The route signal is consumed before presentation so
  VoiceOver does not hear the same denial again after a remount. `hasEventAccess`
  is also part of the synchronous protected-stack guard: an ineligible account
  never mounts an event screen while its asynchronous sign-out is running.
  (accounts come from the web onboarding/invite flows, H10/H12).
- Sign-out is local-first (`lib/auth-client.ts`):
  the shared `signOut()` helper clears the SecureStore session (including
  chunked variants) and the in-memory session atom before notifying the
  `/api/me` store, so a device with no reachable server is signed out
  immediately and lands on sign-in. Server-side session revocation then runs
  as a best-effort, fire-and-forget `POST /api/auth/sign-out` with the
  pre-captured cookie; a failed revoke never blocks, retries, or surfaces an
  error (#757). Recovery, account, and pending-removal surfaces expose `Back
  to sign in`; that action clears the local session synchronously and replaces
  the route without waiting for SecureStore or the server. The session-recovery
  surface deliberately has no second sign-out control: it would perform the
  same local escape and make environment-switch recovery ambiguous.
- `app/(auth)/forgot-password.tsx` and `reset-password.tsx` share the same
  leading, task-first composition. Their primary actions remain discoverable,
  invalid values are explained beside the relevant field, and focus moves to
  the first correction. They use the same fixed composition at every text size,
  preserving field focus and entered values while the keyboard opens or closes.
  The request uses
  `lib/password-reset.ts` to keep the platform boundary explicit: iOS keeps
  the `hackos://reset-password` native callback, while Android requests the
  event website's `/reset-password` callback so Better Auth appends the token
  to the browser form instead of opening the native route or returning raw API
  output.
- `app/_layout.tsx` keeps a neutral background while the authenticated profile
  restores. It only announces and renders the session progress state
  (`components/session-state.tsx`) after a 500 ms grace period, so a normal
  fast restore does not flash an intermediate screen. When the current Better
  Auth session has its own cached `/api/me` profile, a "Continue offline"
  action appears after a further short grace period and restores only that
  session-bound profile; it never searches or restores another account's
  cache. A persistent recovery error still shows retry and one local
  `Back to sign in` action.

Mobile filter triggers draw one background: standalone `FilterMenu` owns its circular glass surface; native `Stack.Toolbar.View` callers hide the shared toolbar background, while Queue Operations uses `embedded` to let its native header item own the background.

## Participant screens

### My Projects (H16–H20, H38, H60; #1011)

The existing personal `queue` tab and overflow route now open **My Projects**,
a native stack (`app/(tabs)/queue/`): the list with a native large title, **New
project** (`/queue/new`, a modal sheet with Cancel / Create in the header, the
name field focused, Create disabled until valid or when the server's
`canCreate` is false; successful creation atomically replaces the sheet with
the project editor, avoiding a native dismissal/push race) and the **Invitations** inbox (`/queue/invites`: inviter
and project per row, Decline / Accept glass buttons, the row leaves at once and
returns with the server's reason on failure). The list shows every project as a
grouped row with its draft/submitted state and a queue brief per challenge
(position, wait, called, presenting) from `/api/queue/me`; an Invitations glass
button appears above it only while invitations are pending. The live queue
view is retained at `/projects/queue`, with its tutorial, pre-call
notifications, SSE updates and polling. `/projects/:id` is the submission
screen: the name field (its footer shows the save state and, when the server
provides `submissionsCloseAt`, the deadline), grouped form sections, challenge
rows, team with an Invite row, and a floating Submit / Resubmit glass button. A frozen submitted project (`canWithdraw`, inside the submission window) shows a **Withdraw submission** glass button instead, with a confirmation, which calls `POST /api/me/projects/:id/withdraw-submission`; the project becomes a draft again and leaves the gallery and queue until it is submitted again (H20, H21). Staff return and manual repositories stay web-only.
A **GitHub** section links the project to a repository through the GitHub App (the system browser returns via `hackos://github-callback`, see [github-activity](./github-activity.md)), unlinks it, and the read view shows the repository link; commit and pull-request counts stay web-only (H18).
Queue context lives on My Projects and the queue screen, not in the editor. Leaving a team uses the authenticated
`DELETE /api/me/projects/:id/leave` route after confirmation. No planning-record conversion or
external submission path remains in the native client.

The reusable `DynamicForm` consumes `TemplateField` and `FormSection` from
`@hackos/shared/forms`, the application/project schema. File fields use the
system document picker; a file answer is one attachment row (thumbnail or
document icon, name, type and size) that opens the in-app viewer
(`components/file-viewer.tsx`: photos with pinch zoom, PDFs via
`react-native-pdf`, Share in the header). Photo fields (`images`, project form
only, up to `MAX_IMAGES_PER_FIELD`) open the system photo picker with
multi-select; each photo is re-encoded on device as a JPEG of at most 2048 px
(HEIC never reaches the API) and uploaded one by one with its own
Idempotency-Key. The answer is a horizontal carousel of 4:3 tiles with a corner
remove button and an Add photos tile; a tap opens `components/photo-carousel.tsx`
(full screen, swipe between photos, pinch zoom, "2 / 5"). Uploads use
project-scoped multipart requests with Expo `File` parts (Expo fetch does not
serialize legacy React Native URI-only parts). Required answers are validated
by the server on submission, without blocking drafts.
`ProjectDraftWriter` serializes autosaves with optimistic revisions; newer
edits survive an older save completing. A failed save retains answers for retry,
and a conflict requires explicitly reloading the project. Writers live per
project for the app session (`projectDraftWriter` in `lib/projects.ts`), not
per screen: leaving the editor (back button or swipe) never blocks, saves and
running uploads finish in the background (`trackProjectTask`), an upload that
completes after the editor closed still saves its answer, and reopening the
project or My Projects waits for them (`settleProjectDrafts`); answers that
could not be saved are resumed by the next editor instead of dropped.

Activity reminders are scheduled on the device (`lib/local-reminders.ts`,
`lib/use-local-reminders.ts`, mounted as `LocalReminders` in `app/_layout.tsx`);
see [notifications.md](./notifications.md#device-local-activity-reminders-h51-h59)
for the sync triggers, the 50-reminder budget and the server fallback.

Gallery list/detail (`/projects/gallery`, `/projects/:id?gallery=1`) use the
server's phase/audience projection, never a persisted mobile gallery cache. The last result per account and
filter is kept in memory only: returning from a project shows it untouched and
refetches quietly only after 30 s, and the list never blanks while refreshing.
Before the gallery opens (`project_gallery_opens_at`, unset = closed) the API
answers 403 with `details.reason` `gallery_closed` (and `opensAt`) or
`gallery_audience`; the gallery shows "The gallery opens …" / "The gallery
isn't open yet" instead of a permission error. Project staff (PROJECTS_READ)
browse it at any time. Search and challenge filters are paginated; outdated responses cannot replace
a newer filter result. The gallery listens to the `domain:projects`, `domain:directory` and
`public-content` streams: any signal schedules one quiet refresh after a random
0–3 s delay (re-reading the pages already shown), and a 60 s poll runs only while one of
those streams is disconnected (`useStreamRefresh`, also used by the schedule, reminders
and challenge brief screens). A refresh merges by project id, so unchanged rows are not repainted. Only returned member photos and published winner fields
are rendered. The gallery photo follows the networking-profile photo toggle,
which is the only photo control; My Projects has none. Members appear by name
per H18. Challenge rows on the project page and editor open the challenge brief
(`/projects/challenge?challengeId=`, `components/challenge-detail.tsx`): the
company (logo, name, website), description, public evaluation criteria and
prizes from `GET /api/public/challenges`, plus a Projects row to the filtered
gallery only once the gallery answers with projects for it (it is 403 before
publication). A company's challenges in the diary open the same brief as a
sheet stacked over the company sheet. Each project on a profile opens its page;
the server decides who may read it. The challenge filter is the native filter menu (multi-select, kept open while choosing; the glass toolbar button is the only filter control) so it scales past a dozen challenges.

Several projects list as one grouped row section (name, draft/submitted,
chevron); the editor lists the chosen challenges (mandatory ones with a lock) and an
Add challenge row that opens a picker sheet (`/projects/challenges?id=`,
presented modally like Invite teammate, with a confirm circle): mandatory
challenges pinned and locked under "Required", every other challenge below with
checkmarks and native search, so any number of challenges stays usable; changes
apply at once and revert with the server's reason, and everything is read-only
when the server closes editing. A 403 from the project or gallery reads shows
the permission message without a retry action (retrying cannot change the
audience), 404/403 on gallery detail likewise. A failed invitation read does not
hide the participant's projects, and a failed accept/decline refreshes the
invitation list. The Invite teammate sheet suggests the participant's diary
contacts (people whose badge they scanned, minus current members), filtered
by what is typed; a contact is invited by account (`{ userId }`, accepted by
the API only for the inviter's own diary contacts), anyone else by email. Uploads surface server rejections (413 uses the too-large copy).

Native UI fixtures exercise the screen contract and autosave concurrency;
they are not device screenshots or proof of native toolbar behavior.


- `app/(tabs)/schedule.tsx`, `queue.tsx`, `schedule/alerts.tsx` (inbox sheet),
  `others/account.tsx`, and `components/wallet-screen.tsx` (an overlay of
  Account, or `others/wallet` for deep links) — the five participant screens. API-backed screens expose
  loading, retryable error, and empty states without leaking rejected promises.
  The account screen displays the shared `/api/me` profile and keeps the
  participant-facing overview short. Pulling down refreshes `/api/me` and the
  food-intolerance labels; the label dictionary is also cached on device
  (`lib/offline-cache.ts`) so a device that goes offline before its first
  successful fetch still shows dietary labels instead of bare numeric ids.
  The account photo uses the shared scroll-driven `ProfileAvatarCollapse`
  overlay described below, so it remains clipped while it moves into the
  device's top camera cutout.
  Food intolerances opens `app/profile-tasks.tsx` to edit the dietary answer,
  including an explicit "No restrictions" option (#933) that `PATCH /api/me`
  records as a confirmed empty answer; the row is read-only offline or once
  `dietaryLocked` (H7: after an accepted application the first answer is allowed,
  then only staff change it; the next-entry prompt then skips the dietary step).
  The screen follows the other form modals: grouped sections (No restrictions,
  intolerances, a dedicated Dietary notes section matching the web
  `foodIntoleranceNotes` field, read-only while No restrictions is on), a
  centred title, and floating close/confirm glass buttons instead of bottom
  action buttons.
  "Edit networking profile" (#934, #935), always shown in the same section, opens the
  `app/networking-profile.tsx` modal (`components/networking-profile-screen.tsx`,
  `lib/networking-profile.ts`). It opens on a **preview**: the card exactly as
  people who scan the owner see it (`preview` from `GET /api/me/public-profile`,
  rendered by the same `components/profile-card.tsx` the diary's person screen
  uses), under an always-visible "Share my profile" switch. In the preview that
  switch saves on its own (optimistic, rolled back with a localized error if the
  PUT fails); a card that is not shared yet is drawn at half opacity and the
  sheet starts in edit mode. The header follows the other form sheets
  (`FloatingGlassButton`): X closes, pencil enters edit mode; while editing, X
  discards the changes (back to the preview) and the checkmark saves.
  **Edit mode** keeps the layout and edits in place: headline under the name,
  bio and where-to-find-you as inputs, the account photo through
  `ProfilePhotoMenu`. Small eyes (`VisibilityToggle`, a `switch` role) sit on
  the name (full surname), the photo, the project and challenges rows and the CV
  tile; closed (`eye.slash`) means scanners do not get it, and the element stays
  on screen greyed instead of disappearing (while projects are hidden the card
  carries none, so the last ones seen, or a placeholder row, are shown greyed).
  Saving is `PUT /api/me/public-profile` under one `Idempotency-Key` per change
  set; the response replaces the preview. It omits `socials` (links stay on web)
  and sends `shareCv` only when a CV exists.
  **CV** (the side tile): a CV taken from the application (`cv.source:
  "application"`) always wins and is read-only here, with only the eye. With no
  application CV the phone manages the upload with `expo-document-picker`
  (`lib/profile-cv.ts`): with no CV the tile reads "Upload CV"; an uploaded CV
  shows the tile with its eye plus Replace CV and Remove CV (confirmed) rows.
  A PDF over 5 MB or a non-PDF is refused before sending, and the API's
  400/413/409 answers map to localized errors. Upload and removal save on their
  own (`POST`/`DELETE /api/me/public-profile/cv`, one `Idempotency-Key` per
  attempt, a spinner on the tile) like the photo; only sharing waits for Save.
  Sponsor representatives (`isSponsorRep`) also
  see a Meals section listing `GET /api/me/meal-plan`, reloaded on every focus
  and cached under `user:<id>:meal-plan` so sign-out and 401 invalidation clear
  it. Toggles only change a local draft; Save (shown while an open meal is
  unanswered or edited) submits the whole plan with `PUT`, so an unticked meal
  is an explicit "not attending", matching the web checklist. Locked meals are
  disabled, and offline the last cached plan is shown read-only.
  The same `app/profile-tasks.tsx` modal is the next-entry prompt: the root
  `_layout.tsx` (`ProfileTasksPrompt`, `lib/profile-tasks.ts`) pushes it once per
  signed-in session when a fresh `/api/me` lists `pendingProfileTasks`, never
  while offline, before the initial session and the `/` redirect settle, or on a
  scanner route (`/scan…`, `/activities/:id`, `/activities/person/…`,
  `/others/person/…`), waiting until the operator leaves it. The sheet records
  the presentation when it mounts; "Later" or dismissing it defers the prompt
  until a sign-out or app restart. If the meal plan fails to load, the dietary
  answer can still be saved and the plan retried; if only the meal-plan `PUT`
  fails, the stored dietary answer is kept and a retry resends just the plan.
  Signing out while offline with a scanning capability warns first that
  re-authentication needs a live server. The overview is grouped into Profile, Contact, Event
  details, App, Account, and Session; staff with personal logistics-statistics
  access or `sponsors:manage` also see a Staff section (Statistics and Company
  tags respectively, [below](#company-tags-935)). Its Storage row opens
  `app/(tabs)/others/storage.tsx`, which contains storage controls only. Staff
  Statistics opens `app/(tabs)/others/statistics.tsx`, with personal scan
  counts and a link to scan history; Legal opens
  `app/(tabs)/others/legal.tsx`, which keeps the privacy policy and terms links
  together with Open-source licenses (`app/(tabs)/others/licenses/`,
  `components/licenses-screen.tsx`): every npm package in the shipped
  JavaScript bundle with its notice truncated to four lines and a link to its
  source repository (from the manifest's `repository`, else `homepage`), under
  a compact transparent header; a package opens its full notice. The list is `assets/licenses.json`, generated from the iOS and Android
  export source maps by `pnpm --filter @hackos/mobile generate:licenses`
  (`scripts/generate-licenses.mjs`); rerun it and commit the result whenever a
  dependency is added, removed or upgraded. Third-party native libraries
  vendored by those packages (CocoaPods, Gradle) are not listed yet. Sign out is the final action on the main account screen. Its Delete
  account row opens a
  dedicated page that reads `GET /api/me/removal-eligibility`: the page has a
  consequence screen and an inline verification screen, with no progress
  indicator or verification modal. Deletion has no offline fallback — if the
  eligibility fetch fails, the screen shows a plain "no internet connection"
  message (deletion cannot proceed without a live server) and recovers on its
  own via pull-to-refresh or reconnection, with no retry button. It keeps the server-selected distinction
  between full account deletion and account closure with anonymous audit-data
  retention (H54), while the user-facing action remains "Delete my account".
  The first screen discloses the possible retained audit fields; the second
  uses a native six-digit code field, a cooldown-protected resend action, and
  high-contrast inline errors for incorrect, expired, and failed requests. Its
  verification layout is intentionally fixed and non-scrollable: the input
  stays anchored below the native header, keyboard avoidance resizes the lower
  action area, and the destructive warning/button reserve space above the
  floating tab bar.
  Each new visit starts at the consequence screen, even when a previous visit
  sent a code. The action remains available while the participant is inside;
  the API returns a pending-exit state, revokes access, and allows only the
  validated staff exit before finalization. For staff with a scan capability or
  `LOGISTICS_STATS`, the Statistics screen shows a "My stats" section
  (`/api/me/logistics/stats`) with totals, a type breakdown, the searchable
  scan-history screen (`app/(tabs)/others/scan-log.tsx`,
  `/api/logistics/scan-log`, grouped by day into `Section`s with a native list
  look). If the stats fetch fails, the totals/breakdown sections are hidden
  entirely (rather than showing "—" placeholders) behind a "couldn't load"
  message, and pull-to-refresh — not a retry button — is how the screen
  recovers. The full sync-queue reconciliation screen
  (`app/(tabs)/others/sync-queue.tsx`) is kept separate from Statistics. The
  Storage screen carries the
  "App storage" section (`lib/storage-usage.ts`) showing the size of the offline API
  fallback cache (`lib/offline-cache.ts`) and of downloaded files sitting in
  the OS cache directory (wallet passes), plus the durable attendance roster
  for operators, and a confirmed "Clear cache" action. Clearing never touches the
  offline scan queue — the only record of not-yet-synced scans — or the auth
  session; see "Scanner cache encryption & isolation" below. Ordinary account
  caches are namespaced by user/session and are cleared on logout; late writes
  that began before cleanup are serialized behind the cleanup. `wallet-screen.tsx`
  renders ticket/badge QR codes. After an eligible session is restored, a
  best-effort startup warmup stores the `/api/me/ticket` payload under an
  account-scoped cache key and discards a response if the session changes. The
  screen reads with `useCachedApi`'s `cacheFirst` option: the stored payload
  renders as soon as storage answers, without waiting for a slow or unreachable
  server, while the request revalidates it; only a failed request adds the
  stale-data banner (`components/stale-data-banner.tsx`,
  reused across schedule, queue, wallet, notifications, sponsor announcement
  management, queue operations, and the scanner's sync-queue/activities/people
  screens for this offline pattern). The banner has
  no retry button — every screen that can show it also wires pull-to-refresh
  (`RefreshControl`) to the same reload, and `lib/format-date.ts` renders its
  "last update" timestamp as a bare time for today, "Yesterday, <time>" for
  yesterday, a weekday name for the rest of the week, and a short date beyond
  that. Accepted
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
  the existing `saveUrl` endpoint via `Linking.openURL`. On Android, the `.pkpass` download first
  hands its `expo-file-system` content URI to the local Android-only
  `modules/wallet-handoff` module. One system chooser resolves `ACTION_VIEW`
  across the canonical MIME type and every supported legacy alias using
  `EXTRA_ALTERNATE_INTENTS`; a default Google Wallet handler no longer hides
  an installed importer accepting a different alias. Each intent carries a
  read grant and URI ClipData. Scoped manifest queries let Android discover
  those handlers without broad package visibility. No handler (or an older dev
  client missing this module) falls back to Expo's share/save sheet. The chooser
  can only offer apps that declare `.pkpass` import support; it does not add
  support to an OEM wallet. A new Android native build is required.
  `queue.tsx` refetches immediately on a "queue" push
  (below) and also polls `GET /api/queue/me` every 15s while focused as a
  fallback. Participant ranks exclude waiting sibling entries of teams already
  called, in a room, presenting or completed in the same shared queue. My queue
  refreshes when the tab regains focus and keeps its last response on the device
  (`cacheFirst`), shown under the "Offline data" banner when the server does
  not answer; My Projects shares that cache entry. On a phone its header is the
  compact translucent title used by Open-source licenses. On the first visit to My queue for each
  account, the app shows a
  persisted native tutorial explaining the three participant-facing stages:
  get ready (do not go to the room), wait outside the door, and enter only
  after the explicit entry notice or staff instruction. The tutorial shows one
  stage at a time with Back/Next controls; participants can skip it and reopen
  it from the queue screen's "How the queue works" card at any time. The title
  and subtitle stay anchored at the safe-area top, while the centered active
  stage gets the available space and the centered Skip action sits above the
  fixed footer buttons without a divider. The measured body only becomes
  scrollable when a smaller screen, taller stage, or Dynamic Type needs it;
  stage changes use a short directional fade, reduced to an opacity-only
  crossfade when Reduce Motion is enabled. Completion is stored in
  account-scoped SecureStore and does not change the queue state machine.
  The inbox (`components/alerts-screen.tsx`, presented as a modal sheet from
  the Schedule bell at `schedule/alerts`) pages past the initial 20 messages on
  demand. A row swipes left to delete (after native confirmation) and right to
  mark read/unread (`POST /api/me/notifications/:id/unread`). The sheet header
  has an inline centered title (20pt bold) on the screen background with no
  hairline, close (X) alone on the left and the unread-only envelope-badge filter next
  to the gear on the right (`Stack.Toolbar` on Liquid Glass,
  `headerLeft`/`headerRight` elsewhere). Settings are not in the sheet: the
  gear dismisses it and opens `others/account?highlight=notifications&highlightAt=<nonce>` (fresh per tap, so every tap replays from the top), which
  Account consumes once (shows the page at its true top — the resting offset
  under the large-title inset, so the avatar starts expanded — then after the
  transition settles animates the scroll to the Notifications row and flashes it
  for about a second — no animation under Reduce Motion — then clears the
  param). Account →
  Notifications (`components/notification-settings-screen.tsx`,
  `others/notification-settings/`) lists each notification type with its state;
  a type opens its channel switches. Activity reminders
  (`components/reminders-view.tsx`) continues with a bulk switch per activity
  type (the label side, marked by a chevron, opens that type's activities).
  The header search (`lib/use-header-search.ts`, same native configuration as
  Schedule) replaces the type list with the matching activities, each with its
  own reminder switch; the per-type screen has the same search. Switch rows use `ToggleRow` from
  `components/native-ui.tsx`; any other `Switch` placed in a row needs
  `SWITCH_IN_ROW_STYLE`, because React Native's iOS Switch defaults to
  `alignSelf: "flex-start"` and otherwise sits at the top of the row.
  Reminder times use a leading column sized for the locale's longest time
  (12-hour vs 24-hour), on one line.
  Announcement management (`others/announcements`) sits under Notifications →
  Send for `announcements:manage` holders. On Android the
  inbox mounts the same native scroll gesture boundary as Schedule, so
  vertical scrolling takes precedence over a row's horizontal delete reveal.
  A third "Manage"
  segment (`ANNOUNCEMENTS_MANAGE` only) adds announcement administration —
  `components/announcement-manage-view.tsx` lists admin announcements with
  the same swipeable edit/delete rows as Schedule
  (`components/schedule-swipe-row.tsx`, reused as-is), and both the header
  Add button and a row's swipe-to-edit open
  `components/announcement-form-modal.tsx`, which mirrors the web admin's
  `AnnouncementFormModal` field-for-field (H50) — same
  audience/specific-recipient targeting exclusivity, per-announcement
  channel candidates, and the notify-only-vs-screen-placed window
  distinction. The recipient picker hits
  `GET /api/announcements/recipient-candidates`
  (`lib/announcements-admin.ts`'s `fetchAnnouncementRecipientCandidates`),
  scoped to `ANNOUNCEMENTS_MANAGE` rather than the broader `USERS_READ`,
  mirroring `/api/schedule/owner-candidates`. The mobile announcement and
  schedule forms share their sheet shell, translation disclosure and people
  picker UI through `components/form-modal-sections.tsx`; each modal retains
  its own fields and submission state.
- `components/wallet-screen.tsx` — the ticket/badge toggle is a `SegmentedControl`
  plus a swipe over the QR card itself as an alternative. The swipe gesture is
  nested *inside* the page's `ScrollView`, so it declares itself simultaneous with a `Gesture.Native()`
  stand-in for the `ScrollView` — without that relationship the ancestor
  ScrollView's own gesture wins outright and the swipe never activates at all.
  Switching sides (by swipe or by tapping the control) plays a directional
  cross-slide: the incoming card enters from the side the drag came from
  while the outgoing one exits the other way (Reanimated's
  `SlideInLeft`/`SlideInRight`/`SlideOutLeft`/`SlideOutRight`, keyed on the
  selected index so both play simultaneously). The swipeable host view keeps
  a fixed `minHeight` matching the full card's own height, so a badge that
  isn't assigned yet — a much shorter `EmptyState` — doesn't shrink the
  touch area available for swiping back. Known remaining limitation: Android
  reserves its screen-edge strips for the system Back gesture, which can
  still swallow a swipe that starts very close to either edge before this
  screen ever sees the touch; there is no in-app fix for that short of a
  native `setSystemGestureExclusionRects` call.
- **Event time (H45/H47).** Every schedule time, day grouping, reminder row,
  presence timeline entry and `DateTimeField` is the event's clock, not the
  phone's. `lib/me-context.tsx` publishes `GET /api/me`'s `eventTimezone`
  (cached offline with the profile) to `lib/event-time.ts`; screens format with
  `formatEventTime` / `eventDayKey` and re-render through `useEventTimeZone`.
  The native pickers only speak the phone's zone, so `DateTimeField` feeds them
  the event wall clock as device-local fields (`toPickerDate`) and converts the
  result back (`fromPickerDate`); props and callbacks stay real instants. A
  terse zone name (e.g. "CEST") follows a time only when the zone differs from
  the phone's. Not yet converted: scan logs, scanner confirmations and sync
  queue timestamps, which describe when something happened on this device.
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
  anticipation before the next. The time gutter reserves 76pt and clamps its
  labels to one line, keeping 12-hour meridiems such as `AM`/`PM` attached to
  their time. Adjacent overlapping entries get a warning
  glyph in the time gutter (`entriesOverlap`, `lib/schedule.ts`). The
  reminder bell sits absolutely positioned in the card's top-right corner
  (`hitSlop` — a 44pt touch box stretched the row and pulled the bell off the
  title, #374) and toggles the H59 per-category notification model
  **straight from the list** via `lib/use-schedule-notifications.ts`;
  filled/accent means on, outline/grey off. The header branches on
  `isRealLiquidGlassAvailable()` (`components/glass-view.tsx`): on iOS 26+ it's
  a real native header (`app/(tabs)/schedule/_layout.tsx` gives this tab its
  own Stack so `navigation.setOptions` can drive one) with a compact
  left-aligned title, `Stack.Toolbar.Button` pair for the Alerts bell (unread
  count badge, `lib/use-unread-notifications.ts`) and the filter —
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
  everyone, audience filter only to `schedule:read` / `schedule:manage` holders (edit, delete and the + button stay `schedule:manage`-only). The custom tab
  bar is an absolute overlay, so the screen keeps its full-height content and
  the list can pass behind the translucent Liquid Glass surface (opaque on
  Android and earlier iOS). In light mode the hackOS adapter uses the native
  interactive `regular` material for the outer tab surface, preserving the
  visible liquid-glass rim used by the app's other floating controls; dark
  mode keeps the clearer material. Its direct surface is one native gesture
  surface: the selection lens follows the finger from touch-down and
  navigation commits on release to the tab cell under the finger, while the
  separate Others circle remains its own menu (native `MenuView` on iOS; a
  hand-rolled card matching that look on Android — see `navigation.md`). On
  the native-search path,
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
  responsible-person picker). Its sheet shell, translation disclosure and
  people picker UI are shared with the announcement form in
  `components/form-modal-sections.tsx`. Title and description are required in
  only one language: when the editor's own language is blank,
  `prepareScheduleSubmission`
  (`lib/schedule-save.ts`) promotes the first filled translation and sends its
  `titleLanguage`. A failed save shows the localized reason
  (`scheduleSaveError`: business/validation errors from the API, the
  connection message only when the request never got a response) in a banner
  at the top of the form, scrolled into view. The schedule has no mobile push
  channel (`content.schedule.changed` rides the public content topic), so the
  list and detail screens refetch on focus and foreground and on every
  `public-content` signal (`useStreamRefresh`, random 0–3 s delay; the
  `SCHEDULE_POLL_MS` (60 s) poll runs only while focused and that stream is
  disconnected); both support pull-to-refresh. On Android, manager schedules also mount one
  native gesture on the `SectionList`; each row waits for that vertical gesture
  to fail before its horizontal swipe can activate, keeping diagonal/vertical
  drags in the list (issue #626). The row's `hitSlop` additionally excludes its
  non-interactive time column from the swipe's touch-starting area entirely, so
  a scroll begun there is never offered to the row gesture in the first place.
  Reminder writes use one serialized optimistic
  queue: individual last-item category promotion is included in the same PUT,
  and committed preference snapshots update mounted caches without triggering
  inbox/unread reloads. Covered by `test/ui/schedule-list.test.tsx`,
  `test/ui/schedule-swipe-row.test.tsx`, and `lib/notification-events.test.ts`.
- `app/schedule/[id].tsx` — iOS uses the native large-title navigation bar
  (`headerLargeTitle` + `headerTransparent` on the `schedule/[id]`
  `Stack.Screen` in `app/_layout.tsx`, `contentInsetAdjustmentBehavior=
  "automatic"` on the `ScrollView`): the activity title is the native title,
  so it collapses into one tail-ellipsized line beside the system Back and
  reminder controls. Android uses the same in-screen glass
  chrome as the Schedule tab: a single-line, tail-ellipsized title with back
  and reminder actions, clear of its status-bar inset, rather than the native
  Material app bar. The Android header is pinned above the scroll view; the
  initial content is inset below it, then scrolls naturally underneath it.
  Staff details follow the schedule rules: staff-only items omit
  scan/visibility/publish fields, and already-visible items omit the spent
  publish date. On iOS, the reminder bell is a proper `headerRight` item and
  back is an explicit localized chevron with a safe fallback for direct links;
  on Android those actions live in the custom header. Admins get a floating
  glass pencil (bottom-right,
  clear of the home indicator) that opens the same `ScheduleFormModal` as the
  list's swipe-to-edit. List cards visibly mark staff-only, sponsor-only, and
  mentor-only activities when their audience is restricted to exactly that
  group.

### Event diary (#935)

`components/diary-screen.tsx`, routed as `app/(tabs)/diary/index.tsx` (its own
`Stack`, like Schedule, so the screen can drive a native header) when the tab
is direct and `app/(tabs)/others/diary.tsx` inside Others (`diary` is an
`OVERFLOW_TAB_KEYS` entry; see `docs/navigation.md` for placement). One
segmented control splits it into **People** | **Companies**. There is no
directory to browse: people get into the diary only by a badge scan. The
`?view=people` / `?view=companies` route parameter opens a segment directly.
Pull-to-refresh, focus and foregrounding refetch, which is also how a person
who was scanned sees the scanner appear (scans are mutual when the scanner
shares a profile, `diary.md`). The list itself is never written to the
offline cache, so a profile hidden later cannot reappear from device storage;
without a connection the screen shows the offline state (`RequestFeedback`:
"You're offline" with Retry). Scanning still works offline: a code that never
reached the server is queued on the device (`lib/diary-pending.ts`, one entry
per code, cleared with the account's other caches), "Waiting for connection: n"
shows above the scan button, and the queue is sent on reconnect, on focus and
on launch; a code the server answers (accepted or refused) leaves the queue.

The diary uses the system header, laid out like Activities. On iOS 26
(`isRealLiquidGlassAvailable`) it is the transparent native bar: the list
scrolls under it with the system scroll-edge effect. iOS has no left-aligned
title on the bar row (`headerTitleAlign` is Android-only, and react-native-screens
4.26 does not expose iOS 26's `inlineLarge` large-title mode), so the
navigation title is empty and "Agenda" is a leading `Stack.Toolbar.View` with
`hidesSharedBackground` (28pt heavy, `accessibilityRole="header"`). That title
uses a fixed black or white from the app's colour scheme, not the dynamic
label colour: iOS 26 flips a bar item's light/dark appearance with what
scrolls behind it, which turned a dynamic-colour title white for a moment over
the blue scan pill (Activities has the same fix). The native search
(`headerSearchBarOptions`, `integratedButton` placement) and the favourites
star, a native `Stack.Toolbar.Button` (`star` / `star.fill`) drawn as the same
circle as the search button, sit on the right, with a wallet button after them (`wallet.pass`) that opens the
badge/ticket wallet in a full-screen modal (`WalletModal` in
`components/account-wallet.tsx`, the same `WalletScreen` and close button as
Account's overlay, H28), opened on the badge (`initialPurpose="badge"`), the
card someone you meet scans; Account opens on the ticket. The ticket and badge
cards keep fixed sides (ticket left, badge right): a swipe left goes to the
badge, and each card's slide follows from its own index. The wallet button stays on Companies. On iOS 26, search uses the same native `integratedButton` as Schedule: expanding it replaces the toolbar actions, and cancelling restores them. Android and earlier iOS use
`LegacyScreenHeader`: the title, a glass star toggle, the wallet button and the search button that
expands into the field. Search and the star apply to People only, and only
once it has someone to search; on Companies the native search and the star are
removed (`LegacyScreenHeader`'s `searchEnabled` hides its search button) and leaving People clears the query.
Below the header, the scroll content starts with the shared scan pill
(`BadgeLinkActions`, as on the scanner screens), then the People | Companies
control, then the list.

**People** lists the `kind: "person"` entries of `GET /api/me/diary` (favourites
first, then newest) and a quiet unavailable row for a hidden profile. Saving
and favouriting are separate: the star (`components/favourite-star.tsx`, drawn
as a filled/outline path on Android, whose Material font only has the outline
glyph) only marks a saved person and drives the Favourites filter; the row menu
holds Note (500 characters; `components/diary-note-editor.tsx` is a native
page sheet with circular Cancel and Save and a field above the keyboard, the
same editor for people and stands) and an explicit "Remove from diary" with
confirmation. Un-starring never removes anyone. Search filters saved cards
locally by name, headline, project, challenges, location and the owner's note,
ignoring accents and case; cards never carry an email, so contact details are
not searchable. Rows (`components/diary-person-row.tsx`) are one full-width
pressable that opens the profile; the trailing star and menu are separate
siblings so they never also open it. A profile hidden after it was saved keeps
only the menu (no star). The diary's header owns the status-bar area on both
platforms; the profile keeps an Android status-bar scrim, so scrolled content
never slides behind the clock.

`app/people/[id].tsx` (`components/person-profile-screen.tsx`) is a saved
person's full profile from `GET /api/directory/:userId` (the only directory
route left; there is no list and no Save, since only a scan adds someone):
large photo or initials, name, headline, Favourite / Note / CV tiles (the Note
tile reads "Edit note" once a note exists, and the note section appears only
then), bio, links, location (a `mappin`), project, challenges and
"Remove from diary", which then returns to the diary. iOS uses the transparent native detail
header (`transparentDetailHeaderOptions`, as the scanner's person detail), so
no bar covers the centred avatar; Android floats its own glass back button.
That public photo uses the same `ProfileAvatarCollapse` overlay as the signed-in
account: Reanimated maps 120 pt of upward scroll to the shared mask and dark
cover progress. An avatar that starts farther from the camera than the pose
where Telegram's mask begins (its centre 234/300 of its size below the cutout's
lower edge) first rides up with the content, unchanged and at the text's own
speed, for that extra distance (`profileAvatarCarryDistance`); the in-content
avatar stays visible through that carry and the mask takes over only as the
morph starts, so a lower avatar (Account below the Wallet button, the person
profile under its header) never shoots up ahead of the text. The 120 pt range
then begins after the carry. The Android gooey view below already rises with
the content, so it has no carry. A released drag never rests half-morphed: inside
that range direction decides, from the last non-zero scroll delta (the release velocity only
without one). Moving up, with the merge started, auto-collapses; moving down,
with the droplet coming out, auto-expands; only a release with no movement
takes the nearer rest. The expanded rest is where the morph starts, and a
release during the carry is plain scrolling and stays put. A moving release decides when its momentum ends, by the
momentum's own direction (instant under Reduce Motion); programmatic scrolls
are never snapped. One medium haptic marks the photo touching the camera
cutout on the way up (morph progress 0.2 after the carry, where the mask's
lip joins the island) and the first pull out of the collapsed rest on the way down; a
release never taps. Both rests are measured from the true
top, which on iOS sits at a negative content offset under the automatic inset
(at least the status-bar overlap, or the full native header height on a
screen that shows one, such as the person profile's transparent header,
seeded once the host is measured, then lowered by scroll events before the
first drag), never from y 0, which is inside the morph. Both scroll views set `scrollToOverflowEnabled`: iOS otherwise clamps every
programmatic scroll to the raw `contentInset` (0), so a snap or jump to the
true top landed at y 0, mid-morph. A page too short to reach the collapsed
rest snaps expanded instead, so the person profile floors its content at the
viewport plus the carry and collapse distance past the true top (`contentMinHeight`):
otherwise a short profile could only ever expand. Account's tab re-press and gear scroll go to that true top,
and on focus it moves a scroll left inside the morph (such as a remount
restoring y 0) to the nearer rest. A native `MaskedView` clips the original cubic keyframes from
Telegram's `UserAvatarMask` (`lib/telegram-avatar-mask.json`), evaluated on the
UI thread rather than approximating the connection with a circle/capsule union.
The source asset is TelegramMessenger/Telegram-iOS's UserAvatarMask animation;
its two path tracks retain their original 512-point coordinates, timing and
layer lifetime. The canvas converges to the cutout's lower edge as in Swift's
`PeerInfoHeaderNode`; it does not paint a replacement system island. A black
backing follows mask progress, with the separate `-0.25 + progress * 1.55`
fade curve and the radial gradient stops from `DynamicIslandBlurNode`.
The React Native cover currently uses dark paint rather than UIKit's animated
native blur. Static photos and initials share the mask; optional live avatar
children remain inside it.
On iOS, the target uses window-space safe-area geometry because UIKit does not
expose the Dynamic Island frame to apps. The hardware island is 126 x 37.33 pt
with its top at `safeAreaTop - 48` (11 pt on a 59 pt inset, 14 pt on a 62 pt
inset; screens 393/402/430/440 wide). The target is that rectangle inset 1 pt on
every side (124 x 35.33 pt, horizontally centred on the window) so the shrinking
avatar and black backing hide inside the island instead of poking out. The
avatar and target are both measured in the same `measureInWindow` coordinate
space, and the host is re-measured about 450 and 900 ms after layout so a screen
that is still sliding in (stack push, modal) does not leave a stale origin. A
measurement waits until the scroll offset has held still for a frame and is
retried if it moved meanwhile, because Fabric measures the committed shadow tree
(whose scroll state trails the live offset); otherwise a programmatic scroll,
such as the alerts gear's jump to notification preferences, would leave the
mask drawn away from the avatar. The
mask frame centre travels linearly from the avatar centre to the target centre,
matching the Telegram path canvas, so the image, mask and backing stay on one
centre line and end on the island centre. The Telegram blob rises and narrows
faster than that linear frame, so while it exists the image is a square
centred on the blob's real bounds (`profileAvatarContentFrame`), plus the neck
above it, never exposing the backing at its top. The image also carries its
own clip (`profileAvatarContentRadii`): until the neck forms (morph progress
0.15) the mask is exactly the circle inscribed in that square, so the image is
cut to the same circle (radius half its side, starting at the expanded size)
and no frame shows it square while the native mask catches up; the top corners
then straighten as the neck fills the top of the frame. The image never follows the
linear frame: the mask reaches the island at a fixed progress whatever the
start's distance, so on a lower avatar (the person profile under its header)
the linear frame trails below the clip and would pull the photo off centre.
Once the blob ends its last square eases into the island. The
lower-lip track of the path (bezier handles included) is narrowed to the
straight run of the island's lower edge (`width - height`; a circular hole
punch gets the chord at the lip's depth), so it never reaches into the
island's curved corners.
The morph only runs where a real camera cutout exists:

- **iPhone with Dynamic Island** (safe-area top >= 55 pt, portrait): the island
  geometry above, unchanged.
- **Android with a hole punch**: the target is the actual cutout, read at
  runtime from `WindowInsets.getDisplayCutout().boundingRects` (API 28+) through
  `CameraCapabilities.getDisplayCutoutRects()` in `modules/camera-capabilities`
  (rects in dp, window coordinates, re-read on rotation/resize). On Android 12+
  (API 31) each rect is tightened to the cutout's own shape
  (`DisplayCutout.getCutoutPath()` clipped to that rect), because OEMs often pad
  the reported rects. The target is a circle (a hole punch is round): the largest
  circle centred in the measured rect, so its diameter sets the morph width. A rect is a hole
  punch when both sides are <= 72 dp and it sits in the top 96 dp, so centered
  and off-center punches (and small waterdrops) work; the topmost one wins. Wide
  notches and side cutouts are ignored. **This needs a new native Android build**
  (development client and store build); on an older build the module lacks the
  function and Android uses the plain collapse. With a hole punch, Android does
  not use the island mask above (its keyframes squeeze a small round target
  into a thin vertical needle); it uses the native gooey view described below.
- **Duo lateral island, no cutout, unknown, API < 28, iPhone notch / no Dynamic Island, landscape**
  (`hasCutout: false`): no morph and no overlay (`simple`). The avatar stays in
  the scroll content: it holds still and shrinks to 0.75 until the view right
  below it (the name block, wired with `onNameLayout`) reaches its shrunken
  bottom, then scrolls up and off screen with the page, so it never parks at
  the top or covers the name. The release offset is the measured layout gap
  plus half the shrink (`profileAvatarSimpleReleaseOffset`); the transform is
  `profileAvatarSimpleTransform`. No snap, no haptics and no
  `contentMinHeight` floor apply, since nothing is ever half-morphed.

`cameraCutoutFrame` (a `useProfileAvatarCollapse` option) still overrides the
target for OEM placements in the top camera band. A lateral Duo island uses the in-content collapse so the avatar never crosses the page diagonally into the system rail. Reduced Motion uses the same in-content path without
the hold or shrink: the avatar simply scrolls with the page.

#### Android hole-punch gooey morph

`modules/profile-gooey` is a local Android-only Expo module exporting
`ProfileGooeyView` (Kotlin `ExpoView`; `null` on iOS, web and on a binary
built before the module existed). `ProfileAvatarCollapse` renders it only when
`Platform.OS === "android"`, the target has a hole punch, Reduce Motion is off
and the native view exists; every other case keeps the paths above unchanged
(iOS never reaches it).

- **Children**: one React child, the avatar circle (photo, initials or live
  content), laid out once by Yoga at the expanded frame. The native view draws
  its recorded display list scaled uniformly onto the animated circle and
  clipped to that circle, so photo and initials alike behave as one raster and
  are never re-laid out. `ExpoView` is a `LinearLayout`, so the view overrides
  `onMeasure`/`onLayout`: otherwise an Android layout pass re-measures the child
  at wrap-content (the whole canvas) and the avatar is drawn as a tall rounded
  rectangle.
- **Static props** (dp, view-local): `holeX`, `holeY`, `holeDiameter`.
- **Animated props** from `useAnimatedProps` on the UI thread, no per-frame JS:
  `avatarX`, `avatarY`, `avatarDiameter`, `darkness`, `blurRadius`,
  `bridgeReach`, `pill`, `drip`, all computed by `profileGooeyFrame` in
  `lib/profile-avatar-collapse.ts` from `profileGooeyProgress(scrollOffset, 120)`.
- **Timeline** (`profileGooeyFrame`, a pure function of progress and the
  scroll distance, so scrolling back retraces it exactly). The avatar never
  stops rising: its bottom edge moves up with the content, keeping its gap to
  the text below, or along an ease-in path to the lens centre when that is
  higher, so it is in the lens by progress 1. It stays a circle and shrinks
  uniformly towards its top to 1 dp inside the lens by 0.55
  (`PROFILE_GOOEY_SHRINK_END`), gliding to the lens column; until then it also
  keeps at least the staging gap (0.9 lens diameters) below the lens, so a
  photo never touches it. It blurs (up to 6 dp) and darkens (`darkness`) from
  55% of the shrink (`PROFILE_GOOEY_FADE_START`), is 85% black once fully
  shrunk, and turns fully black exactly at the staging gap, where the black
  metaball neck starts (two-circle tangent construction, emerging from a
  point), fattens into a straight-sided pill (`pill`) that shortens into the
  lens, and a short drip bulges from the lens and retracts.
- **Rendering**: while `darkness < 1` the avatar is drawn clipped to its
  circle (which also trims the blur, so nothing bleeds outside it) over a black
  underlay that fills the rim the blur leaves translucent, with a black wash of
  `darkness` on top; above it the ink draws only the lens. Once fully black,
  the ink's own avatar disc, neck, pill and drip replace it at the same size
  and position, so there is never a second blob or a coloured halo.
  Android 12+ (API 31) records the ink into a reused `RenderNode`, blurs it with
  `RenderEffect` and composites it through an alpha-threshold color matrix
  (liquid edges); the avatar goes through a second reused node with the
  progressive blur. Android 9–11 draws the same
  shapes directly, anti-aliased, without blur. No bitmaps are allocated; both
  nodes drop their display lists and effects on detach. The canvas is the
  avatar/lens bounds plus a 24 dp margin (`PROFILE_GOOEY_MARGIN`).

Differences from Telegram Android's profile header: Telegram reads the cutout
from the private `config_mainBuiltInDisplayCutout` resource and drops
non-centred cutouts, we use the public `DisplayCutout` API (off-centre punches
work); Telegram ends the avatar at half the lens width and moves it in one
straight line, we end at the lens size and stage it under the lens first so a
large photo never stretches toward the camera; Telegram's goo is a
blur-threshold of the whole avatar on every API level (a CPU stack blur below
Android 12), ours is a geometric neck, only softened by a GPU blur on 12+;
devices without a hole punch keep our plain collapse instead of Telegram's
black status-bar target.

**Testing on a Pixel (9a or any hole-punch device)**: build a development
client (`pnpm --filter @hackos/mobile android`, or an EAS development build;
a JS-only reload is not enough the first time), sign in, open Others ›
Account and scroll up slowly: the photo (or initials) should stay a perfect
circle, shrink as one picture while darkening and blurring into a black disc
the size of the lens just below it, then rise with a liquid neck and disappear
into the lens, with no second blob or coloured halo at any point. Scroll back down slowly to watch the droplet come out and
regrow; release mid-way to check it snaps to a rest; repeat quickly with a
fling. Repeat on a person profile (Diary › a person). Check dark mode, with
a centred punch hole on an emulator (the system image's Pixel overlays carry
the real cutout: `adb shell cmd overlay enable
com.android.internal.emulation.pixel_9` plus `adb shell wm size 1080x2424`;
the emulator reports the hole to apps but does not paint it black), and with Remove animations on (plain circle collapse, no
neck). On a device without a cutout the plain collapse must be unchanged.
The CV route needs the session, so it is
downloaded with the session cookie (`expo-file-system`) into the cache and shown
in the in-app viewer (`components/cv-viewer.tsx`, a CV-worded wrapper of the
shared `components/file-viewer.tsx`): a page-sheet modal titled
with the person's name, a circular close button, and pages that scroll with
pinch and double-tap zoom, rendered by the native `react-native-pdf` (with its
peer `react-native-blob-util`). Share stays in the viewer header for anyone who
wants the file. The native reader is imported only when the CV viewer opens, so
Expo Go or a development client missing the native module does not block profile
screens; that viewer shows the normal CV error instead. A CV that is gone or no
longer shared (404) shows "Profile not available"; any other failure offers
Retry. **Native dependency:** adding `react-native-pdf` means the development
client and store builds must be rebuilt; Jest mocks it in `jest.setup.js`. The
app does not show the user's own
CV anywhere yet, so the viewer has one caller. A hidden profile and a person the reader may not open both answer 404
and show one "Profile not available" state. Photos are authenticated API
routes: `useApiImage` (`components/person-avatar.tsx`) hands `expo-image` the
`apiImageSource` from `lib/directory.ts` — the session cookie as a header and a
cache key tagged with the session — and every caller keeps
`cachePolicy="memory"`, so a photo is never written to disk and one hidden later
is gone after the next launch. The fallback (initials or symbol) stays until the
photo has drawn. Public sponsor logos use `expo-image`'s default disk cache.
Skia, which decodes bytes itself, still reads photos through `loadApiImage`
(an in-memory data URI cache). **Native dependency:** `expo-image` needs a
rebuilt development client and store build.

**Companies** is a sticker album (`components/company-album.tsx`) from
`GET /api/me/diary/sponsors`: a progress ring with collected / total, then a
three-column grid in the API's order (sponsor priority, then name, as the public logo grid; collected and uncollected interleaved). Collected companies are full-colour logos on a white disc
and open a company sheet (logo, collected date, Favourite / Note (or Edit
note) / Web, the
description, challenges, note and "Remove from collection"); companies still to
find (every revealed scannable one, even before its tags are generated) are dashed slots with a silhouette of the logo, a lock and their name
only (never opened; the sheet and its description, challenges and website
exist only once collected).
Stand favourites and notes use the same `PATCH`/`DELETE /api/me/diary/:entryId`.

Scanning follows R008: the primary "Scan with NFC" control opens the existing
reader immediately (`lib/nfc-reader.ts`, UID only, never writes or claims the
tag; `lib/nfc-uid.ts` normalization), one tap from the list. "Scan QR code"
(the gated `QrCamera`) and "Enter code" sit in the compact ellipsis menu.
"Enter code" opens the shared `ScannerCodeEntry` with `appearance="system"`
(the light/dark card of the note editor, not the dark camera card) and a title
that fits badges and stand tags alike. On hardware without NFC the primary
control becomes "Scan QR code". Cancelling any
input sends nothing. Each scan is `POST /api/me/diary/scan` with a fresh
`Idempotency-Key`. A saved person is pinned in a Saved section at the top of
People; a collected stand switches to Companies, where its badge springs in
with a fading halo and a success haptic. Every error code (`diary_code_unknown`,
`badge_revoked`, `profile_not_shared`, `stand_unavailable`, `diary_self`, 403
for an account without event access, 429) maps to its own localized alert
(`lib/diary.ts`); none names a person. Badges, stand tags and the staff
scanners share the NFC-A UID encoding, so a stand tag is never accepted as a
badge (`diary.md`).

**Meeting someone.** A scan that adds a person who was not yet in the loaded
diary (never a re-scan, never a stand) plays `components/connection-celebration.tsx`:
a transparent full-screen `Modal` (or, for a QR scan, an overlay inside the
scanner's own modal, which stays up until the result arrives so the animation
starts at once instead of waiting for the camera to slide away) where the viewer's photo (from `useMeContext`)
and the scanned person's slide in from opposite edges (a 0.85 s ease-in that keeps accelerating until they meet, which
starts after about 0.2 s, once the overlay and canvas have painted) and fuse like metaballs
(`components/connection-celebration-skia.tsx`, `@shopify/react-native-skia`): the
two accent blobs behind the photos go through a Skia blur plus an alpha-threshold
`ColorMatrix` layer, so a neck of goo stretches between them and settles into a
shared accent rim as the photos overlap with a single spring overshoot (damping ratio about 0.6, no repeated wobble). Then a ring,
ten particles in the accent color burst from the join (about
3.2 s; a tap skips it). The ring and particles stay hidden until the burst.
The new person joins the list, and their profile (`/people/[id]`) opens, only
once the overlay covers the screen (about 0.2 s in, or on an earlier skip), so
the card never shows before the animation and the profile is already open
underneath when it fades. The photo routes are authenticated, so
the bytes come from `loadApiImage` (session cookie) and are decoded with
`Skia.Image.MakeImageFromEncoded`; until they arrive, or without a photo, the
circle shows initials. Frames are driven by Reanimated shared values that Skia
reads directly, so they stay on the UI thread. Skia paints with color strings,
so the scene carries the light/dark systemBlue and ground hex values instead of
the dynamic `colors` tokens. Where Skia cannot load (web) or throws while
rendering (an error boundary), the earlier Reanimated version plays instead: the
same beats as spring transforms with a squash, no goo. Skia is a native module
(no config plugin; the `ios/`/`android/` projects are generated), so adding it
needed a new native build, not an OTA update. Haptics through
`lib/haptics.ts`: light and medium as the photos approach, success at the
merge (the lib has no user setting; it is best-effort and silent where there is
no engine). A tap anywhere skips it; it never outlasts its timer. Under
reduced motion it is a 1.1 s crossfade of the two photos and the glyph, with no
Skia canvas, travel, ring or particles and only the success haptic. It announces
`diaryConnected` ("You are now connected with {name}") to screen readers and
labels the overlay with it. The API reports `created` only as the status code
(201 vs 200), which `apiFetch` does not expose, so "new" is decided against the
loaded diary entries. Not verified on a device.

`apiFetch` returns API timestamps as `Date` objects (Better Auth's client JSON
parser revives ISO strings), so diary ordering goes through `timestampOf`
rather than string comparison. Menus use `MenuTriggerIcon` (`native-ui.tsx`)
as their visible trigger: a `Pressable` inside `MenuView` takes the touch
before the menu on Android, so the menu never opened.

Physical NFC and camera verification is still pending; tests mock both
(`lib/diary.test.ts`, `lib/directory.test.ts`, `test/ui/diary-screen.test.tsx`,
`test/ui/person-profile.test.tsx`).

### Company tags (#935)

A tag may simultaneously be a current person badge and an explicitly assigned
company tag; unassigned and former person badges are valid company tags too.
Agenda scans resolve the latest server assignment (including a reassignment
while waiting for account locks), save both public destinations atomically,
and return the company in `relatedEntries` alongside the primary person.
`DiaryScreen` refreshes the album without switching tabs or playing a second
company animation while the person celebration opens their profile. Stand-only
scans retain the company album/highlight flow. A private profile is never saved
or revealed just because its badge also identifies a public stand.

Company tags are what attendees scan to collect a company in their Diary
([`diary.md`](./diary.md#company-tags)): NFC tags or wristbands linked by
serial number, and printed QR codes. Staff with `sponsors:manage`
(`canManageStands` in `lib/tabs.ts`, the same gate as the web Company tags
page) open Account → Staff → Company tags (`components/stands-screen.tsx`,
routed as `app/(tabs)/others/stands.tsx`). The screen lists
`GET /api/enterprises/stands` alphabetically with a name search (accent- and
case-insensitive). Search is the native header search
(`headerSearchBarOptions`, `integratedButton`) on iOS 26 Liquid Glass and the
shared `LegacyScreenHeader` search on older iOS and Android, as on People.
Each row shows the logo, the name, the NFC and QR counts (with "Not
scannable" for a company attendees cannot collect yet), a round NFC button
that links a tag directly and a chevron.

Both Company tags screens keep the `ScrollView` (with
`contentInsetAdjustmentBehavior="automatic"`) as the screen's root element so
the native large title collapses into the inline title as it scrolls; a
wrapping `View` hides the scroll view from the native header and the first
card draws under the title. The NFC modal lives inside the scroll view, and
only the legacy header (no Liquid Glass) wraps it.

**Company detail.** Tapping a row pushes `app/(tabs)/others/stand/[id].tsx`
(`components/stand-detail-screen.tsx`, titled with the company name). It
reads the same staff list and shows:

- a "Scannable" switch that turns the company's scanning on or off (`PUT
  /api/enterprises/:id/stand-scannable` `{ scannable }`, the web Company tags
  call, with a fresh `Idempotency-Key`); it flips at once and rolls back with
  an alert if the request fails, and while off the section footer says
  attendees can't collect the company;
- a filled "Link tag" button, the same read as the list's NFC button;
- the linked tags in "NFC tags" and "QR codes" sections (label above the
  serial or token, monospaced). Swiping a row reveals Remove (also a
  VoiceOver/TalkBack action); after a native destructive confirmation (a QR
  warns that printed copies stop working) it calls `DELETE
  /api/enterprises/:id/stand-tags/:tagId` with a fresh `Idempotency-Key`. A
  failure keeps the row and shows the server's reason. The list reloads on
  return, so its counts follow.

**Provisioning a tag.** The row's NFC button and the detail's "Link tag"
start reading at once (R008), through one shared hook
(`useStandTagLink` in `components/stand-tag-link.tsx`, with the Android read
sheet). It is the same tap as accrediting a badge, in the same order:

1. `startNfcRead` with `claimBadge` (`lib/nfc-reader.ts`, serialized with the
   other scanners) reads the UID (`lib/nfc-uid.ts`, the encoding every scanner
   uses) and writes only the Android package claim of the badge flow
   (`nfc-badge-claim.ts`: MifareUltralight pages on Android, the iOS
   tag-reader session on iOS), so Android hands the tag to hackOS. No
   `/s/<code>` link is written: the company is identified by the serial;
2. after the NFC session ends, the screen links the serial:
   `POST /api/enterprises/:id/stand-tags` `{ kind: "nfc", uid }` with a fresh
   `Idempotency-Key`. The API call never runs while the tag is held: waiting
   on the network inside the session lost the tag on real hardware. Writing
   first is harmless because the claim is the record every badge already
   carries. A 409 says whether the wristband is already someone's badge ("use
   an unassigned one") or already a company tag (`standLinkErrorKey`, from
   `usedBy`); any other failure shows the server's reason. A failed claim
   write still links the serial and says so (`claimFailed()`).

A company must also be scannable before its tags award the medal: a new
company is not (its row says "Not scannable"), and scanning answers
`stand_unavailable` until staff turn it on (the detail switch, or web Company
tags).
On the list, the result line offers "Link another" for the same company, so
several tags or wristbands are linked in a row without leaving the screen; on
the detail the new tag appears in "NFC tags" and the button stays in place. On hardware without NFC the actions stay
disabled and one line points to serial-number entry on the web. QR codes are
generated and printed from the web.

**Opening the app from a QR code.** The printed link opens `app/s/[code].tsx`, which is
outside the session guard: signed in, it sends the code to the Diary
(`?view=companies&collect=<code>`, `collectCompanyTagHref`), which collects it
through `POST /api/me/diary/scan` once and celebrates on the Companies album;
signed out, it keeps the code (`lib/company-tag-link.ts`, in memory) and
`RootLayout` resumes it after sign-in. Native wiring in `app.config.ts`:

- iOS: the `react-native-nfc-manager` plugin with `includeNdefEntitlement:
  false` (TAG reader format only; the claim is written through the tag-reader
  session, never an NDEF reader session) and `applinks:<host>` next to
  `webcredentials` in `associatedDomains`; the web serves the matching
  `apple-app-site-association` (`applinks` for `/s/*`);
- Android: `plugins/withAndroidCompanyTagLinks.js` adds a VIEW + BROWSABLE
  `autoVerify` filter for `https://<host>/s/…` to the main activity; the
  badge `TECH_DISCOVERED` filter (`withAndroidNfcTagClaim.js`) is unchanged
  and is what opens the app from a linked NFC tag. App Link verification
  needs `ANDROID_APP_CERT_SHA256` on the web
  ([`deploy/README.md`](../deploy/README.md)).

These native changes need a new build. The flow is covered by
`lib/nfc-reader.test.ts` (claim writes, with `react-native-nfc-manager`
mocked),
`test/ui/stands-screen.test.tsx`, `test/ui/stand-detail-screen.test.tsx`,
`test/ui/company-tag-link.test.tsx`,
`lib/company-tag-link.test.ts`, `test/company-tag-links-plugin.test.tsx`, the
Diary `collect` test and `lib/tabs.test.ts`. It has not been tested on NFC
hardware, and the universal/app links have not been opened on a device or
simulator build yet.

## Operator screens

### Queue operations

`components/queue-operations-screen.tsx` — Queue operations is available to
`queue:operate`, `queue:admin`, and `*`. It loads the room views of
every room the caller may list in one request (`GET /api/queue/rooms/views`). Each card keeps the
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
operator needs: full member emails, repository/demo links and the entry's
`queue_history` timeline. A caller with `projects:edit` (or `*`) can search
the project-edit candidate directory, add a selected account, and remove a
member after native confirmation. Team rows support swipe-to-reveal removal
through the single repository-member endpoint. Queue access alone never
exposes those controls.
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
`GeneralScannerScreen` (NFC-first scanners with camera/manual fallback selected by capability:
accreditation, badge replacement, door presence, meals, and activities),
a dedicated primary tab for operators (see `docs/navigation.md`). Its
person/people drill-down routes live under `app/(tabs)/scan/*`. Screen-level
scanner routes follow the system light/dark appearance: backgrounds, native
headers, glass controls, status/navigation bars and tab icons all use the same
scheme. Only the explicit camera preview retains its dark surface.
actions use `AdaptiveToolbarButton`: real Liquid Glass runtimes promote
navigation actions into UIKit's top toolbar; iOS <26 and Android use the same
44-point opaque glass buttons inline on the camera surface. The camera preview
is non-interactive so it cannot steal those hit targets on older iOS. Activity
scanning keeps queue status and statistics above the input actions; the general
scanner's queue-sync capsule uses the same native toolbar as the activity scanner, with a separate circular filter and an 8-point gap. Both screens reserve the same header height above the statistics. Scanner and activity
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
Opening a person from People Finder or a scan shows the current badge as the
last row in Personal data. When a badge is assigned, swipe that row left to
reveal the deliberate Replace and Delete actions; an unassigned person keeps
the separate Link badge action in the Accreditation section. Server lookup
responses with a null badge clear the cached badge. Mutations reload from the
freshly returned sync snapshot, and older concurrent profile/timeline requests
cannot overwrite newer loads. The presence register refreshes the timeline before enabling actions again.
Its primary button records the valid next movement; the secondary button
retains the other movement’s date/time editor for past entries and exits. Scanner error
feedback appears centered directly below Confirmed, Checked in, and Inside,
with wrapping text and flexible height so it stays in the upper scanner area.
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
below — and `lib/scanner-sync.ts` sends scanner mutations to the server first.
The server response is authoritative: an online accreditation, badge rotation,
or scan is never blocked by a local SQLite failure. Only a transport failure is
written to the encrypted offline queue, preserving the same persisted scan id
as `Idempotency-Key` for replay in creation order. The latest server
snapshot/revocation set is rendered even when its best-effort SQLite cache
write fails; SQLite is the fallback for offline directory/activity reads.
The small plaintext scannable-activity index is committed before the
event-sized encrypted people portion, so force-quitting during a newly received
snapshot cannot leave an otherwise intact offline roster without its activity
choices. Activity scans themselves are inserted into the durable per-operator
queue before a sync is attempted, and are replayed with that persisted scan ID
when the app next regains a server connection — including after a cold restart.
Scans at meals and registrable activities are attendance events, so every
locally queued repeat is accepted on replay without a confirmation conflict.
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
The dedicated sync-queue screen reconciles waiting, confirmed, and
attention-needed scans and exposes the complete local replay-error journal.
Retryable errors remain attached to their queue item until the next attempt;
permanently rejected errors remain visible until an operator explicitly
discards that scan, so a transient or business failure is never silently lost.
Failed queue rows retain the operation, person or user ID, badge when it was
available, log ID, timestamp, source, activity/direction, and notes needed to
reconcile the original action even when the local roster can no longer resolve
the person. A transient sync failure (not a business rejection) surfaces via
the same stale-data banner used elsewhere in the app, on the sync-queue,
Activities, and People screens; a genuine HTTP 409 conflict (where auto-retry
pauses) keeps its own message with a manual retry action, since that case
needs a person to look at it rather than wait for reconnection.

### Activities

**List and scanner panes.** Where `listDetailLayout` is enabled (same helper, book
crease and `resolveListPaneWidth` as Schedule), the list stays on the left with
its own title band and the selected activity's scanner opens on the right
instead of pushing `activities/[id]`: `ActivityScannerScreen` with `embedded`,
`activityId` and `topInset` draws its title, queue status pill and the scan
result overlay inside the pane, below the band (`twoPaneBandHeight`). Nothing is
selected at first, so the pane is empty and no camera or NFC session starts
unasked. The selection lives in `ActivitiesScreen` above the layout branch (it
survives rotation and a compact detour) and the scanner is keyed by activity.
`[id].tsx` in a two-pane window hands its id back to the list
(`dismissTo` with `selected`/`selectedNonce`), so deep links select the row.
Compact windows keep pushing the route. Pure helpers: `lib/activity-pane.ts`;
geometry hook and constants: `theme/layout-activity-pane.ts`. Scan, queue and
idempotency paths are unchanged.

On iOS each pane is its own native stack (`components/pane-native-stack.ios.tsx`,
an independent navigation tree) and the route sets `headerShown: false`, so no
transparent bar sits over the panes. The list pane's bar carries the shared
screen title, the kind filter as a native menu item and the integrated search.
The scanner pane's root bar carries the activity name and the queue status as a
native button item (`lib/pane-header-items.ts`; the queue sheet is hosted by
`ScannerQueueStatus triggerless`). "View people" pushes the Scanner's
`PeopleDirectoryScreen` (`nativeHeader`, `requireBadge`) over it with an icon-only
back item; a pick is scanned as if read. Pressing the selected Activities tab
again clears the selection (`lib/tab-reselect.ts`). Android and web keep the
in-page bands and `PeopleFinderPane`.

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

### NFC accreditations (H22–H26)

Physical badges now use NTAG213 NFC tags. Pairing and replacement on the
person screen keep linking as a direct primary “Link with NFC” action. A
compact ellipsis button to its right opens a native menu with the secondary
“Scan QR code” and “Enter code” alternatives. The swipe-revealed Replace badge
action opens a native system dialog with QR first, NFC as the preferred primary
action below it, and Cancel. Manual entry is available only in the linking menu.
Android draws the same stacked dialog through `lib/alert.ts` + `AlertHost`
(NFC, QR, Cancel); outside/back also dismiss it.
Badge linking renders as separate rounded Liquid Glass controls: a tinted NFC
primary capsule and a circular overflow menu, without a shared section surface.

Role selection and event-access warnings apply before the chosen input opens.
NFC opens the system Core NFC sheet on iOS and a cancelable reader overlay on
Android; typed/QR codes use the same assignment and replacement mutation paths,
including duplicate/revoked-badge and ticket validation. Manual input reuses
the camera's `ScannerCodeEntry` sheet and trims whitespace; canceling any input
submits no mutation. There is no intermediate custom method chooser.
For NFC, the seven-byte hardware UID is saved as `badgeId`,
using uppercase hexadecimal without separators; tags are neither written nor
required to contain NDEF records. This supersedes the physical QR-card medium
still described in `plan/historias-hackos.md`, following the product decision
for NFC badges; the normative plan remains unchanged pending human revision.
Existing ticket and Wallet QR codes remain readable by the camera.

Mobile list filters share `components/filter-menu` across Schedule, Activities,
People Finder, Queue operations, scanner roles and the offline sync queue. The
48-point circular trigger keeps the same horizontal-lines symbol, tinted blue
when active. iOS uses SwiftUI Menu/Toggle with action dismissal disabled; Android
uses an anchored scrollable panel that stays open between choices. Schedule kind
and audience groups retain their AND semantics and permission gates. Within each
role, kind or status group, selected values match by OR; All clears the group.

The general scanner and activity/meal scanners lead with NFC on a dark,
camera-free surface. The scanner tab uses the NFC waves symbol. iOS scanner actions use real SwiftUI
buttons (Liquid Glass on iOS 26+, bordered system buttons on earlier versions),
with equivalent glass controls on Android. Both operational scanners use the same reading area and bottom camera/manual
controls. Checked-in is the general scanner's primary count; confirmed and inside
remain secondary. Activity/meal scanners lead with total scans/servings, then
unique people and repeat scans/extra servings. Building occupancy is a separate
context metric. Both operational surfaces are fixed, non-scrolling layouts: statistics
stay at the top, the NFC symbol occupies the center of the remaining space, and
People Finder sits immediately above camera and manual entry at the bottom. Queue
status is at the top right. The general scanner's role-filter trigger is a
48 × 48 circular icon beside queue status, with the same symbol tinted blue when
active. Its native iOS SwiftUI menu disables action dismissal so operators can
select multiple roles without reopening it; Android keeps its anchored filter
panel open until dismissed. All clears the multi-selection.
The camera is a secondary explicit action for tickets, Wallet QR codes and
other QR badges. Until that action is chosen, no camera preview is mounted and
no camera permission is requested. The fallback uses the same full-screen modal camera as badge linking in the
person details. A single QR read closes the modal and releases the camera;
canceling returns to NFC without recording a scan. Manual entry remains available without camera permission.
All manual code inputs use `ScannerCodeEntry`: one opaque system-themed card
above the keyboard, with a labeled code field and adjacent Cancel/submit actions.
Manual-dialog actions use the regular control size with a 48-point minimum touch
target; bottom scanner actions retain the large size. On iOS the shared actions use native Liquid Glass buttons (opaque native buttons
on older versions); Android uses the same shared action geometry.
The manual card has a 32-point outer radius and 16-point content inset, matching
the 16-point field curves. Both iOS actions share one 48-point native HStack/Host
with safe-area adjustment disabled: the dialog owns keyboard displacement,
and a measured React Native wrapper supplies explicit native width and height.
The native row is positioned inside that 48-point wrapper, with equal-width
actions and an 8-point gap; it does not participate in sizing the card.
NFC-first and camera scans default to Register scan; Diary, badge linking and
replacement supply their own action labels. There is no camera-only dark variant.

On iOS, the general scanner opens one Core NFC session per tap. Activities and
meals never open an iOS session on entry: tapping the central NFC symbol begins a loop;
tapping it again or canceling the system reader ends it. On Android, both operational surfaces enter
with NFC enabled once hardware support and the activity are available. They show
only the tappable NFC symbol, without a session button or reader overlay. A gray
symbol means disabled; blue means enabled. The symbol toggles reading on both
platforms; there is no separate NFC session button. Android's general reader stays
enabled across reads until toggled off or navigation; the activity reader pauses
for results and operator decisions. Other badge/contact workflows retain the
Android instructional overlay. Subsequent sessions wait for native session teardown
and operator decisions, including repeat-serving confirmation. Leaving the screen
or backgrounding the app stops the loop. Activity counters include servings or
passes, distinct people, repeats and the number currently inside the building;
server counts are preferred, with the synced roster as the offline fallback.
Activities sums the same `/api/scanner/role-stats` occupancy buckets as Scanner,
without the Scanner role filter, and refreshes on focus, sync and logistics events.
A failed refresh clears the server count and uses the roster fallback.
On iOS 26+, both scanners' queue status lives in a native trailing
toolbar view, aligned with the native Back button. Its pressable icon and text
show only Ready or Needs attention (a rejected scan); background sync and pending
scans do not change the header label. Tapping it opens the Device queue sheet,
where the detailed queue state remains visible. The NFC symbol is centered between
the statistics and camera/manual actions. The idle instruction is Tap to scan
(es/gl: Toca para escanear); the three bottom actions sit just above the tab bar,
using its published inset once plus 4 points. Earlier iOS and Android place both controls at
the same safe-area offset in the floating header.
The activity result panel is centered with equal top/bottom padding and uses an opaque semantic content surface with open,
scrollable dietary details and separate tinted restriction tags. The per-person
count has no visible caption (its meaning remains in the accessibility label).
The count is orange for a repeat awaiting a decision and green only after server confirmation.
Decision actions sit side by side, stacking for narrow screens or larger text. Liquid
Glass remains on scanner controls/navigation, following Apple's
[Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)
guidance to reserve it for the functional layer and avoid overuse.
Reads reuse the identity lookup, repeat-confirmation, revocation and encrypted
offline-queue paths used by camera scans.

NFC controls stay hidden until hardware support is confirmed. Devices without NFC
retain explicit camera and manual entry, including badge linking and replacement.
The iOS usage description explains reading badge serial numbers for attendee
identification at check-in, meals, and activities. After a camera denial, the app
shows the available alternative inputs and retries permission only after an
explicit retry action where the platform permits it. NFC support checks inspect
hardware availability without starting a reader session.

`lib/nfc-reader.ts` serializes native sessions and releases them on completion,
cancellation, navigation, backgrounding and unmount. iOS uses `MifareIOS` and
Android uses NFC-A reader mode with NDEF checking skipped and takes the UID
straight from `DiscoverTag`, without a technology connection or NDEF read.
The discovery listener is installed before reader mode starts, so an already
present tag is not lost between registration and a technology request. Cancel
releases the discovery wait, removes the listener, and unregisters reader mode;
subsequent reads wait for that cleanup. Blank NTAG213s work on both platforms.

Android also claims NFC-A tags while the app is closed
(`plugins/withAndroidNfcTagClaim.js`, H22–H26): the main activity declares an
`android.nfc.action.TECH_DISCOVERED` filter with a single `NfcA` tech list.
NTAG213 badges carry a factory NDEF Capability Container in page 3 (OTP,
`E1 10 12 00`, not erasable) and no records, so without a claimant Pixel phones
show the system "New tag / Tag empty" screen; with it Android starts hackOS
instead. Tapping a badge therefore opens the app. Limits: another app claiming
NfcA produces the chooser; Android 16+ lets the user disallow tag intents per
app; apps targeting an SDK above Baklava need `DISPATCH_NFC_MESSAGE` on the
activity. Pixel behavior still needs physical verification.

While the app is in the foreground on Android, `setNfcShield(true)` (root
layout) keeps NFC-A reader mode registered between scans with no listener, so
tapping a badge outside a scan is swallowed by the app instead of reaching the
system tag dispatch ("New tag" screen or another activity). A scan replaces
that registration and `syncShield()` restores it when the scan finishes; the
shield is released on unmount and is best effort (if NFC is off or unsupported
Android falls back to the claim filter above). It never reads or writes tags.

Linking a badge by NFC (`person-operations-screen`, H22/H23) additionally
writes the tag: `startNfcRead(message, { claimBadge: true })` follows the UID
read with an NDEF message holding one Android Application Record for the
release package (`lib/nfc-badge-claim.ts`; debug builds drop their `.debug`
suffix), so any Android phone with hackOS opens it directly and one without it
is sent to the Play Store instead of the system "New tag" screen. It contains
no attendee data and the tag is never locked. Writes use raw MIFARE Ultralight
page commands on both platforms (`mifareUltralightWritePage` on Android,
`sendMifareCommandIOS` on iOS), so the iOS entitlements stay `TAG` only. The
header page is written last and every page is read back. The write
is best effort: the badge is linked by its UID anyway and the screen shows
`scannerNfcWriteFailed` after the link succeeds. Scans for
activities, meals and check-in never write. The Capability Container (page 3)
is OTP and cannot be erased, which is why a record is written instead.
Physical OEM verification remains required, especially on Oppo Find N6 with
ColorOS 16/17: pairing, consecutive reads, cancel/reopen, background and folded/
unfolded states with the same tags used on another working Android device. The iOS package patch avoids `connectToTag`, caches the detected UID, and
invalidates the native session immediately; it also skips the package's automatic
NDEF payload read. Scanners use only the UID. Unsupported hardware, disabled NFC,
malformed UIDs and reader errors produce localized feedback; cancellation does
not submit a mutation.

A new native build is required after installing `react-native-nfc-manager`;
Expo Go and iOS Simulator cannot exercise real NFC reads. Verify on physical
iPhone and Android with the same NTAG213: identical UID, pairing, replacement,
revoked-tag rejection, meals/repeats, offline replay, cancel/reopen, navigation
and background cleanup. Enable the NFC Tag Reading capability in the Apple
App ID and regenerate provisioning profiles; the Expo plugin adds TAG-only
entitlements, the usage description and Android NFC permission.

## Scanner cache encryption & isolation

Staff/scanner devices carry two distinct local caches, split into separate
SQLite files with different lifetimes, encryption keys, and OS backup
treatment (`lib/scanner-crypto.ts`, `lib/scanner-db.native.ts`). The
repository has focused adapter tests for the encryption/isolation paths;
physical iOS/Android and EAS verification remains a release-gate task in
`docs/mobile-release.md`.

- **Attendance roster** (`hackos-scanner-roster.db`, `scanner_people` +
  badges/activities/scan-count tables) — every field beyond the plaintext
  `ticket_token`/`badge_id` lookup keys (name, email, role, event access,
  `food_intolerance_notes`, `notes`, presence state) is AES-256-GCM encrypted
  as one JSON blob per person under a single roster key
  (`expo-crypto`'s `AESEncryptionKey`, persisted in `expo-secure-store`).
  The database file lives in SQLite's default document directory so a
  previously synchronized roster remains available after a cold offline
  restart. On first open after this storage change, a legacy `Paths.cache`
  database — or a roster stranded in the earlier hand-built Documents/SQLite
  migration path — and its SQLite sidecars are copied into SQLite's actual
  default directory before legacy copies are removed; if several files exist,
  the newer one wins. The roster
  is intentionally removed only by `wipeAttendanceRoster()`, which deletes
  every table, removes any residual legacy cache copy, and retires the roster
  key. It is called from
  `components/account-screen.tsx`'s sign-out handler and the
  `storage-screen.tsx` "Storage" → "Clear cache" action
  (`lib/storage-usage.ts`'s `clearAllCaches`, operators only), and a fresh
  `GET /api/scanner/snapshot` fully reconstructs it on next sign-in. Since
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
  later authenticated call. A fresh install does not create the legacy file
  just to inspect it, and retirement addresses the default `document/SQLite`
  directory through an Expo FileSystem URI on both platforms. The encrypted
  roster validates its table shape on open; a corrupt or incompatible roster
  schema is deliberately removed and rebuilt from the next snapshot, while an incompatible
  durable queue is left untouched and fails closed rather than being
  reinterpreted or deleted. A scan recorded before the server's current badge
  assignment boundary is a terminal stale-credential result: API enqueue and
  locked processing reject it, and the mobile queue deletes the encrypted
  payload rather than retrying it under the replacement participant. Devices
  that remain offline can still retain a stale identity until reconnect/expiry
  or a device wipe; central tombstones prevent permanently retired credentials
  from being accepted or re-uploaded.

## Live Activities and Live Updates (#966)

System surfaces for time-bound moments: the participant's nearest judging
queue (H38); for `activity:scan` holders, an upcoming or live meal /
scannable activity (H25/H26); a schedule item organizers opted in for its
audience (H59); the submission deadline (H19/H20); and the accreditation desk
during the arrival rush (H22/H24). The API computes every state, sends background
updates (APNs ActivityKit pushes on iOS, data-only Expo pushes on Android) and
documents the contract in [`live-activities.md`](./live-activities.md); the
app renders the pre-localized props of `@hackos/shared/live-activities`.

At an upcoming staff or attendee activity's start the widget switches to its
live layout by itself ("Live" in the compact island, "Ends in" in the
expanded and Lock Screen views): the state's `staleDate` is the start, and
the layouts read `environment.isStale` as live. See
[live-activities.md](./live-activities.md) (`stale-date`).

**Surfaces (iOS, `expo-widgets`).** `widgets/queue-activity.tsx`
(`QueueActivity`), `widgets/staff-activity.tsx` (`StaffActivity`),
`widgets/attendee-activity.tsx` (`AttendeeActivity`),
`widgets/deadline-activity.tsx` (`DeadlineActivity`) and
`widgets/accreditation-activity.tsx` (`AccreditationActivity`) are
`'widget'` layouts serialized into the `ExpoWidgetsTarget` extension, so they
use only `@expo/ui/swift-ui` and declare every helper and colour inside the
function. Pieces every kind repeats (island slot caps, `secondary`/`colorMods`,
the caption, the **Scan** circle) live in `widgets/live-activity-kit.tsx`
(#1134): the kit is itself a `'widget'` function and `withLiveActivityKit`
concatenates its source with each layout's, passing its result as the layout's
third argument, so nothing is imported inside the extension. The names must equal `LIVE_ACTIVITY_WIDGET_NAMES`. Each state
answers one question with one hero value; everything else is secondary.
Colours: waiting/upcoming = systemBlue, called = systemGreen (go), in room =
neutral grey; Always-On drops the accent fills. Lock Screen colours are
dynamic (`{ dynamic: { light, dark } }`, light green `#248A3D` for contrast)
because the layout's `environment.colorScheme` does not reliably match the
Lock Screen's appearance; the Dynamic Island is always dark. Following
Apple's HIG:

| Presentation | Queue | Staff activity |
| --- | --- | --- |
| Compact leading / trailing | `#4` / `~12m` (hourglass while the ETA is unknown); called: door / room (or the count-up when the room is unknown); in room: `person.2` / room | category symbol / countdown to the start; live: `42/180` (scanned / accredited, the denominator smaller and secondary; the bare count without one or past 7 characters) |
| Minimal | ring of the climb to the front with the position inside; called/in room: the phase symbol | live: ring of the scanned share of accredited people (the count without a denominator); upcoming: category symbol (20 pt) |
| Expanded | position / ETA (or "Estimating…"); called: door / "Go to" room; bottom: challenge · +N more queues, location · called count-up, stage track | upcoming: symbol / starts-in countdown, name, `hh:mm–hh:mm · location`; live: circular **Scan** / Scanned `42/180`, name + live state, ends-in, then scanned-share bar (elapsed time without a denominator) |
| Lock Screen | challenge … +N more queues; position leading (17 pt), ETA trailing (28 pt, accent); called: count-up leading, "Go to" over location + room (green) on one baseline trailing; stage track with labels | symbol + name and optional live state; context/ends-in leading, 28 pt countdown/Scanned `42/180` trailing; live puts circular **Scan** beside ends-in, with a full-width bar below |
| Watch Smart Stack / CarPlay (`bannerSmall`) | challenge · hero `#4`, line `~12 min`; called: "Go to" room + location; in room: room | name · countdown, or `42/180` + "Scanned"; no buttons |

Lock Screen banners keep the system's black card (design decision: it makes
the activity stand out; a transparent tint was tried and dropped). The attendee and
deadline compact slots keep the countdown as one unit in a 12 pt box (the
patched `compactCountdown="short"`, no scaling) and the symbol in a fixed,
centred box, so both sit on the axis of the vertical island of a foldable
(checked on the iPhone Duo and iPhone 18 Pro simulators).

| Presentation | Attendee activity (H59) | Submission deadline (H19) | Accreditation desk (H22) |
| --- | --- | --- | --- |
| Compact leading / trailing | countdown to the start (one unit, 12 pt) / category symbol; live: "Live" (56 pt slot) / symbol (blue) | countdown (white; grey once submitted, never red) / hourglass (open, blue), `exclamationmark.circle` (closing, red) or `checkmark.circle` (submitted, green) | `person.badge.key` / accredited count |
| Minimal | category symbol (20 pt); live: symbol with a live dot | phase symbol (20 pt); submitted: the check | ring of accredited / eligible |
| Expanded | symbol / "Starts in" or "Ends in" countdown; bottom: name + live state, `hh:mm–hh:mm · place`, live elapsed-time bar | symbol / "Closes in" countdown (28 pt, hours long; small and grey once submitted); bottom: title + status, project, window bar | circular **Scan** / Accredited `412 /600`; bottom: title + closing time, secondary arrivals and inside, then share bar |
| Lock Screen | symbol + name and optional live state; time · place leading, 28 pt countdown trailing; live adds the elapsed-time bar | symbol + title; project leading, "Closes in" countdown (28 pt) trailing; status in the header; window bar. Closing: red only on the symbol and "Not submitted"; countdown and bar stay neutral. Submitted: green "Submitted" leading, small "Closes in" time left trailing in the same row, then title, project, window bar | symbol + title … closing time; Last 10 min · Inside secondary (17 pt) leading, Accredited hero (28 pt) trailing; circular **Scan** beside secondary stats; full-width share bar |
| Watch / CarPlay | name · countdown (live: "Live" + "Ends in" time left) | title · countdown, with a "Not submitted" line (the one red element) only while closing; submitted: "Submitted" + time left | title · `412 /600` + "Accredited" |

**Watch (`.small` family).** `expo-widgets` registers
`supplementalActivityFamilies([.small, .medium])` on iOS 18+ and renders each
layout's `bannerSmall` when `@Environment(\.activityFamily)` is `.small`
(`environment.activityFamily` also reaches the layout); every other family uses
`banner`. All five kinds share one watch composition: a 13 pt glyph plus the
title in secondary, one 26 pt bold hero (the native `compactCountdown` timer,
which ticks without pushes and fits its width, or the count/room/"Submitted"),
and at most one 13 pt status line, all `lineLimit(1)` with
`minimumScaleFactor`, inside `dynamicTypeSize({ max: "xLarge" })`. The phase
accent tints the glyph only; Always-On drops it. Red appears once: the
closing deadline's "Not submitted" line (symbol and text). The timer uses the
system font, not rounded, because the countdown is the patched native view.

The attendee activity has no buttons (the whole surface opens the schedule
item). The deadline shows a status only when it is known: `submitted` is a
green check, a `draft` reads `labels.notSubmitted` (amber, red while closing)
and `null` (not in hackOS yet) shows nothing. The desk's end time is a clock
symbol and the time, because the contract has no label for it.

**Queue stage track.** Three nodes (In line → Called → In room) and two
segments; completed parts take the phase colour and the current node is
larger with a halo. Waiting is the long part of the journey, so the first
segment takes two thirds of the width: with no GeometryReader (and
`containerRelativeFrame` needing iOS 17), the row is built from three equally
flexible units, the first segment being two ProgressViews overlapped by 4 pt
and filled half by half. While waiting it fills with
`(queueTotal − position + 1) / (queueTotal + 1)` (#1 of 10 → 10/11, #10 of
10 → 1/11); once called the second segment fills with
`2 / (calledAhead + 3)` (⅔ when no team called earlier to the room is still
outside) and the room completes it. Without the counts (older server) only
the stage shows. The node labels repeat the same
units so each sits under its node. Staff meals/activities use `scanned / accredited` when a positive denominator
is available, otherwise elapsed time between `startsAt` and `endsAt`. Attendee
activities show elapsed time while live. Accreditation uses `accredited / eligible`.

**Shared visual grammar.** All five kinds follow
[`DESIGN.md`](./DESIGN.md#live-activities-on-ios-966): identity row, secondary
context leading and a primary metric trailing, then optional progress/action.
Expanded islands retain identity/position leading and the primary value trailing,
with title/context before the footer. Titles are 17 pt semibold on the Lock Screen
and 15 pt expanded; primary values are 28 pt, secondary values 17 pt, captions
12 pt and context 13 pt. Upcoming sessions no longer compress the title beside
the countdown. Accreditation gives arrivals/occupancy less visual weight.

**Margins and shapes.** The Lock Screen uses one 14 pt margin on every edge
and stays within the 160 pt height (the live header is a single line for
that reason). The only filled control, **Scan**, is a 44 pt circle with a
20 pt NFC symbol and localized VoiceOver label. It sits beside the secondary
values on the Lock Screen and in the expanded leading slot, leaving a separate
full-width progress row. There are no tiles or cards
behind symbols. Fields and labels added after v1 (`calledAt`,
`queueTotal`, `calledAhead`, `accredited`, `labels.estimating` …) are optional:
an absent one hides its element; the widget never falls back to hardcoded
copy.

Numbers use `monospacedDigit` with numeric content transitions; countdowns,
the count-up since the call and the elapsed-time bar are SwiftUI timers, so
they tick without updates.

**Fitting the Dynamic Island (#966, #1171).** Every widget wraps its compact
leading, compact trailing and minimal views in hard width caps of 24, 56 and
36 pt (the queue's compact leading is 40 pt, so a three-digit position fits;
a live attendee activity's is 56 pt, so "Live"/"En curso" fits, keeping the
staff activity's 80 pt total) with a fixed Dynamic Type size (`dynamicTypeSize("large")`), so no
value, locale or text size can widen the island; text scales down
(`minimumScaleFactor(0.6)`) instead of truncating. The cap is
`frame(idealWidth: cap, maxWidth: cap)` under `fixedSize`: without the ideal
width, `fixedSize`'s open proposal passed through the frame, the content kept
its full width and spilled past the island's edge, and the scale factor never
applied (#1171). Expanded leading and trailing sit beside the TrueDepth camera
in regions the system sizes; anything there that refuses its proposal
(`fixedSize`) grows into the sensor housing. So the kit's `islandSide` wraps
both regions (8 pt off the curved corners, `minimumScaleFactor(0.6)`, fixed
type size) and nothing inside them, or inside a compact/minimal slot, is
`fixedSize`; numbers keep their full width only on the Lock Screen. Beside the
camera and in compact slots a ratio past seven characters (`1142/1380`) shows
only the count (`ratioParts`); the bar keeps the share. Fonts are fixed point
sizes (`Font.system(size:)`), so accessibility text sizes do not grow them.
The Lock Screen (also the banner on iPhones without a Dynamic Island) stays
within 160 pt: the called queue puts the location on the room's baseline and
the submitted deadline puts its time left in the hero row, instead of extra
rows. `test/live-activity-widgets.test.tsx` ("Dynamic Island safe areas")
asserts these structural rules; it cannot show pixels, so device screenshots
with two simultaneous activities remain the visual check. Every countdown surface uses `2h 34m` / `34m`
normally, colon notation in the last five minutes (`4:59`), then `48s` below a
minute (including `bannerSmall`). A value beside a unit never has a leading zero
(`1h 5m`, `9m`, `9s`): the fields are as wide as their digits, and zero padding
appears only in colon notation. Always-On uses the native `isLuminanceReduced`
environment to show minutes only (`4m`) or `<1m` below a minute; waking restores
the colon form, with no placeholder. `Text`'s
`compactCountdown` (`short` keeps only the leading unit, `12h`, `38m`, `45s`, and is what
the compact island slot uses so it fits the vertical island of a foldable; the other form names share the
precision policy;
`patches/@expo__ui@57.0.22.patch`) draws each number from a live
`Text(timerInterval:)`, clipped to its digits next to static `h`/`m`/`s`.
Monospaced digits keep the fields aligned. `ViewThatFits` fits the fixed-width
row at 100%, 88%, 76%, then 60%, without dropping relevant seconds.
**Decision:** checked on the iOS 26.5 simulator over 90 s, a unit format
over a live date source (`Duration.UnitsFormatStyle` over
`.durationOffset`) renders nothing, `Date.ComponentsFormatStyle` renders
once and freezes (19–29 s off the timer), `SystemFormatStyle.Timer`,
`.offset` and `.reference` spell units out, and a custom format style is
redacted; only timer text ticks. The form is chosen when the activity
renders, and a stale date does not re-render it, so the props carry
`countdownUnderHour`, `countdownShortMinutes`, `countdownUnderTenMinutes`,
`countdownLastFiveMinutes`, `countdownLastMinute` and `countdownLastTenSeconds`:
they flip at each width boundary (every full hour and ten minutes after it, ten
minutes, five minutes, a minute, ten seconds), sending one update each through
the worker's normal hash path. The foreground app reconciles at every boundary
(`nextPhaseBoundary`). Until that update lands the old width remains: the
timer can briefly read `h 59m` at the hour, or `09s` at ten seconds. Taps open the props' `url` (passed as the
activity's static URL); the API must send the same `attributes.url` on
push-to-start. APNs props reach the layouts directly, so a props version
other than `1` renders only the title. Room and activity names truncate;
only numbers keep their full width. `test/live-activity-widgets.test.tsx`
evaluates the serialized layouts with nothing but `@expo/ui/swift-ui` in
scope and covers the track fill, the staff `scanned/accredited` ratio, the old-server
(v1 labels) fallbacks and, for the newer kinds, every phase, missing labels,
the deadline's unknown status and the desk's missing estimate.

**Surfaces (Android).** `lib/live-activities/model.ts` `toLiveUpdateSpec`
maps the same props to one `modules/live-updates` spec that carries both
Android renderings (see Android Live Updates below for the hybrid): the
promoted Live Update's title/text/chip/track and the custom card's layout.
Each state has one hero, mirroring the iOS widgets; a label missing from an
older server's props is omitted, never replaced with English. A kind this
build does not know maps to `null` and is not posted. The props' `rank` (or
the data push's, when the props carry none) becomes the notification's sort
key, so the most important surface sorts first; `desiredActivities` keeps the
device within `maxConcurrent` on both platforms. Android documents the sort
key as ordering notifications of the same app and may ignore it when their
priorities differ (an alerting post uses the alert channel), so on Android
the order is a hint, not a guarantee.

**Ordering (iOS).** ActivityKit orders an app's activities (Dynamic Island,
Lock Screen) by each one's `relevanceScore`, and with equal scores by start
time. Every local start and update replaces the activity's whole content, so
`host.ios.ts` passes `relevanceForRank(rank)` (`100 − 10 × rank`, the same
value the API sends as APNs `relevance-score`) on each of them, through the
`patches/expo-widgets@57.0.23.patch` extra argument (expo-widgets 57 had no
relevance parameter, so every app-side update used to reset the score to 0
and the oldest activity led the island regardless of the Settings order). A
rank change alone changes the props signature, so it re-applies the score.

| State | Chip (≤ 7 chars) | Promoted: title / text · header | Card: lead · trail, track |
| --- | --- | --- | --- |
| Queue waiting | `#4·12m`; `#4` when the ETA is unknown or both overflow | **~12 min** · #4 (unknown: **Estimating…**) / +N more queues · challenge | Wait ~12 min (blue) · Position #4; stage track |
| Queue called | room (truncated) | Go to **Room B** / location · "Called" + count-up from `calledAt`; heads-up only on the transition | Go to Room B (green) · Called + count-up; location; stage track |
| Queue in room | room | In room · **Room B** / location · challenge | In room · Room B (grey); stage track at the end |
| Staff upcoming | countdown to `startsAt` | name / `hh:mm–hh:mm · location` · "Starts in" + countdown | Starts in + countdown (blue); time · location |
| Staff live (H24/H25) | `142/180`; `scanned` when that overflows or without `accredited` | **142**/180 scanned / name · location | Scanned `142/180` (blue); location; scanned-share track (elapsed time without `accredited`) + **Scan**; "Ends in" countdown |
| Attendee upcoming (H59) | countdown to `startsAt` in one unit (`2h`, `38m`) on the camera's leading side, category glyph opposite | "Starts in" + countdown (leading, as in Luma's pre-event activity) · category glyph / name / `hh:mm–hh:mm · location` | Starts in + countdown (blue, leading) · glyph; name; time · location |
| Attendee live | **Now** leading, glyph opposite | "Ends in" + countdown (leading) · **Now** · glyph / name / time · location; elapsed-time track | Ends in + countdown (leading) · Now · glyph; name; time · location; elapsed-time track |
| Deadline open (H19) | countdown to `endsAt` in one unit on the camera's leading side, status symbol opposite | "Closes in" + countdown (leading) · status · symbol / title / project; hacking-window track (none without `startsAt`) | Closes in + countdown (blue, leading) · status · symbol; title; project (amber "Not submitted", green "Submitted", none when unknown); window track |
| Deadline closing | countdown | the same in red (`exclamationmark` glyph); heads-up only on the transition into `closing` | the same in red |
| Deadline submitted | countdown (time left) | Submitted / project · "Closes in" + countdown; check, green; no track | Submitted (green) under the project · Closes in + a small countdown |
| Accreditation (H22) | accredited count | **412**/600 accredited / +23 last 10 min · 380 inside · title; accredited-share track; **Scan** | Accredited `412/600` (blue) · Last 10 min · Inside; share track + **Scan** |

**Tracks.** Like the iOS bars: each stage fills in its colour up to the
current value and the rest of it stays grey, stages separated by the segment
gaps, with a round tracker (white disc, glyph in the phase colour) at the
current value (`trackSegments`). The queue has two stages,
In line and Called, the first two thirds of the width as on iOS, filled in
the phase colour (blue waiting, green called, grey in the room); the tracker sits at `queueStageFill` of the current stage, the iOS
formulas: `(queueTotal − position + 1) / (queueTotal + 1)` of the first
stage while waiting, `2 / (calledAhead + 3)` of the second once called (at
the stage start without the counts), and at the end in the room, with the door as the end icon. Live staff activities track
the scanned share `scanned / accredited` (the elapsed time when an older
server sends no `accredited`); live attendee items the time elapsed between start and end,
the deadline the hacking window's elapsed time (in its phase colour), and the
desk the accredited share `accredited / eligible`, all as of the post.

**Orchestration (`lib/live-activities/`).**

- `store.ts` — the install id (`deviceId`, created once in SecureStore), the
  opt-out flag and the reconcile memory, shared with Android's headless task.
- `sync.ts` — `PUT /api/me/live-activities/device` after sign-in, on language
  change and when iOS rotates the push-to-start token (iOS 17.2+); on Android
  it sends the Expo push token instead (permission is still prompted by
  `lib/push.ts`). `reconcileLiveActivities` reads `GET /api/me/live-activities`
  (with `?deviceId=`, so the server applies this device's `maxConcurrent`
  cut and rank hysteresis) and applies it; every running iOS activity, including ones APNs started,
  is registered through `PUT …/sessions` right away and again with its per-activity token
  once iOS has one. The early registration keeps the worker from push-starting a duplicate
  of an activity the app just started. Local iOS starts and updates carry the server's
  `stale-date` (queue: 30 min ahead; others: the item's end), so an activity the app can no
  longer refresh shows as outdated. On launch and on every foreground (not on events or
  timers), the reconcile first calls `POST …/dismissals/reopen` and then applies the read
  without keeping, inferring or reporting dismissals: whatever the person swiped away comes
  back while it is still relevant. If the API call fails, dismissals are kept. A failed device
  registration (offline sign-in, opt-out) is retried before the next
  reconcile. A read that was in flight across sign-out/sign-in, or that a
  newer read overtook, is discarded instead of applied. A 404 (an API without
  the module) silences the orchestration until the next sign-in or language
  change.
- `model.ts` `desiredActivities` — reads every kind (the newer fields are
  optional for older servers), orders by `rank` (0 first, unranked last) and
  never keeps more than `maxConcurrent` even if the server sent more.
  `planReconcile` — one surface per (kind, subject): start missing
  ones (the queue only while `judgingWindowOpen`), update changed props
  (ignoring `updatedAt`), end duplicates and dropped subjects (iOS keeps the
  final state 30 seconds). A dismissed surface is not restarted until its
  phase changes (called, live), and `DELETE …/sessions` with the dismissed
  phase stops remote restarts. On iOS, a surface that vanished while the
  server still lists it counts as dismissed. On Android only the
  notification's delete intent counts (see Android Live Updates below): one
  that vanished for another reason (force-stop, reboot) is simply posted
  again. Unreported dismissals stay in `store.ts` (`unreportedDismissals`)
  until the API accepts the `DELETE`, so one recorded headlessly or offline
  is reported on a later foreground sync. Android also remembers the rendering the
  surfaces were posted with (`renderMode`: promoted or card); when it changes,
  for example after the person turns Live updates back on, every surface is
  posted again so it becomes a promoted Live Update without waiting for a
  state change. iOS cannot
  read a push-started activity's props, so an unidentified `StaffActivity` or
  `AttendeeActivity` is adopted by an unmatched subject of its kind and
  immediately updated (`host.ios.ts` remembers id → subject; the queue,
  deadline and desk have a single subject each).
- `use-live-activities.ts` (mounted in `app/_layout.tsx`) reconciles on sign-in and
  foreground (both bring dismissed activities back), the personal queue events, the next start/end boundary (staff
  and attendee activities, the deadline, the desk window) and every minute
  while a staff counter or the accreditation desk is live. A received or
  tapped queue or schedule push notification (`push-refresh.ts`,
  `isLiveActivityPushCategory`: `queue`, `schedule:<id>`) also triggers a
  reconcile, debounced together with the SSE events (a call sends both), so
  the activity catches up even when its APNs update is late or cannot be
  delivered yet (a push-started activity before the app reported its token).
  Sign-out ends every surface and sends
  `enabled: false` with the session that registered the device; `signOut()`
  revokes that session only after this cleanup settles (or after 4 s), since
  `notifySignOut()` returns a promise for asynchronous listeners. Sign-out
  and opt-out also remove iOS activities that already ended but still show
  their final state on the Lock Screen (`dismissEnded`), which
  `getInstances()` no longer lists, so a previous account's "Go to Room B"
  does not stay up for its 30-second dismissal window.
- `background-task.ts` — Android data pushes (`AndroidLiveUpdateMessage`) go
  through an `expo-task-manager` notification task defined in the entry file
  `index.ts` (before `expo-router/entry`), and through the foreground received
  listener; both render through the same `applyAndroidLiveUpdate`. On iOS the
  same task runs `reconcileLiveActivities` for a queue or schedule push
  received while the app is in the background: the API sends those
  `_contentAvailable` and the app declares the `remote-notification`
  background mode (`expo-notifications` plugin,
  `enableBackgroundRemoteNotifications`). iOS does not wake a force-quit app,
  throttles background wakes, and does not let a backgrounded app start a new
  activity (only update or end one); those cases wait for APNs or the next
  foreground reconcile.
- The activity scanner bumps the live counter right after a first-time scan.
- Web is a no-op (`host.ts`).

**Deep links.** `hackos://queue` resolves to the participant queue tab.
`hackos://scan?activity=<id>` (activity tap and Scan) is rewritten by
`app/+native-intent.tsx` to `/activities/<id>`, the activity scanner bound to
that activity, ready for an explicit NFC start or camera fallback (R008).
`hackos://schedule/<id>` (attendee activity) opens `app/schedule/[id].tsx`
and `hackos://scan` (accreditation tap and Scan) the scanner tab, both
unchanged. The app has no project screen, so `hackos://project` (deadline) is
mapped to `/queue`, the participant's My queue tab, which lists the team's
projects; the deadline goes to `queue:status` holders, who always have it.

**Opt-out.** Notifications settings has a Live Activities (iOS) / Live
updates (Android) switch: off ends every surface immediately and registers the
device with `enabled: false`.

**Per-kind choice and order.** The switch row's label side (detail
"n of m on", chevron) opens Notifications → Live Activities
(`app/(tabs)/others/notification-settings/live-activities.tsx`,
`components/live-activity-kinds-screen.tsx`): one row per kind the account
receives (`GET /api/me/live-activities/preferences`, in the person's order;
kinds the account is not entitled to are not listed), labelled with the
`liveActivityKind*` mobile copy keys, each with its switch and a drag handle.
Dragging a handle (gesture-handler `Pan` + Reanimated, fixed-height slots,
scroll disabled while dragging) sets the person's priority: the top kinds
take the device's few slots first when several apply. VoiceOver users get
Move up / Move down custom actions on the handle, whose value is the
position ("2 of 3"). "Reset to default order" appears only for a customized
order (`customOrder`) and sends `order: null`. Toggles and reorders are
optimistic (`lib/live-activities/use-live-activity-kinds.ts`), send only the
change (`PUT` with `kinds` or `order`), then run `reconcileLiveActivities()`
so this device follows at once; a failed save restores the previous state.
Both are per account, so the worker applies them on every device.
**Decision:** the device switch stays the only master; the detail screen is
reachable only while it is on, because nothing shows on this device then and
the rows would be inert.

**Development samples.** Debug builds only: opening
`hackos://dev/live-activity?sample=<queue-waiting|queue-estimating|queue-called|queue-in-room|staff-upcoming|staff-live|staff-live-other|attendee-upcoming|attendee-live|deadline-open|deadline-open-unknown|deadline-closing|deadline-submitted|accreditation|all|end>`
(for example `xcrun simctl openurl booted …`; any scheme works, and
`com.hackudc.os.debug://dev/…` avoids opening another installed hackOS build,
which would overwrite the App Group's shared Live Activity layouts) renders sample states without a
backend: waiting #4 of a start of 9 with a 12 min ETA, the same with an
unknown ETA, called 2 minutes ago, in room, an upcoming meal, a live meal
(142 of 180 accredited scanned), a live non-meal activity, an
upcoming and a running workshop, the deadline open with a draft or an
unknown status, closing and submitted, and the desk at 412 of 600. The
`-long` samples are the layout worst cases (long names and places, two-digit
hours, four-digit counts): `queue-waiting-long`, `queue-called-long`,
`staff-upcoming-long`, `staff-live-long`, `attendee-upcoming-long`,
`attendee-live-long`, `deadline-open-long`, `deadline-closing-long`,
`deadline-submitted-long` and `accreditation-long`. The handler is required behind `__DEV__` in `+native-intent.tsx`, so
release bundles drop it.

## Realtime & notifications infrastructure

- `lib/push.ts` — best-effort Expo push token registration, called once per
  signed-in user and token from `app/_layout.tsx`; profile revalidations do
  not repeat its POST, while token rotation still registers the new value.
  Device-token registration is delivery plumbing, not an identity read-model
  change, so the API deliberately does not publish an identity SSE refresh.
- `lib/notifications-setup.ts` — the actual delivery handling: configures
  Expo's foreground notification handler (shown even while the app has
  focus — the default suppresses it), sets up the Android notification
  channel, and wires `addNotificationReceivedListener`/
  `addNotificationResponseReceivedListener`. Both re-emit the notification's
  `category` on `lib/notification-events.ts` (a tiny in-process pub-sub) and
  pass the data to the Live Activity push refresh (#966); a
  tapped `category: "queue"` notification also navigates to the queue tab.
  Wired once for the app's lifetime from `app/_layout.tsx`.
- `lib/server-events.ts` — one authenticated transport per native instance,
  joining personal, queue-operation and logistics scopes. The shared bounded
  fetch core uses Better Auth's restored cookie, per-scope cursors and resyncs,
  pauses in background, and fences old readers across account/origin changes.
  Reference-counted consumers coalesce union changes; personal session changes
  remain targeted. There is no event replay or global Last-Event-ID. SSE-backed
  queue/wallet polls run only while disconnected. See
  [realtime transport](./realtime-transport.md) for authorization, bounds,
  revocation and installed-version compatibility. The cache-backed readers in `lib/use-cached-api.ts`
  revalidate quietly when the app returns after at least 60 seconds away; wallet
  and notification reads also poll every 30 seconds while active as a safety
  net when their event stream is unavailable. A successful response clears the
  stale-data state, while an outage keeps the last rendered data in place until
  the next retry.
- `lib/notification-events.ts` — `subscribeToCategory`/`emitCategory`, unit
  tested in `lib/notification-events.test.ts`. Lets a mounted screen react to
  a push the moment it arrives instead of waiting out its poll interval.
- `components/symbol.tsx` — drop-in `SymbolView` mapping SF Symbols to Material
  Symbols on Android. For `bell.badge` and `bell.badge.fill`, where Material Symbols
  has no badge-dot equivalent (only `notifications_active` depicting ringing waves),
  it maps to `notifications_none`/`notifications` with an overlaid accent badge dot.
  This gives Android a visible unread indicator on the Schedule header bell
  that matches iOS SF Symbol badge behavior without altering geometry. (issue #625)

### Android Live Updates (#966)

`modules/live-updates` (Kotlin, Android-only; `null` on iOS/web) posts the
Android counterpart of a Live Activity (H38 queue, H25/H26 staff activity,
H59 attendee activity, H19 deadline, H22 accreditation desk):
one ongoing notification per `spec.id`, tagged `hackos.live-update:<id>`.

**Hybrid, and why.** Android 16 only promotes a notification to a Live
Update (status-bar chip, lock screen, top of the shade) when it uses a
standard, BigText, Call, Progress or Metric style, is ongoing, has a title,
is not colorized and has **no custom RemoteViews**. An iOS-like layout needs
custom views, so the poster picks one of two renderings per post
(`LiveUpdatePoster.choosePath`, unit tested in `src/test`):

| Device | Rendering |
| --- | --- |
| Android 16+ (API 36), `canPostPromotedNotifications()` and `hasPromotableCharacteristics()` | **Promoted Live Update** (default): hero datum as title with the number in bold, round badge as large icon (white glyph on the phase colour), segmented `ProgressStyle` track, chip text, single Scan action |
| Android 16+ with promotion revoked (user/OEM) or a build the system would not promote; Android 8–15 (API 26–35) | **Custom card**: `DecoratedCustomViewStyle` with collapsed and expanded layouts (`res/layout/hackos_live_update_card_*.xml`): header, 34 sp metrics (one in the phase colour), meal stats row, the same track drawn as a bitmap with stage labels, a capsule Scan button inside the card, chronometers for countdowns/count-ups |
| < 8 (API 24–25) | `isSupported()` is false; `show` posts nothing |

**Lock screen (verified on the Android 16 emulator).** A promoted Live Update
always shows as a full card on the lock screen (title, text, track, action),
even after the person has seen it in the shade. A non-promoted notification
is shown with its collapsed layout (`hackos_live_update_card_small`: header,
hero value, trailing value; the chevron expands it). With Android 16's
compact lock-screen notifications (`lock_screen_notification_minimalism`, on
by default when unset), a non-promoted notification the person has already
seen (opened the shade, or its heads-up such as "called") moves into the
icon shelf under the clock. An app cannot override that user setting, which
is one more reason the promoted path is the default and the card only the
fallback.

**Actions.** Card path: Scan is only the filled accent pill inside the
expanded layout, trailing the bar on one row; no system action is added, so
no text-button row duplicates it (the collapsed card has no button). Promoted
path: SystemUI draws the single action as a text button under the content.
Promoted notifications cannot be colorized, and Android 16 strips
colour/background spans from action titles and does not draw action icons
(tested), so a filled pill beside the track is impossible there; the label
is bold, the only styling that survives. The same kind and phase therefore
always looks the same within a path; the two looks differ only between the
promoted and the card path.

The card is never chosen on a device that can promote; each post logs
`path`, `canPostPromoted`, `promotable` and the read-back
`FLAG_PROMOTED_ONGOING` under the `LiveUpdates` tag (the read-back can lag on
an id's first post).

- Built with `NotificationCompat` (androidx.core 1.17: `ProgressStyle`,
  `setShortCriticalText`, `setRequestPromotedOngoing`). `MetricStyle` is
  Android 17-era and absent from compileSdk 36, so it is not used.
- Colours: blue (waiting, upcoming, live, deadline open), green (called,
  submitted), grey (in room), red (deadline closing), amber (a draft's "Not
  submitted" on the card), a lighter grey for the unfilled rest of a track. Text colours are resources with
  `values-night` variants, resolved by SystemUI (`RemoteViews.setColor` on
  API 31+), so the card follows the shade's light/dark mode; bitmaps (badge,
  tracker, card track) use the mode at post time.
- Small icon: the kind's monochrome glyph (`people`, `door`, `meal`, `mic`,
  `star`, `calendar`, `flag`, `sparkles` for schedule categories, `hourglass`
  / `alert` / `check` for the deadline, `badge` for the desk; `scan` for the
  action). Android 16 shows the app icon in the
  notification header regardless; the glyph appears in the chip and the
  status bar.
- Chip and `when`: the chip shows `shortCriticalText` whenever it is set,
  even with a running chronometer, so the called state counts up in the
  header while the chip keeps the room. `countdownTo` (future) is shown as
  the system's own short time delta (`5min`; `LiveUpdatePoster.whenStyle`),
  not a chronometer, so the chip never shows `H:MM:SS`; the system shows it
  from 2 minutes ahead. `countUpFrom` counts up as a chronometer, anything
  else hides `when` (live staff updates), so a count is never displaced.
  The custom card (the pre-Android 16 fallback) keeps its chronometers. Tapping the chip opens the notification as a
  popup and the popup opens the deep link (`hackos://queue`, the scan link).
  The chip is hidden while hackOS is in the foreground, and it shows the
  icon alone while its own heads-up or popup is on screen and for a moment
  after the app leaves the foreground (system behaviour, verified on the
  Android 16 emulator).
- Channels: `hackos_live_updates` (default importance, no sound/vibration)
  for routine updates; `hackos_live_updates_alert` (high importance) only
  when `spec.alert` is true: the team being called, or the deadline entering
  `closing`. Names are
  localized es/gl/en in the module's string resources. On the custom path,
  Android may move an already-seen alert into the lock screen's icon shelf.
- Taps, the Scan action and the card's Scan button fire `ACTION_VIEW` deep
  links pinned to this package (`FLAG_IMMUTABLE`). Notification ids are the
  subjects (`activity:12`, `schedule:21`, `deadline`, `accreditation`) and
  `queue:judging`.
- Without notification permission (`expo-notifications` asks for it), `show`
  is a no-op.
- Dismissals: every post carries a delete intent to the module's
  non-exported `LiveUpdateDismissReceiver` with the spec's `phase`. The system
  sends it only when the person swipes the notification away (Android 14+
  allows that for ongoing ones), never for app cancels, force-stop or
  reboot. The receiver stores `id → phase` in SharedPreferences
  (`hackos.live-updates`), so a dismissal while no JS runs is kept;
  `consumeDismissals()` returns and clears them, and `host.android.ts`
  exposes them to the orchestration as `consumeDismissals()`.
- Testing the card on Android 16: `adb shell appops set com.hackudc.os.debug POST_PROMOTED_NOTIFICATIONS deny`
  (restore with `default`), or the per-app Live updates toggle in Settings.
- Debug builds only: `LiveUpdatesDebugReceiver` (module `src/debug`) posts
  samples without JS, e.g.
  `adb shell am broadcast -f 32 -p com.hackudc.os.debug -a expo.modules.liveupdates.DEBUG_SHOW --es id queue:judging --es title Queue --es chip '#4' --es icon people`
  (extras: `text`, `subText`, `countdownSeconds`/`countUpSeconds` int,
  `progress`/`progressMax` int for a one-stage track, `tracker`, `tone`,
  `actionLabel`, `actionUrl`, `url`, `phase`, `alert` bool; `DEBUG_DISMISS`
  with `id`). The full states, including the card, come from the JS samples
  (`hackos://dev/live-activity?sample=…`, above), which run the real mapping;
  on Android, open them with `adb shell am start -a android.intent.action.VIEW -d '<link>' com.hackudc.os.debug`
  while the app runs. Samples respect the in-app opt-out.

## Other infrastructure

- `lib/client-build.ts` sends the native build number as `X-HackOS-Build` on API
  and realtime requests. When the API answers `426 upgrade_required`
  (`lib/upgrade-required.ts`), the root layout replaces the app with
  `UpgradeRequiredScreen`, which opens the store (#999). See
  [mobile-release](./mobile-release.md#minimum-supported-build).
- `lib/app-version.ts` shows the installed binary's version and a seven-character
  commit in Sign in and Account. `app.config.ts` captures EAS/CI commit metadata,
  falling back to the checkout's HEAD when building locally; builds without Git
  metadata retain the version alone.

- `lib/i18n.tsx` — react-i18next wrapper (`useLocale()` keeps the original
  `{ language, setLanguage, t }` shape) reading `packages/shared/locales/
  {en,es,gl}/{mobile,common}.json` — mobile-specific strings plus the subset
  shared verbatim with `apps/web/src/lib/i18n.ts`, synced to `me.language`
  from `/api/me`. `mobile.json` is intentionally smaller than the web app's
  `web.json`: it covers scanner and participant controls, not the full web
  admin surface.
- Account language row (`components/account-screen.tsx`) — on iOS the whole row
  is the `MenuView` trigger (`components/app-menu.tsx`). On Android that wrapper draws
  the iOS-style `MenuPopover`; the row stays a `Pressable` calling `ref.show()`, with
  the menu anchored to a 1dp strip at the row's trailing edge.
- Dynamic Type. `patches/react-native@0.86.3.patch` makes every root `Text`
  remount once when the system text size changes. Without it, Fabric
  re-measured text only on its native branch: the next React commit (a tab
  switch, returning from Settings) restored frames measured at the old size
  while glyphs rendered at the new one, clipping every label. Fixed chrome
  (tab labels, scanner counters, the Activities/Diary toolbar titles) uses
  `CHROME_MAX_FONT_SIZE_MULTIPLIER` from `theme/dynamic-type.ts` and shrinks to
  fit; all other text is uncapped. `test/dynamic-type.test.tsx` fails if the
  patch is lost in a React Native upgrade. To check a screen, change the size
  while the app runs (`xcrun simctl ui booted content_size
  accessibility-extra-extra-extra-large`), then switch tabs: a cold start at
  the large size does not exercise the re-measure path.
- **44 pt hit area (#1168).** A control whose visible shape is smaller than 44 pt
  (inline search/clear glyphs, 28–40 pt text fields and rows, compact retry
  buttons) keeps its look and reaches 44×44 through `hitSlop` — extended away
  from neighbouring controls, never into them — or `minHeight`/`minWidth` when
  the layout has room. Decorative badges and the sheet grabber are exempt.
- `lib/haptics.ts` — best-effort Expo Haptics feedback for custom controls and
  meaningful outcomes. Selection/light feedback is used for custom toggles,
  segmented choices, scanner capture and retry actions; success/warning/error
  feedback is reserved for confirmed mutations and scanner outcomes (H22-H26,
  H51). Native `Switch`, segmented `Picker`, Wallet controls and system menus
  keep their platform-provided feedback, and passive navigation/QR frame
  detection stays silent.
  The OS decides whether a haptic plays: iOS drops it when System Haptics is
  off and Android when touch feedback is off, so no screen reads or overrides
  the setting (#1170).
  **Scanner and queue mapping** (`lib/scan-haptics.ts`, routed through
  `haptic()`; mapped by `lib/scan-haptics.test.ts`):

  | Outcome | Haptic | Where |
  |---|---|---|
  | Code recognised and accepted | success | general scanner, activity scanner (server-confirmed), person screen (acknowledged) |
  | Stored offline, not yet confirmed | light | activity scanner, person screen |
  | Already registered (repeat needs a decision) | warning | activity scanner |
  | Server rejected the scan | error | activity scanner, person screen |
  | Unknown or revoked code | error | general and activity scanner |
  | Queue entry confirmed / rejected by a sync | success / error | `useQueueTransitionHaptics` on the sync queue screen; one haptic per refresh, error wins over success, first snapshot and newly queued entries are silent |
  | Queue retry / discard | light / warning | the button itself |
  | Queue "notify team" fails | error | queue operations screen |
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
mocks `react-native-reanimated`, `react-native-worklets`, `@shopify/react-native-skia`
(a plain-view `Canvas`, drawing primitives render nothing) and
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
`hasEventAccess` traps that eat time on the first attempt.

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

Activity and meal scanners also resolve entry-ticket QR tokens, including for
participants without a badge. Offline activity payloads preserve the original
credential and the API revalidates tickets on replay, with the same repeat
confirmation and idempotency as badge scans. Scanner lookup errors appear
centered below the statistics on both screens and dismiss after six seconds.

All operational scans (activities/meals, presence and badge operations) refresh
the shared pending queue immediately after durable local
storage. Reader and manual input availability do not wait for replay, snapshot or
statistics requests. Sync verdicts update only the matching result, and local
activity counts remain part of repeat detection when a server snapshot is stale.
Scanner replay, snapshot and badge-assignment requests time out after five seconds;
network timeouts retain the original idempotency key and queue the mutation.
Badge assignment remains authoritative only after server acknowledgement. Contact
scans and their separate replay queue use the same request deadline and retain
their existing offline fallback.

## Switches

Every on/off control uses `AppSwitch` (`components/native-ui.tsx`, also behind
`ToggleRow`) rather than react-native's `Switch`. iOS keeps the native control;
Android draws UIKit's switch (`components/ios-switch.tsx`): 51 x 31 capsule, white
thumb, `success` (green) on track, `separator` off track, in both themes.

### Contacts toolbar grouping

Contacts orders the actions Ticket, Favourites, Search from left to right,
groups Favourites and Search together, and keeps the wallet/ticket button
on a separate native background (`separateBackground`). Search still opens the
native iOS search controller, kept mounted in stacked placement and focused on
demand from the grouped search action. All toolbar actions stay mounted while
searching; blur or cancel ends search without rebuilding the toolbar. Legacy headers use the same
grouping with their existing search field. People/Companies switching, saved
contacts, favourites and wallet actions retain their existing behavior.

## Shared client models (#1001)

Schedule and announcement forms use the framework-free models in
`packages/shared`; schedule and scanner localized text use the same resolver.
Presence math, role/category labels, timezone-store behavior and account-removal
progress parsing are shared too. Native rendering, ISO date inputs and
SecureStore access stay in this app. See
[shared client models](./notifications.md#shared-client-models-1001) for the
trimming/null decisions and the unchanged announcement fallback policy.

### Question-owned library fields

Dynamic forms render `library` fields with a searchable native checklist and an
inline proposal action. Selections and new proposals have no count limit. The
catalogue belongs to its question; curation remains in the web form editor.
Read-only projects display the saved names, including historical answers after
catalogue deletion. See [question-owned libraries](./form-libraries.md).


### Responsive Account and Wallet (H28, H55)

Account uses the Contacts native toolbar pattern beside a rail or on iPad: leading title, trailing Wallet action, matching canvas and no root back action. Its form remains a centred 720 pt reading column. Wallet uses two stable panes when its measured viewport reaches 720 pt: compact Ticket/Badge selector and QR on the left, holder and pass actions on the right; narrower windows stack those groups. Resizing preserves the selected credential. The personal queue keeps its back action without a redundant My queue title.

Android navigation responds to the current window. Compact passport proportions use a rail; tall covers keep the phone bottom bar. Opened windows at least 640 × 600 dp use list/detail panes, including portrait folds; narrower or short landscape windows keep one pane. This is window geometry, not physical hinge occlusion detection. The overflow hub uses the same visible-tab budget as the bar, lists only hidden destinations, and redirects to Account when none remain.

The native Account and Contacts bars stay transparent in either orientation, preserving the system scroll-edge treatment instead of clipping the profile with an opaque band. iPad profile avatars use 144 pt; phone and Duo sizes remain unchanged. Contacts keeps Wallet in-page, changing the same native toolbar item to Close. My Projects opens My queue in-page with its opener becoming Close; both overlays enter and exit on the right and respect Reduce Motion. Back gestures and Android Back close an open overlay before leaving its owner.

The root iOS back recognizer covers side navigation and the bottom dock outside child stacks; native stacks retain their content gesture. A dock back gesture takes priority over tab scrubbing only while back/dismiss is possible. It rejects vertical drags and short horizontal movements. Contacts uses the measured native-header height with manual scroll padding to avoid restoring an obsolete automatic top inset. Projects uses a leading toolbar title immediately, without waiting for a large-title scroll event.

Project detail validates required project collections before mounting the editor (H20). A malformed response uses the existing retryable RequestFeedback state. Gallery removes the unused detail column when there are no results, centres its empty detail placeholder, and avoids inheriting the large-title offset for its embedded project header. The New project sheet uses matching header/body backgrounds with native X/check toolbar actions.
