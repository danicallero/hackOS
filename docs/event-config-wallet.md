# Event config & the Apple Wallet pass — architecture

Covers the `event` module (the `event_config` singleton, H45/H47) and how the
`logistics` module's Apple Wallet pass (H28) renders from it. Functional source
of truth is `plan/historias-hackos.md`; where this document and the stories
disagree, the stories win.

---

## 1. The `event_config` singleton

One row (`id = 1`, enforced by `CHECK`), created in `0002_event_config.sql` and
extended by `0003`–`0006`. Read via `GET /api/public/event` (anonymous — the
countdown feed for the website and TV panels) and `GET/PUT /api/event`
(capability `SCHEDULE_MANAGE`). `PUT` is a partial update: fields omitted from
the body are left unchanged; sending `null` clears a nullable field.

| Column | Meaning |
| --- | --- |
| `name`, `tagline` | Event identity, shown on the public site and on the pass back. |
| `timezone` | IANA zone name; formats the date/time printed on the pass. |
| `event_starts_at` | **Doors open** — when attendees can arrive at the venue. This (not the hacking start) is the date/time shown on the Apple Wallet pass and its `relevantDate`. |
| `event_ends_at` | **Event over** — distinct from `hacking_ends_at` (multi-day events keep going after submissions close). Becomes the Wallet pass's `expirationDate`, so Wallet stops surfacing the pass afterwards. `CHECK (ends > starts)`. |
| `hacking_starts_at`, `hacking_ends_at` | The publicly-"spoken" hacking window; drives the countdown. `CHECK (ends > starts)`. |
| `show_start_countdown` | Live "hacking starts in" countdown before the start, vs a frozen duration. |
| `participants_can_create_projects` | H19 policy switch: while `true`, a participant with no project may create their own (`POST /api/me/projects`); see `docs/challenges-devpost.md` §1.3. Default `false`. |
| `venue_name`, `venue_latitude`, `venue_longitude` | Venue; coordinates are all-or-nothing (`CHECK`) and drive the pass's lock-screen `locations` relevance. |
| `wifi_ssid`, `wifi_password` | Venue Wi-Fi shown on the TV screens (H42). Served by `GET /api/tv/config`, **never** by `/api/public/event`; an audit entry records that the password changed, not its value. See [TV screens](./tv-screens.md). |
| `pass_back_fields` | jsonb array of admin-defined `{label, value}` pairs appended to the pass back (schedule links, rules…). |
| `pass_field_labels` | jsonb map of caption overrides for the pass's fixed fields. Catalogue and defaults: `packages/shared/src/wallet-pass-labels.ts` (`PASS_FIELD_LABEL_KEYS`). Missing/blank keys fall back to the default. |
| `pass_field_visibility` | jsonb map of show/hide toggles for the pass's auto-filled front fields (`PASS_FIELD_VISIBILITY_KEYS`: participant, role, passType, university, email). Missing keys default to **visible**. |

Three distinct time windows, deliberately not one:

1. `event_starts_at`/`event_ends_at` — arrival/doors open and event over →
   printed on / expires the Wallet pass.
2. `hacking_starts_at`/`hacking_ends_at` — the countdown clock.
3. Judging window — owned by `queue_settings` (H39 room pacing); the event
   endpoints expose it read-only as `judgingStartsAt`/`judgingEndsAt`.

`GET /api/event` additionally returns the read-only `organizerName` (deploy-time
`APPLE_PASS_ORGANIZATION`) so the settings page can show what the pass's
"Organized by" back field is filled with.

## 2. How the pass renders (apps/api/src/modules/logistics/wallet.ts)

`passPayload()` reads `event_config` fresh on every pass fetch — nothing about
the event is baked into issued passes. Composition:

- **Header** (top corner, left-aligned): tickets show the doors-open time and
  date (`event_starts_at`, falling back to `hacking_starts_at` for deployments
  that predate `0006`), formatted "6 feb 2026" with the month abbreviated in
  the **holder's language** (`users.language` → es/gl/en locale). Badges are
  not date-bound: they show the uppercased `badgeValue` caption ("BADGE")
  instead of a date.
- **Expiry**: `event_ends_at` becomes the pass `expirationDate` (multi-day
  events end later than hacking); unset means the pass never expires.
- **Front (secondary/auxiliary) fields**: attendee name, role, pass type
  (Ticket/Badge), university, email — each auto-filled from the user row and
  each behind its `pass_field_visibility` toggle, captioned per
  `pass_field_labels`. University/email rows also drop out when the user has
  no value.
- **Back fields**, in order: event name → venue name (if set) → the custom
  `pass_back_fields` list → "Organized by" (`APPLE_PASS_ORGANIZATION`).
- **App link**: when `APPLE_PASS_APP_STORE_ID` (the mobile app's numeric App
  Store ID) is set, the pass carries `associatedStoreIdentifiers` — Wallet
  shows the hackOS app on the back of the pass (Open, or Get if not
  installed) — plus an `appLaunchURL` deep link built from
  `MOBILE_APP_SCHEME`. Unset (e.g. before the app ships on the App Store),
  the pass simply has no app link.

