# Mobile app (`apps/mobile`)

Phase 1 of the native app (H4, H51, H55, part of H28/H38): an Expo Router app
with Better Auth session continuity, capability-driven tabs, and the
participant-facing screens the issue called out. Offline SQLite scanning
(H22–H26) is a later phase — see "What's deferred" below.

## Story coverage registry (issue #73: H4, H22–H26, H28, H38, H51, H55)

| Story | Scope | Status | Notes |
| --- | --- | --- | --- |
| H4 | Login/logout, session persists via Better Auth Expo + `expo-secure-store` | ✅ Done | `lib/auth-client.ts`, `app/(auth)/sign-in.tsx`. Server-side logout (session revocation) reuses the existing Better Auth endpoint — no mobile-specific work needed. |
| H55 | One app, capability-driven tabs, permission changes apply without reinstall | ✅ Done | `lib/tabs.ts` + `app/(tabs)/_layout.tsx`. Only participant tabs + one staff placeholder tab exist; more staff tabs arrive as scanners are built. |
| H38 | Participant sees queue status/position/ETA, pre-alert, call notice | 🟡 Partial | `app/(tabs)/queue.tsx` shows status/position/ETA and the call banner. Delivery is push-first now (see below): a `queue.called`/`queue.precall` push refetches the screen immediately via `lib/notification-events.ts`, with a 15s poll as a fallback while focused. Still missing: the SSE stream the web app uses (`GET /api/queue/me/stream`) for a push-independent live path, and end-to-end verification on a real device (only unit-tested server-side so far). |
| H51 | Notification channel preferences per category; queue calls non-optional | 🟡 Partial | `app/(tabs)/notifications.tsx` toggles `announcements`/`application` categories. Push token registration (`lib/push.ts`) and actual delivery handling (`lib/notifications-setup.ts` — foreground display, tap routing, category-based refetch) are done. Per-activity reminder opt-ins (`schedule:<id>` categories, which the web inbox page supports) are not built. |
| H28 | Ticket/badge in Apple & Google Wallet; old pass auto-invalidates on badge rotation | 🟡 Partial | `app/(tabs)/wallet.tsx` renders QR codes and the two "Add to Wallet" entry points (existing server endpoints, no new backend work). Automatic pass **push updates** when a badge is rotated (`wallet-sync.ts` already emits them server-side) aren't consumed by the app — the wallet screen only reflects a rotation on next manual refresh. |
| H22 | Accreditation scanner: local SQLite lookup, badge assignment, server-confirmed | ❌ Not started | `app/(tabs)/scan.tsx` is a placeholder screen shown to capability holders. |
| H23 | Badge replacement, offline-first, revocation synced later | ❌ Not started | Same placeholder. |
| H24 | Presence (door in/out) scanner, offline queue, manual back-dated entries | ❌ Not started | Same placeholder. |
| H25 | Meals scanner, offline queue, repeat-serving confirmation | ❌ Not started | Same placeholder. |
| H26 | Registrable-activity scanner, same offline contract as H25 | ❌ Not started | Same placeholder. |

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

**UI (`apps/mobile`).**
- `lib/auth-client.ts` — Better Auth client using `expo-secure-store` for
  session storage instead of a cookie jar (H4's explicit requirement).
- `lib/api.ts` — thin wrapper around the auth client's underlying fetch so
  every API call (not just `/api/auth/*`) carries the restored session.
- `lib/tabs.ts` (`visibleTabs`) — pure function mapping `me.capabilities` to
  the visible tab set; unit-tested in `lib/tabs.test.ts`. Participant tabs
  (schedule, queue, wallet, notifications) are unconditional; `scan` appears
  only for `ACCREDIT_SCAN`/`PRESENCE_SCAN`/`ACTIVITY_SCAN` (or the admin `*`
  wildcard).
- `app/(tabs)/_layout.tsx` — reads capabilities from a shared `/api/me` fetch
  (`lib/me-context.tsx`, `lib/use-me.ts`) and hides tabs via Expo Router's
  `href: null` mechanism rather than omitting the route, so the underlying
  screen stays reachable. The fetch refetches on app foreground, so a
  capability change made elsewhere (web admin) shows up without a reinstall
  (H55's explicit acceptance bar).
- `app/(auth)/sign-in.tsx` — email/password only; no in-app registration
  (accounts come from the web onboarding/invite flows, H10/H12).
- `app/(tabs)/schedule.tsx`, `queue.tsx`, `wallet.tsx`, `notifications.tsx` —
  the four participant screens. `wallet.tsx` renders ticket/badge QR codes and
  opens the existing Apple `.pkpass` download / Google `saveUrl` endpoints via
  `Linking.openURL`. `queue.tsx` refetches immediately on a "queue" push
  (below) and also polls `GET /api/queue/me` every 15s while focused as a
  fallback.
- `app/(tabs)/scan.tsx` — placeholder shown only to capability holders,
  explicitly says offline scanning is coming later.
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
- `lib/notification-events.ts` — `subscribeToCategory`/`emitCategory`, unit
  tested in `lib/notification-events.test.ts`. Lets a mounted screen react to
  a push the moment it arrives instead of waiting out its poll interval.
- `lib/i18n.tsx` — minimal `{ en, es, gl }`-per-key dictionary (same shape as
  `apps/web/src/lib/i18n.ts`, but only the strings these screens need), synced
  to `me.language` from `/api/me`.

**State transitions.** None — this phase is read-mostly (schedule, queue
status, wallet, notification preferences) plus one write (push token
registration). No new state machines.

## What's left

- **Offline SQLite scanners (H22–H26)** — the bulk of the remaining scope.
  Needs: an on-device SQLite schema for a lightweight local copy of
  ticket/badge data, a pending-scan queue per scanner (accreditation, badge
  replacement, presence, meals, activities), idempotent replay against the
  server when connectivity returns (never assign/serve twice), and revocation
  sync for rotated badges (H23: the old badge must reject in every scanner,
  not just the one that rotated it). The acceptance bar from the issue: no
  duplicate/lost submissions offline, and accreditation specifically must wait
  for a real server acknowledgement before it's considered final (never
  optimistically confirm a check-in without an OK from the API).
- **H38 realtime, device verification**: push delivery is wired end-to-end in
  code (server includes routing metadata, client shows/handles/routes on it,
  screen refetches on receipt) but hasn't been exercised on a real device —
  do that before calling H38 done. Also consider the SSE stream the web app
  uses (`GET /api/queue/me/stream`) as a push-independent live path for when
  the app is foregrounded; RN has no native `EventSource`, so this needs
  either a small polyfill/library or a hand-rolled fetch-stream reader that
  can carry the app's session (no cookie jar on RN — see `lib/api.ts`).
- **H51 schedule reminders**: per-activity (`schedule:<id>`) reminder opt-ins,
  which the web inbox page already supports via the same preferences API.
- **H28 wallet push updates**: listen for `LOGISTICS_WALLET_PASS_UPDATED`
  (already broadcast server-side on badge rotation) instead of relying on a
  manual refresh of the wallet screen.
- Full i18n parity with the web app (currently a small hand-picked subset of
  strings).
- Automated test coverage for replay/idempotency and revoked-badge sync
  (explicit acceptance criterion in the issue) — can't be written until the
  scanners above exist.
