# Mobile app (`apps/mobile`)

Native Expo Router app for issue #73: Better Auth session continuity,
capability-driven tabs, participant-facing screens, authenticated realtime,
and offline SQLite scanners for accreditation, badge rotation, presence,
meals, and registrable activities.

For development builds, prebuild/CNG, EAS profiles, signing, certificates,
store assets, submission, and the release checklist, see
[`mobile-release.md`](./mobile-release.md).

## Story coverage registry (issue #73: H4, H22–H26, H28, H38, H51, H55)

| Story | Scope | Status | Notes |
| --- | --- | --- | --- |
| H4 | Login/logout, session persists via Better Auth Expo + `expo-secure-store` | ✅ Done | `lib/auth-client.ts`, `app/(auth)/sign-in.tsx`. Server-side logout (session revocation) reuses the existing Better Auth endpoint — no mobile-specific work needed. |
| H55 | One app, capability-driven tabs, permission changes apply without reinstall | ✅ Done | `lib/tabs.ts` + `app/(tabs)/_layout.tsx`. Only participant tabs + one staff placeholder tab exist; more staff tabs arrive as scanners are built. |
| H38 | Participant sees queue status/position/ETA, pre-alert, call notice | 🟡 Device QA | Push receipt/tap and the authenticated `GET /api/queue/me/stream` native fetch stream both refetch queue state immediately; 15s focused polling is the recovery path. Code/tests are complete, but APNs/FCM delivery still needs real-device verification. |
| H51 | Notification channel preferences per category; queue calls non-optional | ✅ Done | Static category preferences, mandatory queue notices, and `schedule:<id>` activity-reminder opt-ins are available on mobile. |
| H28 | Ticket/badge in Apple & Google Wallet; old pass auto-invalidates on badge rotation | 🟡 Device QA | QR wallet, authenticated Apple `.pkpass` download/share, Google save URL, server-side pass invalidation/push, and foreground wallet refetch on `LOGISTICS_WALLET_PASS_UPDATED` are wired. Real Wallet apps/credentials still need device QA. |
| H22 | Accreditation scanner: local SQLite lookup, badge assignment, server-confirmed | 🟡 Device QA | Ticket/person cards live in SQLite. The assignment is persisted/retried but is explicitly shown as **not accredited** until the API acknowledges the idempotent request. |
| H23 | Badge replacement, offline-first, revocation synced later | 🟡 Device QA | Rotation updates the originating scanner immediately; each successful full snapshot replaces the complete revoked-badge set so every scanner rejects old badges. |
| H24 | Presence (door in/out) scanner, offline queue, manual back-dated entries | 🟡 Device QA | In/out and optional ISO backdated timestamps use the durable shared queue and idempotent replay. |
| H25 | Meals scanner, offline queue, repeat-serving confirmation | 🟡 Device QA | Local entitlement/count data drives first-serving/repeat confirmation; every accepted scan stays queued until API acknowledgement. |
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
  and current/revoked badge mappings, scannable activities, meal
  entitlements/counts, and last door state needed by H22-H26. A full snapshot
  is deliberate: badge-history values have no individual timestamp, and a
  complete replacement guarantees convergence after any missed refresh.

**UI (`apps/mobile`).**
- `lib/auth-client.ts` — Better Auth client using `expo-secure-store` for
  session storage instead of a cookie jar (H4's explicit requirement).
- `lib/api.ts` — thin wrapper around the auth client's underlying fetch so
  every API call (not just `/api/auth/*`) carries the restored session.
- `lib/tabs.ts` (`visibleTabs`) — pure function mapping `me.capabilities` to
  the visible tab set; unit-tested in `lib/tabs.test.ts`. Participant tabs
  (schedule, queue, wallet, notifications, account) are unconditional; `scan`
  appears only for `ACCREDIT_SCAN`/`PRESENCE_SCAN`/`ACTIVITY_SCAN` (or the
  admin `*` wildcard).
- `app/(tabs)/_layout.tsx` — reads capabilities from a shared `/api/me` fetch
  (`lib/me-context.tsx`, `lib/use-me.ts`) and hides tabs via Expo Router's
  `href: null` mechanism rather than omitting the route, so the underlying
  screen stays reachable. The fetch refetches on app foreground, so a
  capability change made elsewhere (web admin) shows up without a reinstall
  (H55's explicit acceptance bar).
- `app/(auth)/sign-in.tsx` — email/password only; no in-app registration
  (accounts come from the web onboarding/invite flows, H10/H12).
- `app/(tabs)/schedule.tsx`, `queue.tsx`, `wallet.tsx`, `notifications.tsx`,
  `account.tsx` — the five participant screens. API-backed screens expose
  loading, retryable error, and empty states without leaking rejected promises.
  The account screen displays the shared `/api/me` profile, refreshes it, and
  provides a confirmed sign-out action for the device session. `wallet.tsx`
  renders ticket/badge QR codes and
  opens the existing Apple `.pkpass` download / Google `saveUrl` endpoints via
  `Linking.openURL`. `queue.tsx` refetches immediately on a "queue" push
  (below) and also polls `GET /api/queue/me` every 15s while focused as a
  fallback.
- `app/(tabs)/scan.tsx` — camera/manual scanners selected by capability:
  accreditation, badge replacement, door presence, meals, and activities.
  `lib/scanner-db.ts` owns the WAL-mode SQLite schema and durable device queue;
  `lib/scanner-sync.ts` replays in creation order with the persisted scan id as
  `Idempotency-Key`, then installs the latest server snapshot/revocation set.
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
