# Event config & Apple/Google Wallet passes — architecture

Covers the `event` module (the `event_config` singleton, H45/H47) and how the
`logistics` module's Apple and Google Wallet passes (H28) render from it. Functional source
of truth is `plan/historias-hackos.md`; where this document and the stories
disagree, the stories win.

---

## 1. The `event_config` singleton

One row (`id = 1`, enforced by `CHECK`), created in `0002_event_config.sql` and
extended by `0003`–`0006` (and later migrations for presence policy, invite
requirements, and the shirt-size catalogue). Read via `GET /api/public/event`
(anonymous — the countdown feed for the website and TV panels) and
`GET/PUT /api/event`. `GET` is readable by anyone holding at least one
event-settings capability; `PUT` enforces **one capability per field group**
(H8) rather than a single blanket gate — `EVENT_MANAGE` for identity/timing,
`VENUE_MANAGE` for venue/Wi-Fi, `WALLET_MANAGE` for the pass fields,
`PRESENCE_MANAGE` for the presence policy, `INVITES_MANAGE` for the
sponsor/staff invite-claim requirements, `INTOLERANCES_MANAGE` for the
shirt-size catalogue (edited from Settings → Libraries, not this page). A 403
names exactly which field(s) the caller lacks rights to
(`apps/api/src/modules/event/routes.ts`'s `EVENT_SETTINGS_CAPABILITIES` map).
`PUT` is a partial update: fields omitted from the body are left unchanged;
sending `null` clears a nullable field.

| Column | Meaning |
| --- | --- |
| `name`, `tagline` | Event identity, shown on the public site and on the pass back. Admission emails read `name` through `event/service.ts`, separately from the application form name, with the same organization-name fallback as Wallet. |
| `timezone` | IANA zone name; formats pass dates and the exact expiry in admission emails. `event/service.ts` exposes this to other modules with UTC fallback when unset. |
| `event_starts_at` | **Doors open** — when attendees can arrive at the venue. This (not the hacking start) is the date/time shown on the Apple Wallet pass and Google EventTicketObject's `validTimeInterval`. |
| `event_ends_at` | **Event over** — distinct from `hacking_ends_at` (multi-day events keep going after submissions close). Becomes the Apple pass's `expirationDate` and the Google object's validity end, so Wallet stops surfacing the pass afterwards. `CHECK (ends > starts)`. |
| `hacking_starts_at`, `hacking_ends_at` | The publicly-"spoken" hacking window; drives the countdown. `CHECK (ends > starts)`. |
| `show_start_countdown` | Live "hacking starts in" countdown before the start, vs a frozen duration. |
| `participants_can_create_projects` | H19 policy switch: while `true`, an admitted participant may create another own project (`POST /api/me/projects`); there is no per-participant project-count cap. See `docs/challenges-devpost.md` §1.3. Default `false`. |
| `participant_self_service_starts_at`, `participant_self_service_ends_at` | H19/H20 participant editing window. Projects inherit the matching hacking start/end when a bound is blank; planned work groups keep their legacy open planning behavior until an organizer sets a custom bound. |
| `venue_name`, `venue_latitude`, `venue_longitude` | Venue; coordinates are all-or-nothing (`CHECK`) and drive the pass's lock-screen `locations` relevance. |
| `wifi_ssid`, `wifi_password` | Venue Wi-Fi shown on the TV screens (H42). Served by `GET /api/tv/config`, **never** by `/api/public/event`; an audit entry records that the password changed, not its value. See [TV screens](./tv-screens.md). |
| `tv_language` | Nullable; the fixed language every venue TV renders in, overriding the default. Set from `/tv/control`'s Display language section (`PATCH /api/tv/config`, `TV_CONTROL`), served by `GET /api/tv/config`. Never a signed-in caller's own language preference. See [TV screens](./tv-screens.md). |
| `pass_back_fields` | jsonb array of admin-defined `{label, value}` pairs appended to the pass back (schedule links, rules…). |
| `pass_field_labels` | jsonb map of caption overrides for the pass's fixed fields. Catalogue and defaults: `packages/shared/src/wallet-pass-labels.ts` (`PASS_FIELD_LABEL_KEYS`). Missing/blank keys fall back to the default. |
| `pass_field_visibility` | jsonb map of show/hide toggles for the pass's auto-filled front fields (`PASS_FIELD_VISIBILITY_KEYS`: participant, role, passType, university, email). Missing keys default to **visible**. |
| `presence_auto_entry_at`, `presence_certainty_window_minutes` | H24 automatic-presence policy: an optional common entry instant for people accredited earlier, and the estimator's certainty window. `PRESENCE_MANAGE`. |
| `require_sponsor_shirt_size`, `require_sponsor_dietary`, `require_staff_shirt_size`, `require_staff_dietary` | H10: whether an invited sponsor/staff account must supply a shirt size, and whether their claim form shows dietary-restriction fields at all. Off by default. `INVITES_MANAGE`, edited from Settings → Event → Invited accounts. |
| `shirt_sizes` | H12: the options offered by every shirt-size picker in the app (applications, invite claim, profile self-edit, staff user-edit) — a single event-wide catalogue instead of a hardcoded list per screen. `INTOLERANCES_MANAGE`, edited from Settings → Libraries alongside food intolerances and universities. Array order is the dropdown order (drag to reorder; people's stored `users.shirt_size` text is untouched). Saved sizes can't be renamed in place, and `PUT` answers 409 (`error.details.shirtSizesInUse`) when it would drop a size some user still holds. |

Three distinct time windows, deliberately not one:

1. `event_starts_at`/`event_ends_at` — arrival/doors open and event over →
   printed on / expires the Wallet pass.
2. `hacking_starts_at`/`hacking_ends_at` — the countdown clock.
3. Judging window — owned by `queue_settings` (H39 room pacing); the event
   endpoints expose it read-only as `judgingStartsAt`/`judgingEndsAt`.

`GET /api/event` additionally returns the read-only `organizerName` (deploy-time
`APPLE_PASS_ORGANIZATION`) so the settings page can show what the pass's
"Organized by" back field is filled with.

### Role-derived event entitlement

`roles.event_access` is the independent admission bit configured alongside a
role's capabilities and visibility from Permissions. A user has event/app
access when any assigned, non-deleted role has `event_access = true`; losing
one role therefore does not remove access while another event-bearing role
remains. Only removal or disabling of the last such role removes the live
ticket entitlement. The historical `tickets` row is retained, but ticket QR,
wallet issuance/refresh, scanner eligibility, and check-in all re-evaluate the
same live role-derived fact. Active wallet passes are voided and the existing
SSE/Wallet sync path is used when the last role is removed.

## 2. How the pass renders (apps/api/src/modules/logistics/wallet.ts)

The Apple event-ticket bundle includes the HackUDC artwork from the supplied
design asset. `strip.png`, `strip@2x.png`, and `strip@3x.png` are generated at
event-ticket strip dimensions (375×98, 750×196, and 1125×294 pixels), keeping
the source artwork sharp at each device scale. The pass also explicitly
disables strip shine so Wallet does not alter the yellow and navy artwork.
The pass palette uses `#030846` for labels and headers, `#fafafa` for value
text such as name, email, role, and pass type, and `#a3d5ff` for the
background.

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
  no value. The role field is simply the holder's highest-visible role name
  (`getHighestVisibleRoleName`, H8 — see `docs/audits/access-control-audit-plan.md`'s
  "badge_category retired entirely" section), or "Unassigned" with no visible
  role at all.
- **Back fields**, in order: event name → venue name (if set) → the custom
  `pass_back_fields` list → "Organized by" (`APPLE_PASS_ORGANIZATION`).
- **App link**: when `APPLE_PASS_APP_STORE_ID` (the mobile app's numeric App
  Store ID) is set, the pass carries `associatedStoreIdentifiers` — Wallet
  shows the hackOS app on the back of the pass (Open, or Get if not
  installed) — plus an `appLaunchURL` deep link built from
  `MOBILE_APP_SCHEME`. Unset (e.g. before the app ships on the App Store),
  the pass simply has no app link.

Saving `PUT /api/event` with an actual change bumps every issued Apple pass's
`update_tag`, enqueues a wallet push, and patches the shared Google event-ticket
class, so existing passes reflect the edit promptly (no-op saves do nothing).

### Google Wallet event tickets

Google tickets use the platform's event-ticket resources, not Generic passes:

- `/api/me/wallet/google/ticket` signs a `savetowallet` JWT containing one
  `eventTicketObject` referencing the approved class configured by
  `GOOGLE_WALLET_EVENT_TICKET_CLASS_ID` (currently
  `3388000000023085754.pass.org.gpul.hackudc`).
  The object is synchronized through REST first; the JWT carries only its ID.
  The object ID is unique and contains no internal user ID.
- The JWT includes the required `origins` claim, derived from the `WEB_URL`
  origin, and is signed with the configured service-account key using RS256.
  The resulting link follows Google's `https://pay.google.com/gp/v/save/<JWT>`
  format and is kept below Google's recommended 1,800-character limit by the
  compact payload.
- Event name, doors-open/start/end times, structured venue, venue coordinates, the
  ticket holder, ticket number, QR barcode, and validity interval are sent in
  the shapes documented by Google's [EventTicketClass](https://developers.google.com/wallet/reference/rest/v1/eventticketclass)
  and [EventTicketObject](https://developers.google.com/wallet/reference/rest/v1/eventticketobject)
  APIs. Class refreshes use `PATCH eventTicketClass/{resourceId}`; object
  invalidation uses `PATCH eventTicketObject/{resourceId}`.
- The class owns the display template: the card rows and details explicitly
  reference the event date, venue, holder, type, and ticket number. Optional
  `GOOGLE_WALLET_LOGO_URL`, `GOOGLE_WALLET_HERO_IMAGE_URL`,
  `GOOGLE_WALLET_WIDE_LOGO_URL`, and `GOOGLE_WALLET_BACKGROUND_COLOR` control
  class branding. Google Wallet caches saved passes, so remove and re-add an
  existing test pass after a class/template or image change.
- Badges remain Generic passes. The `wallet_passes.google_object_type` column
  records the resource family so expiry and account-removal cleanup never call
  a Generic endpoint for an Event Ticket. Existing production ticket rows are
  backfilled as `generic` and are retired/expired when their owner next asks
  for a Google ticket; new ticket rows are `event_ticket`.

Google ticket classes must be created and approved before issuance. The API
synchronizes the class and object before issuing an ID-only save JWT; the
holder's save attaches that object to Wallet. The worker updates existing
classes and objects after configuration edits. Complete the issuer's
[publishing-access](https://developers.google.com/wallet/tickets/events/test-and-go-live/request-publishing-access)
requirements; Demo Mode is limited to configured test users.

### Google deployment isolation and branding (H28)

Production and staging **must use different approved
`GOOGLE_WALLET_EVENT_TICKET_CLASS_ID` values**, even when they share an issuer
and service account. Google stores the event name, dates, venue, and template
on the class. If both environments reference the same class, the last event
settings save overwrites those shared fields for tickets from both deployments.
The default class ID is also shared under one issuer; configure explicit IDs.

Create/approve a class for each deployment in the Google Wallet console, set
its full `<issuer>.<identifier>` ID in that deployment's API and worker env,
and recreate both services. Production should retain the original class if
production tickets already reference it; move staging to a new class, then
save an actual event-setting change in production to restore the original
class's content. Previously saved staging tickets still reference the old
class and need replacement objects with new IDs; changing an env var or
removing/re-adding the same object does not move them.

`GOOGLE_WALLET_BACKGROUND_COLOR` defaults to Apple's light blue `#a3d5ff`.
An explicit env value overrides it. Google uses its own native layout and text
colors; logo/hero/wide-logo images must be publicly accessible HTTPS URLs set
through `GOOGLE_WALLET_LOGO_URL`, `GOOGLE_WALLET_HERO_IMAGE_URL`, and
`GOOGLE_WALLET_WIDE_LOGO_URL`. Apple bundles its artwork in the pass instead.
Existing Google objects carry their own background color, so a class color
change alone does not recolor those objects. The runtime refresh now also
patches individual objects.

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
   Event-wide bumps use the greater of database epoch milliseconds and one
   above the highest existing Apple tag, with a per-row increment floor for
   concurrent bumps. This keeps them strictly ahead of a device's previous
   cursor even when the database clock lags the Node issuance clock (#896).
2. The `logistics.wallet-sync` worker sends an APNs push per registered device
   (`apple-push.ts`): empty payload, `apns-topic` = pass type id,
   `apns-push-type: alert` (background pushes get throttled/dropped by iOS).
   Provider/device failures are collected after fan-out, so they do not block
   other recipients. Failed jobs retry up to five attempts with exponential
   backoff starting at five seconds; retries can repeat successful pushes.
3. The device (pushed or pull-to-refresh) polls
   `GET /v1/devices/…/registrations/{ptid}?passesUpdatedSince=X`, where `X` is
   the `lastUpdated` we sent it last time; `appleChangedSerials` compares tags
   **numerically** and returns the changed serials. This collection request has
   no `Authorization` header: the registered device library identifier is its
   shared secret. Only that device’s registered Apple passes are returned.
4. The device refetches each changed pass; the pass GET serves `Last-Modified`
   (from `update_tag`) and answers `304` to a matching `If-Modified-Since`.

Wallet logs its client-side errors to `POST /v1/log` — those lines are printed
with a `wallet: device log:` prefix, and are the first place to look when a
phone won't update.

### Access boundary

`GET /api/me/wallet/apple/:purpose.pkpass` and the Google save-url endpoint
are authenticated self-service routes: a signed-in user can issue only their
own pass. The `/api/wallet/apple/v1/*` device protocol deliberately does not
use browser sessions; registration, unregistration, and pass downloads require
`Authorization: ApplePass <authenticationToken>`. Changed-pass polling authenticates
with the registered device library identifier, as required by PassKit, and
returns only that device’s registered Apple serials.

## 3. The settings page (apps/web/src/app/(app)/settings/event/page.tsx)

Six capability-gated tabs: Event, Venue, Apple Wallet pass, Presence, Invited
accounts, and Danger zone. Editable categories use open sections and save only
their own fields through `PUT /api/event`; changing tabs with unsaved edits
requires confirmation. The active tab names its panel without a repeated section
header. A shared save footer pairs the submit button with the persistent save
state; successful saves also use the app's Sileo toast. Forms retain native Enter
submission from inputs. Multi-column fields align at the start so helpers do not
move neighboring labels or controls. The danger zone keeps the three-stage event-wide reset
confirmation (H16–H40/H53). Judging timing lives in Queue → Rooms, on the separate
`/api/queue/settings` resource (`QUEUE_ADMIN`).

Event is split into General (identity), Schedule (paired event/hacking dates,
countdown preview, email reminder) and Participants (project creation and
editing dates) views that share one save; a validation error on a hidden view
reveals it. A form inside a settings card sets `--form-footer-bg` so its sticky
footer matches the card instead of the shell. Every populated date shows the event
timezone; previews follow the draft timezone before saving. Venue and Wi-Fi
share one save action at the end. Presence-policy consequences stay beside the
two controls, rather than behind a disclosure. Invite toggles distinguish a
required shirt size from optional dietary information. Wallet-pass conventions:

- Caption inputs are prefilled with the **resolved** caption (override or
  default) — no placeholders; what you see is what the pass prints. On save,
  captions equal to the default are dropped so they keep tracking it.
- Auto-filled fields never ask for a value: front rows name the field without
  explaining obvious values; the university row notes its empty-value behavior.
  Built-in back rows display the live value they'll carry
  (event name, venue name, `organizerName`).
- Back-field caption and custom label/value inputs have persistent labels.
  Less-frequent back-field edits remain behind a disclosure; the preview stays
  visible while editing.
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
- The page shows Add to Apple/Google Wallet alongside a visible QR for scanning
  at the door.
- The page shows the holder’s name and masked email, Wallet buttons and the
  ticket QR together. A session belonging to the holder is preserved and
  "Go to app" opens the schedule. A different account is signed out with an
  explicit notice; anonymous visitors continue through `/login`. The token
  itself never creates a session, and scoped pass requests always use its owner.

`WalletButtons` (`apps/web/src/components/common/wallet-buttons.tsx`) is shared
by this page and the signed-in wallet page; passing `accessToken` switches it to
the scoped routes and to `credentials: "omit"` fetches, so the request carries
no cookie at all. The Apple Wallet badge is a same-tab link: the browser must
hand the `.pkpass` response to Wallet without creating a blank tab that the
holder has to close manually.

## Pre-event email reminder (H45, H52)

The Event tab includes an email-reminder section in its existing form. Its
switch and send date share the category's Save changes action and unsaved-change
guard. `PUT /api/event` accepts optional `eventReminderScheduledAt` (ISO instant;
null cancels). Event identity, dates, reminder and audit commit together. The
field requires `EVENT_MANAGE`; scheduling needs a non-empty name and a future
send time before `event_starts_at`. Scheduling and the due worker use the
PostgreSQL clock; regression tests derive invalid instants from that clock so
host/database skew cannot bypass the rejection or rollback assertions (#894,
#895). GET includes the latest `eventReminder`
status (`scheduled`, `queued`, `cancelled`, `expired`) and recipient count.

Migration 0603 stores reminder history, with at most one pending schedule.
The 15-second `event-email-reminders` worker claims due rows with `FOR UPDATE
SKIP LOCKED`, then atomically enqueues one email per active, non-synthetic
`user_event_access` holder. Multiple qualifying roles do not duplicate emails.
This event-wide operational email is sent to every eligible account, independent
of optional activity subscriptions. After doors open, a missed schedule expires.

Delivery checks current access and the opening time again. Dates use each
recipient's language and the event timezone. The permanent entrance token is
rendered locally as a PNG QR and attached inline (CID); no external QR service
receives ticket credentials. Official Apple/Google Wallet artwork is exported
from the SVGs already used on `/wallet` to email-compatible PNGs, preserving the
artwork and aspect ratio; Galician uses Spanish artwork. Email buttons open
`/wallet?add=apple` or `?add=google`, retaining the action through login, then
request the authenticated recipient's pass. A separate `/wallet` link remains
available. No long-lived sessionless Wallet credential is issued.

## Runtime editor, artwork, actions, and manual operations (H28/H53)

Settings → Event → Wallet passes now controls both providers. Existing
`passFieldLabels`, `passFieldVisibility`, and `passBackFields` drive Apple
fields and Google card/detail templates. Google renders its own native card;
it shows at most ten text modules per class/object, so overflow back fields
are grouped in the last details block rather than dropped. URL-valued back
fields become clickable links. Dates use doors-open time on both platforms.

The separate `wallet_settings` singleton (`0501`, with nullable override
columns) stores common background,
Apple value/label colors, website, schedule deep link, action visibility,
App Store ID, Android package/store link, and native Apple/Google options.
`GET/PUT /api/event/wallet` requires `WALLET_MANAGE`; writes are audited in
one transaction with the Apple update-tag bump, then provider refresh is
queued. The editor groups shared content and actions, Apple-only options,
Google-only options, then each provider's artwork. Shared front/back fields
are entered once and reused by both providers. Apple description, logo text,
sharing, and Google issuer/country have labeled controls; provider JSON is an
expert-only disclosure for fields without a dedicated control (semantic tags,
templates, messages, and links). Signing/account identity, pass identifiers, QR credentials,
authentication tokens, provider review state, and revocation state cannot be
overridden. Apple always retains its managed alert field. A malformed
provider-specific option can still be refused by the provider; use the linked
native schemas and verify on devices before event-wide use.
Every unsaved setting resolves from its deployment environment: the existing
`GOOGLE_WALLET_BACKGROUND_COLOR`, `APPLE_PASS_APP_STORE_ID`, Google image URLs,
and `MOBILE_APP_SCHEME`, plus the `WALLET_*` appearance, link, and native-option
variables. A Save leaves fields equal to the current deployment value unset,
so later environment changes still flow through to untouched fields.
`DELETE /api/event/wallet` clears the field overrides and restores
those environment values; artwork uses its own per-slot reset. This lets a
deployment retain its own branding until a manager intentionally saves an
override, and reverts cleanly when one is removed.

### Artwork served by hackOS

`GET /api/event/wallet` returns the selected artwork and default previews.
The Apple icon, logo, and strip previews are served from the exact bundled
files in `apps/api/assets/apple-wallet` by
`GET /api/wallet/artwork/default/:slot/:scale.png`; the bundled logo currently
has 1× and 2× files, while the icon and strip have all three scales. Unset
Google slots preview their deployment image URL, when configured.

`POST /api/event/wallet/artwork/:slot` accepts PNG/JPEG/WebP up to 5 MB per file and
20 megapixels. Apple uploads can contain `file` (1×), `file2x`, and `file3x`
in one request. Sharp validates/decodes each image, strips source metadata,
rotates for orientation, and generates normalized PNG files in S3. Missing
Apple scales are derived from the largest uploaded variant. Apple slots
include icon, logo, strip, background, thumbnail, and footer, at 1×/2×/3×.
Google slots include logo, wide logo, hero, and details image. Strip/hero
images use cover cropping; the other slots preserve proportions with transparent
padding. Shared slot dimensions live in `packages/shared/src/wallet-settings.ts`.
Uploads select the new revision immediately and enqueue pass updates. Reset
restores bundled Apple artwork or the deployment-configured Google image.

The public `GET /api/wallet/artwork/:id/:scale.png` route serves only published
artwork IDs, with immutable caching. It never accepts arbitrary storage keys.
Google receives these API URLs; Apple embeds the S3 bytes in the signed pass.
Both API and worker need the existing S3 configuration. `BETTER_AUTH_URL`
must be publicly reachable over HTTPS for Google to fetch the artwork.
Previously published image revisions remain available because saved passes
and provider caches can still reference them. Include this prefix in S3 backups.

### Actions and app links

Apple's iOS 27 `featuredActions` supports two native action tiles: `place` for
venue directions and `viewSchedule` for the configurable app schedule link
(default `hackos:///schedule`). Older OS versions retain the same actions as
clickable back fields, plus the website (default `https://os.hackudc.com`).
Tickets also supply venue/date semantic metadata. This change preserves the
classic event-ticket artwork; adopting a poster style requires its documented
semantic fields and image assets through native options.

Google uses directions/website/schedule links and `appLinkData`:
`androidAppLinkInfo.appTarget.packageName` defaults to `com.hackudc.os` and
`webAppLinkInfo` points to the website. The Play Store URL is also available
in pass details. Native JSON overrides can customize these targets. Google
controls how its client renders the app/open/install affordance.

### Manual alerts and refresh

`POST /api/event/wallet/operations` accepts either `{kind:"refresh"}` or
`{kind:"alert",translations:{es:{title,body},gl:{title,body},en:{title,body}}}`.
Both require `WALLET_MANAGE`, are audited, support Idempotency-Key, and return
202 with a durable operation ID and delivery counts. Recipients are active,
entitled passes in the operator's real/synthetic scope. Event-wide settings
and graphics cannot be modified by synthetic operators. A row lock serializes
the event-wide limit of three alerts per scope per rolling 24 hours.

The `logistics.wallet-operations` tick runs every 15 seconds, claims individual
pass deliveries with a lease, and retries each independently up to five times
with exponential backoff. No provider call holds the producer transaction.
Restarting a worker resumes pending rows. `GET /api/event/wallet/operations/:id`
reports queued, sent, failed, and skipped counts, scoped to real/test accounts.
“Sent” means provider acceptance, not a delivery/read receipt.

Apple APNs is a refresh signal, not an arbitrary notification payload. Alerts
update a persistent back field with `changeMessage:"%@"`; iOS may show the
changed value after fetching the pass. Identical repeated message text need
not create a second notification. Google uses object-level
`addMessage` with `TEXT_AND_NOTIFY`, checking the stable operation message ID
before retrying to avoid duplicate messages after an interrupted response.
Notifications depend on provider limits, user preferences, and connectivity.

A manual refresh advances Apple tags and requests a fetch; Google patches the
class and full individual object, including fields, color, graphics and
validity. Google Save links now synchronize full class/object content through
REST and carry only the object ID in the signed JWT, keeping long customization
out of Google's recommended 1,800-character save URL. Ticket classes must
already be approved and isolated per environment.

Primary provider references:
- [Google event pass builder](https://developers.google.com/wallet/tickets/events/resources/pass-builder)
- [Google card/detail templates](https://developers.google.com/wallet/reference/rest/v1/ClassTemplateInfo)
- [Google messages and notifications](https://developers.google.com/wallet/tickets/events/use-cases/trigger-push-notifications)
- [Google app links](https://developers.google.com/wallet/reference/rest/v1/AppLinkData)
- [Apple featured actions](https://developer.apple.com/videos/play/wwdc2026/209/)
- [Apple pass fields and change messages](https://developer.apple.com/documentation/walletpasses/passfieldcontent)

## Web category ownership

Event settings is a list of capability-gated categories (`/settings/event`) and
opens one bounded category at a time (`?tab=`) with a back control. Judging hours live at `?tab=judging`, require `queue:admin`,
and save the separate queue settings resource. Wallet has one Save changes
action shared by its Fields and Appearance views. Images and delivery are
separate views; `?tab=wallet&wallet=appearance|artwork|delivery` preserves
shareable subview links and browser history. It saves the two
existing resources in sequence; failures remain visible for retry, rather than
claiming an atomic cross-resource update. Artwork upload/reset and pass delivery
are immediate operations with their own lifecycle. Nullable runtime overrides
and deployment fallback resolution remain unchanged.