Saving `PUT /api/event` with an actual change bumps every issued Apple pass's
`update_tag` and enqueues a wallet push, so Wallet devices refetch immediately
(no-op saves push nothing).

### How a device learns about a change (H28)

The pass's `webServiceURL` is `{BETTER_AUTH_URL}/api/wallet/apple` — the
**base without `/v1`**, because the device appends `v1/…` itself (Apple's
endpoint templates are `{webServiceURL}/v1/devices/…`). Baking `/v1` into it
made every device call `/v1/v1/…`, so registrations 404'd and nothing below
ever ran. Passes installed while the URL was wrong never registered and can't
be pushed a fix — holders must re-add the pass.

1. The API bumps `wallet_passes.update_tag` — canonical format is **integer
   epoch milliseconds** (`0504`; it was mixed seconds/millis before, which
   broke the text comparison in step 3 and devices never refetched).
2. The `logistics.wallet-sync` worker sends an APNs push per registered device
   (`apple-push.ts`): empty payload, `apns-topic` = pass type id,
   `apns-push-type: alert` (background pushes get throttled/dropped by iOS).
3. The device (pushed or pull-to-refresh) polls
   `GET /v1/devices/…/registrations/{ptid}?passesUpdatedSince=X`, where `X` is
   the `lastUpdated` we sent it last time; `appleChangedSerials` compares tags
   **numerically** and returns the changed serials.
4. The device refetches each changed pass; the pass GET serves `Last-Modified`
   (from `update_tag`) and answers `304` to a matching `If-Modified-Since`.

Wallet logs its client-side errors to `POST /v1/log` — those lines are printed
with a `wallet: device log:` prefix, and are the first place to look when a
phone won't update.

### Access boundary

`GET /api/me/wallet/apple/:purpose.pkpass` and the Google save-url endpoint
are authenticated self-service routes: a signed-in user can issue only their
own pass. The `/api/wallet/apple/v1/*` device protocol deliberately does not
use browser sessions; every endpoint requires `Authorization: ApplePass
<authenticationToken>`, validates that token against an Apple pass record, and
the changed-registration poll additionally verifies that the token belongs to
a pass registered on the requested device. This prevents a valid token for one
pass from enumerating another device's serial numbers while preserving the
native PassKit protocol.

## 3. The settings page (apps/web/src/app/(app)/settings/event/page.tsx)

One form over `GET/PUT /api/event`, presented as four cards — Event (identity),
Schedule (doors open + hacking window), Venue, and Apple Wallet pass — plus a
separate Judging-window form (different resource, `/api/queue/settings`,
capability `QUEUE_ADMIN`). Wallet-pass conventions the UI relies on:

- Caption inputs are prefilled with the **resolved** caption (override or
  default) — no placeholders; what you see is what the pass prints. On save,
  captions equal to the default are dropped so they keep tracking it.
- Auto-filled fields never ask for a value: each row shows a note of what
  fills it, and the built-in back rows display the live value they'll carry
  (event name, venue name, `organizerName`).
- Venue coordinates accept decimal degrees (dot or comma decimals) or DMS
  ("43°19′58″N", with `O` accepted for Spanish "Oeste"), and a full pair
  pasted into either box fills both — parsing lives in
  `apps/web/src/lib/coords.ts`; the API itself only speaks signed decimals.

## 4. Getting a pass without a session — the confirmation flow (issue #369)

The acceptance email's "Accept my spot" link (H15) lands on
`apps/web/src/app/(auth)/applications/confirm/page.tsx`, which POSTs the token
to the public `POST /api/applications/confirm`. That token is an **identity
assertion for one action, never a session**, and the landing page is built
around that rule:

- The confirm response carries `wallet_token` (plus `user_id` and a masked
  email). It is a row in `wallet_access_tokens`
  (`logistics/wallet-access.ts`, migration `0510`): random, bound to one
  `(user, purpose)`, valid for **one hour**, multi-use inside that window
  (adding the pass to both wallets, or retrying, is normal). The
  `applications-expirer` tick drops rows a day past expiry.
- The only routes that accept it are
  `GET /api/wallet/scoped/apple/:purpose.pkpass?token=…` and
  `GET /api/wallet/scoped/google/:purpose?token=…`. They ignore `req.userId`
  entirely: the pass belongs to the token's user even if a *different* account
  is signed in on that browser. A ticket-scoped token cannot fetch a badge
  pass. Anything else — `/api/me`, `/api/me/wallet/*` — still answers 401.
- The page's **primary** action is Add to Apple/Google Wallet; the QR is behind
  a "Show ticket code" toggle for anyone without a wallet app.
- Opening the link **ends any session in that browser** (Better Auth sign-out
  from the client), and says so. If the session belonged to another account,
  the notice names the masked email the ticket belongs to. "Go to app" signs
  out and routes to `/login`, so reaching the app is always a fresh sign-in.

`WalletButtons` (`apps/web/src/components/common/wallet-buttons.tsx`) is shared
by this page and the signed-in wallet page; passing `accessToken` switches it to
the scoped routes and to `credentials: "omit"` fetches, so the request carries
no cookie at all.
