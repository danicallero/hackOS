# Mobile app (`apps/mobile`)

Native Expo Router app for issue #73: Better Auth session continuity,
capability-driven tabs, participant-facing screens, authenticated realtime,
and offline SQLite scanners for accreditation, badge rotation, presence,
meals, and registrable activities.

For development builds, prebuild/CNG, EAS profiles, signing, certificates,
store assets, submission, and the release checklist, see
[`mobile-release.md`](./mobile-release.md).

## Story coverage registry (issue #73: H4, H22–H26, H28–H31, H38, H51, H55)

| Story | Scope | Status | Notes |
| --- | --- | --- | --- |
| H4 | Login/logout, session persists via Better Auth Expo + `expo-secure-store` | ✅ Done | `lib/auth-client.ts`, `app/(auth)/sign-in.tsx`. Server-side logout (session revocation) reuses the existing Better Auth endpoint — no mobile-specific work needed. |
| H55 | One app, capability-driven tabs, permission changes apply without reinstall | ✅ Done | `lib/tabs.ts` + `app/(tabs)/_layout.tsx`. Five-item native bar (`UITabBarController` collapses a sixth item into iOS's own "More" screen). Participants: schedule/queue/wallet/notifications + Account. Operators: schedule/**Scanner**/Activities (`activity:scan` only)/notifications + the "Others" dropdown selector, behind which Queue, Wallet, and Account live as pseudo-tabs — see `docs/navigation.md`. |
| H38 | Participant sees queue status/position/ETA, pre-alert, call notice | 🟡 Device QA | Push receipt/tap and the authenticated `GET /api/queue/me/stream` native fetch stream both refetch queue state immediately; 15s focused polling is the recovery path. Code/tests are complete, but APNs/FCM delivery still needs real-device verification. |
| H29–H31 | Queue operations: room overview, called teams, queue head and re-notification | ✅ Done | `components/queue-operations-screen.tsx` reads capability-protected room views, refreshes while focused, and posts the existing idempotent `notify-enter` transition. |
| H51 | Notification channel preferences per category; queue calls non-optional | ✅ Done | Static category preferences and mandatory queue notices are available on mobile. `schedule:<id>` per-activity reminder opt-in is available via the calendar bell (`lib/use-activity-reminders.ts`) and the preferences tab. The tab also exposes the shared `schedule` reminder channels and `schedule:type:<kind>` kind opt-ins. Reminder removals use a visible serial queue, so several can be tapped without racing full preference responses. |
| H28 | Ticket/badge in Apple & Google Wallet; old pass auto-invalidates on badge rotation | 🟡 Device QA | QR wallet, authenticated Apple `.pkpass` download/share, Google save URL, server-side pass invalidation/push, and foreground wallet refetch on `LOGISTICS_WALLET_PASS_UPDATED` are wired. Real Wallet apps/credentials still need device QA. |
| H22 | Accreditation scanner: local SQLite lookup, badge assignment, server-confirmed | 🟡 Device QA | Ticket/person cards live in SQLite. The assignment is persisted/retried but is explicitly shown as **not accredited** until the API acknowledges the idempotent request. |
| H23 | Badge replacement, offline-first, revocation synced later | 🟡 Device QA | Rotation updates the originating scanner immediately; each successful full snapshot replaces the complete revoked-badge set so every scanner rejects old badges. |
| H24 | Presence (door in/out) scanner, offline queue, manual back-dated entries | 🟡 Device QA | In/out and optional ISO backdated timestamps use the durable shared queue and idempotent replay; server rejections (e.g. entry on an open session) are surfaced to the operator instead of failing silently, and auth/throttling errors keep scans queued rather than dropping them. The per-person presence view is a single unified timeline (each entry/activity point carries its certainty-window meter inline) with a guaranteed vs provisional hours summary, and surfaces the API's `conflicts[]` (illegal in→in pairs, only reachable via manual edits) as a red banner whose "Resolve timeline gap" sheet clamps the date picker strictly between the two conflicting entries; system-recorded logs (event-end automatic exit) show as "Recorded automatically". |
| H25 | Meals scanner, offline queue, repeat-serving confirmation | 🟡 Device QA | Everyone may eat; local count data drives first-serving/repeat confirmation. Every accepted scan stays queued until API acknowledgement. |
| H26 | Registrable-activity scanner, same offline contract as H25 | 🟡 Device QA | Scannable activities are synchronized locally and use the same durable idempotent replay contract. |

Legend: ✅ done · 🟡 partial (core flow works, a sub-requirement is missing) · ❌ not started.

**Schema.** One new column-free addition: `push_tokens` (already existed,
`apps/api/db/migrations/0001_initial.sql`) is now actually written to, via the
route below. No migration needed.

**Endpoints / hooks.**
- `POST /api/me/push-tokens` (`apps/api/src/modules/notifications/routes/push-tokens.ts`)
  — new route. Upserts the caller's Expo push token; re-registering the same
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
- Every other endpoint the app calls already existed and is unchanged:
  `GET /api/me` (capabilities + language + badgeId), `GET /api/public/activities`
  (schedule), `GET /api/queue/me` (H38 status), `GET /api/me/ticket` +
  `GET /api/me/wallet/apple/:purpose.pkpass` + `GET /api/me/wallet/google/:purpose`
  (H28), `GET`/`PUT /api/me/notification-preferences` (H51).
- `GET /api/scanner/snapshot` — capability-guarded, replace-all seed for the
  device SQLite store. It contains only the lightweight person cards, ticket
  and current/revoked badge mappings, scannable activities, meal/activity
  scan counts, and last door state needed by H22-H26. A full snapshot
  is deliberate: badge-history values have no individual timestamp, and a
  complete replacement guarantees convergence after any missed refresh.
  Anonymized accounts (H54, `users.anonymized_at`) are excluded, so an
  erased profile never syncs to a scanner and never resolves through
  `/api/logistics/people/search` — even by a still-active badge or ticket.
- `GET /api/logistics/scan-log` (`apps/api/src/modules/logistics/scan-log.ts`)
  — paginated, most-recent-first feed unioning accreditation check-ins,
  presence door-scans, and activity/meal scans by the *actor* who performed
  them (extends H22-H27; not a new story). Defaults to the caller's own
  scans; a scan-capable operator without `LOGISTICS_STATS` may only request
  their own `staffId`. Backs the mobile "scan history" screen
  (`app/(tabs)/scan/scan-log.tsx`), reachable from Account and from the
  device-queue popup.
- `GET /api/me/logistics/stats` — the caller's own accreditation/presence/
  activity scan counts, shown on Account for operators. `GET
  /api/logistics/stats/by-staff` is the `LOGISTICS_STATS`-gated cross-staff
  ranking (web `/logistics/stats`, "Staff ranking" section), and `GET
  /api/exports/staff-scan-stats.csv` (`exports:run`) exports the same data.
- `idempotencyGuard` (`apps/api/src/lib/idempotency.ts`) now reclaims a
  first-execution record whose `response_status` has been NULL for more
  than 30s, instead of 409ing "still in flight" forever. Mobile scanners
  reuse the persisted local scan id as the `Idempotency-Key` on every retry
  (`lib/scanner-model.ts`), so an interrupted first attempt (dropped
  connection, backgrounded app, server restart) used to permanently jam
  that scan — and everything queued behind it, since
  `replayPendingScans()` replays in order and stops at the first
  unresolved error — with no way to recover short of a fresh scan.

**UI (`apps/mobile`).**
- `lib/auth-client.ts` — Better Auth client using `expo-secure-store` for
  session storage instead of a cookie jar (H4's explicit requirement).
- `lib/api.ts` — thin wrapper around the auth client's underlying fetch so
  every API call (not just `/api/auth/*`) carries the restored session.
- `lib/tabs.ts` (`primaryTabs`/`overflowTabs`) — pure functions mapping
  `me.capabilities` to the tab bar; see `docs/navigation.md` for the full
  model. The native bar holds at most five items (iOS collapses a sixth into
  its own "More" screen). With no scan capability, the bar is the four
  participant tabs plus Account, and there is no overflow at all. For
  `ACCREDIT_SCAN`/`PRESENCE_SCAN`/`ACTIVITY_SCAN` (or the admin `*`
  wildcard) holders, the daily tools take the bar — schedule, Scanner,
  Activities (for `ACTIVITY_SCAN`), notifications — and the fifth slot is
  the "Others" selector: a `role="search"` tab trigger (the separated
  capsule on iOS 18+) overlaid with a native `MenuView` dropdown listing
  Queue, Wallet, and Account as pseudo-tabs. Queue-only operators instead get
  Queue operations in the primary bar; scanner operators with queue access find it
  in this selector, preserving Scanner's direct placement.
- `app/(tabs)/_layout.tsx` — reads capabilities from a shared `/api/me` fetch
  (`lib/me-context.tsx`, `lib/use-me.ts`) and hides tabs via Expo Router's
  `href: null` mechanism rather than omitting the route, so the underlying
  screen stays reachable. The fetch refetches on app foreground, so a
  capability change made elsewhere (web admin) shows up without a reinstall
  (H55's explicit acceptance bar).

  The entries inside the native "Others" dropdown (Queue, Wallet, Account, and
  Queue operations when a scanner operator has queue access —
  routes under `app/(tabs)/others/`) are intentionally pseudo-tabs
  (`lib/operations-navigation.ts`):

  - Selecting the pseudo-tab whose section is already on screen is a no-op.
  - Changing pseudo-tabs always uses `replace()`, never `push()`, so repeated
    selections do not stack duplicate queue/wallet/account screens.
  - Deeper screens inside a section (e.g. the person drill-downs) still push
    normally on top of that section's root.
  - Route matching must normalize Expo Router route groups first, because
    `usePathname()` may return `/others/...` while tests and typed hrefs still
    use `/(tabs)/others/...`.

  Do not re-implement these as plain `push()` calls or stack-style route
  launches. That regresses the back stack and duplicates overflow pages —
  earlier versions broke exactly this way.
- `app/(auth)/sign-in.tsx` — email/password only; no in-app registration. The
  anonymous event feed supplies the configured name and tagline, and the screen
  explains that only accepted participants can sign in and directs them to the
  configured `EXPO_PUBLIC_EVENT_WEBSITE_URL` to review their application. The
  fields use the native username/current-password pairing; iOS additionally
  associates that domain through `webcredentials`.
  (accounts come from the web onboarding/invite flows, H10/H12).
- `app/(tabs)/schedule.tsx`, `queue.tsx`, `wallet.tsx`, `notifications.tsx`,
  `account.tsx` — the five participant screens. API-backed screens expose
  loading, retryable error, and empty states without leaking rejected promises.
  The account screen displays the shared `/api/me` profile, refreshes it, and
  provides a confirmed sign-out action for the device session. For operators
  (any scan capability, `lib/tabs.ts`'s `isOperator`) it also shows a "My
  stats" section (`/api/me/logistics/stats`) and a link to the scan-history
  screen (`app/(tabs)/scan/scan-log.tsx`, `/api/logistics/scan-log`, grouped by
  day into `Section`s with a native list look). `wallet.tsx`
  renders ticket/badge QR codes. The Apple Wallet action is the system
  `PKAddPassButton` control (`@premieroctet/react-native-wallet`'s
  `RNWalletView`, iOS only) — per Apple's Add to Apple Wallet guidelines, the
  button must be the system control, not custom artwork — wired to
  `react-native-wallet-manager`'s `addPassFromUrl` (authenticated fetch of the
  `.pkpass` endpoint with the session cookie, then native
  `PKAddPassesViewController` presentation). Google Wallet still goes through
  the existing `saveUrl` endpoint via `Linking.openURL`.
  `queue.tsx` refetches immediately on a "queue" push
  (below) and also polls `GET /api/queue/me` every 15s while focused as a
  fallback. `notifications.tsx` pages past the initial 20 inbox messages on
  demand, allows an expanded message to be deleted after native confirmation,
  and mirrors the web activity/kind reminder preferences.
- `components/queue-operations-screen.tsx` — Queue operations is available to
  `queue:operate`, `queue:admin`, and `*`. It first lists only the caller's
  authorized rooms, then loads each protected room view. Each card keeps the
  presenting team, teams called to the door, and the first waiting team easy
  to scan. `operations/_layout.tsx` and `others/operations/_layout.tsx` wrap
  it in its own `Stack` so it can use the same native
  `headerLargeTitle`/`headerSearchBarOptions` search bar as
  `people-directory-screen.tsx`; typing a query swaps the room grid for a
  flat, sorted list of every matching queue entry (by team name or member
  name/email) across every challenge that team is in, each rendered as the
  participant's own My Queue card. Tapping a result — or any team already
  shown on a room card — pushes `components/team-operations-screen.tsx`
  (`/(tabs)/others/team/[entryId]`), a detail view built on the same layout as
  the participant's own queue card but with the extra context only an
  operator needs: full member emails, repo/Devpost/demo links, and the
  entry's `queue_history` timeline. Re-notification uses the existing
  idempotent `notify-enter` transition with a React Native-safe generated
  key. On top of the existing 10s poll, the screen opens
  `lib/server-events.ts`'s `startQueueEventStream()` (the public
  `GET /api/queue/stream` topic) while focused, so `QUEUE_TEAM_CALLED` /
  `QUEUE_ENTRY_CHANGED` / `QUEUE_ROOM_CHANGED` refresh the board immediately
  and mark the newly-called room/entry with an accent border and a "Just
  called" badge for ~12s. `notifyTeamCalled` (apps/api) also pushes the
  existing opt-in `queue.staff` push category (same mechanism as
  `notify-enter`'s staff alert) so an operator with a backgrounded app still
  gets a device notification. The layout is one column on phones, two from
  680 px, and three from 1100 px.
- `app/(tabs)/scan/index.tsx` — thin wrapper around the shared
  `GeneralScannerScreen` (camera/manual scanners selected by capability:
  accreditation, badge replacement, door presence, meals, and activities),
  a dedicated primary tab for operators (see `docs/navigation.md`). Its
  person/people drill-down routes live under `app/(tabs)/scan/*`.
  `lib/scanner-db.ts` (native: `scanner-db.native.ts`) owns two WAL-mode
  SQLite files — see "Scanner cache encryption & isolation" below — and
  `lib/scanner-sync.ts` replays in creation order with the persisted scan id
  as `Idempotency-Key`, then installs the latest server snapshot/revocation
  set.
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

**Scanner cache encryption & isolation.** Staff/scanner devices carry two
distinct local caches, split into separate SQLite files with different
lifetimes, encryption keys, and OS backup treatment (`lib/scanner-crypto.ts`,
`lib/scanner-db.native.ts`):

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
  `components/account-screen.tsx`'s sign-out handler, and a fresh
  `GET /api/scanner/snapshot` fully reconstructs it on next sign-in. Since
  encrypting `name`/`surname`/`email` rules out pushing search into SQL,
  `listScannerPeople` decrypts the (event-sized) roster once per call and
  filters/sorts in JS instead.
- **Offline scan queue** (`hackos-scanner-queue.db`, `pending_scans`) — the
  only record of a not-yet-synced transaction, so it stays in the default
  (non-cache, backed-up) document directory and is **never** wiped on
  sign-out. Every row is encrypted with its own `created_by_user_id`'s key
  (a distinct `expo-crypto` key per staff member, also in `expo-secure-store`,
  marked `WHEN_UNLOCKED_THIS_DEVICE_ONLY` on iOS so a restored backup can't
  carry a usable key to a different device). `pendingScans`,
  `replayPendingScans`, and `retryFailedScans` are always scoped to the
  currently signed-in user's own rows: a different staff member signing in
  on the same device cannot list, decrypt, or replay a predecessor's still-
  queued scans (replaying under the wrong session would also misattribute
  the action server-side). The same user signing back in later recovers
  their own queue, conflicts included, exactly as they left it — the queue
  is keyed by owner, not by session. Devices upgrading from the pre-split
  single-file schema have their legacy `pending_scans` rows migrated once
  (attributed to a sentinel "unknown owner", `userId 0`) rather than
  silently dropped; the old file is then deleted.

Both caches' actual on-device behavior (SecureStore-backed native AES,
cache-directory backup exclusion, the legacy-file migration) needs a real
device/EAS build to verify — see "What's left" below.

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
- `lib/i18n.tsx` — minimal `{ en, es, gl }`-per-key dictionary (same shape as
  `apps/web/src/lib/i18n.ts`, but only the strings these screens need), synced
  to `me.language` from `/api/me`.
- `expo-network` is installed as a required peer of `@better-auth/expo`; it
  lets the auth client refresh session state when the device regains network
  connectivity. As with every native dependency change, an existing dev client
  must be rebuilt rather than only reloading its JavaScript bundle.

**Scanner state transitions.** A scan is inserted in SQLite before any network
request: `pending -> acknowledged` only after a 2xx response (including an
idempotency replay), or `pending -> failed` for an explicit 4xx business
rejection. Network failures leave it `pending` and stop ordered replay until a
later foreground/15s/manual sync. Failed items stay visible and can be reset to
`pending`. Accreditation never applies its badge mapping locally before the
acknowledgement. Badge rotation, presence, meals, and activities apply local
operational feedback immediately, then the post-replay full snapshot converges
them to server truth.

## What's left

- **Real-device acceptance pass.** Exercise airplane-mode queue persistence
  across a process restart, reconnect/replay, concurrent scanners, QR camera
  permissions, revoked-badge propagation, APNs/FCM foreground/background/tap
  behavior, the Android channel, authenticated SSE reconnect, Apple Wallet,
  and Google Wallet. These cannot be truthfully marked verified by a Node/web
  export alone.
- Full i18n parity with the much larger web dictionary. All new scanner and
  participant controls have en/es/gl copy, but the mobile dictionary remains
  intentionally smaller than the web app's.
- **Scanner cache encryption device QA.** Confirm on real iOS/Android
  hardware: `expo-crypto`'s native AES-GCM round-trips correctly, the roster
  database placed under `Paths.cache` is actually excluded from an
  iCloud/Google Drive device backup, `expo-secure-store`'s
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY` keys survive app restarts but not a
  restore-to-new-device, and the one-time legacy `hackos-scanner.db`
  migration correctly carries forward any pre-upgrade queued scans.
