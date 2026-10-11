# Live Activities and Live Updates (#966)

System-level, glanceable surfaces for two time-bound moments of the event:

- **Participant queue (H38)**: during the judging window only, the
  participant's *nearest* queue, with position and ETA, then the room once the
  team is called (H29).
- **Staff meal or activity (H25, H26)**: for holders of `activity:scan`, from
  `LIVE_ACTIVITY_LEAD_MINUTES` before a scannable activity starts until it
  ends, a countdown and then a live attendance counter with one **Scan**
  action that opens the scanner already bound to that activity.

On iOS these are ActivityKit Live Activities (Dynamic Island, Lock Screen,
Apple Watch Smart Stack, CarPlay), rendered by `expo-widgets`. On Android they
are promoted ongoing notifications (Live Updates on Android 16, plain ongoing
notifications before that), rendered by the local `modules/live-updates`
module. Home-screen widgets are out of scope. This page covers the API side;
the client side is in [mobile.md](./mobile.md).

## Architecture

```
            state.ts (single builder)
           /                         \
GET /api/me/live-activities      worker.ts (every 20 s)
(app in foreground: starts         ├─ iOS: apns.ts → APNs HTTP/2, token auth
 and updates locally)              └─ Android: android.ts → Expo data push
```

| File (`apps/api/src/modules/live-activities/`) | Role |
| --- | --- |
| `state.ts` | Builds `QueueLiveProps` and `ActivityLiveProps` (`@hackos/shared/live-activities`). Both the read endpoint and the worker call it, so a local refresh and a remote push never disagree. |
| `routes.ts`, `schemas.ts` | Device/session registry and the read model. |
| `apns.ts` | ES256 provider token, the `aps` payload, and the HTTP/2 transport. |
| `android.ts` | Data-only Expo push through `postExpoPushMessages` (shared with the notification push channel). |
| `worker.ts` | The `live-activities` repeatable job: desired state against known sessions, then start, update or end. |

The props contract lives in `packages/shared/src/live-activities.ts`. Labels
arrive pre-localized in the props, because the iOS widget extension runs
without the app's i18n bundle. The language is the device's `language`, else
the account language.

## Gating rules

### Queue (H38)

- Exists only while the judging window is open:
  `queue_settings.schedule_start_at <= now() < schedule_end_at` (an unset end
  is open-ended). **Decision:** an unset start counts as *closed*, unlike the
  queue pump. A system-level surface must not appear before organizers
  schedule judging.
- Built from `myQueueStatus(userId)` (queue/reads.ts). Its SQL is not
  duplicated, so repository membership, shared queue groups and H54 fixture
  isolation stay identical to the participant's queue screen.
  `hasMyQueueItems` runs first as a cheap pre-check.
- Nearest entry: a `called` or `in_room` entry beats any waiting one
  (`in_room` first, then the earliest call). Among waiting entries the smallest
  `etaMinutes` wins, then position. `presenting` and `completed` entries are
  skipped: they are over for the participant.
- `otherQueues`: the other entries still waiting, called or in a room.
- `roomName`/`roomLocation`/`calledAt` are set only once the team is called;
  `position` and `etaMinutes` only while it is waiting. `calledAt` drives a
  count-up "Called 2:13" timer — the same elapsed time H34 shows operators,
  never presented as a deadline.
- `startPosition`: the highest position the entry has had while waiting, so
  the progress track fills as the team moves up. Positions are not stored
  historically, so the API keeps a per-entry high-water mark in Valkey
  (`live-activities:queue-peak:<entryId>`, 24 h TTL, atomic Lua max). A
  Valkey failure only drops the field; the track then shows the stage alone.
- `url`: `hackos://queue` (the scheme is `MOBILE_APP_SCHEME`).

### Staff activities (H25, H26)

- Only for users holding `activity:scan` (or `*`). These are resolved for all
  candidate users in one query against `user_effective_capabilities`.
- Activities: meal kinds are always scannable, others need `requires_scan`.
  This is the same rule as the scanner's activity list (`logistics/stats.ts`).
  The linked `schedule` row must start within `LIVE_ACTIVITY_LEAD_MINUTES`
  (default 15) or still be running (`now() < ends_at`). `phase` is `upcoming`
  before `starts_at` and `live` after it.
- **Decision (H59):** `schedule_owners` records who is *responsible* for an
  item (preparation, checklist), not who scans at it. Scanning has no
  per-activity staff assignment. Every `activity:scan` holder therefore gets
  every relevant activity, and the per-device opt-out is the escape hatch.
  Schedule `audiences` and `visibility` describe who may *read* an item and do
  not gate staff.
- `scanned`: distinct active, non-anonymized people in `activity_logs`. As
  elsewhere for H54, these are split by `is_test_account`: a synthetic
  (review fixture) operator counts only synthetic subjects, and a real
  operator only real ones.
- `inside`/`remaining` (live meals only, H24/H27): `inside` is the presence
  estimate (`occupancyEstimate`, the logistics panel's served-vs-present
  denominator) and `remaining` is how many of those people have no scan for
  the meal yet. Computed once per tick and only while a meal is live, since
  the estimate reads every presence event. A synthetic operator gets `null`
  (the estimate covers real accounts only). Other activities and upcoming
  meals get `null`.
- `name`: `name_i18n[language]`, then `name_i18n.en`, then `name`.
- `url` and `scanUrl`: both `hackos://scan?activity=<id>`. A tap and the Scan
  button both open the scanner bound to that activity. iOS keeps the tap URL
  in the static `attributes.url`.

### Preferences

**Decision:** queue calls are already non-optional operational notices (H51),
and the Live Activity mirrors the queue screen rather than adding a new
notification category. The opt-out is therefore the device's `enabled` flag
(`PUT /api/me/live-activities/device`) rather than an H51 preference row. A
dismissed activity stays away until its phase changes (see the state machine).

## Registry

| Route | Purpose |
| --- | --- |
| `PUT /api/me/live-activities/device` | Upsert this install: `deviceId`, `platform`, `pushToStartToken` (iOS 17.2+), `expoPushToken` (Android), `language`, `enabled`. Omitted fields keep their value; `null` clears it. A token belongs to one device: registering it clears it from any other row (a reinstall). A `deviceId` registered by another account moves to the caller; its ended sessions are dropped, and the open ones stay so the worker updates them for the caller or ends them. |
| `PUT /api/me/live-activities/sessions` | `{deviceId, kind, subject, activityPushToken}`. Registers or rotates the iOS per-activity token after a local start, a remote start, or a token rotation. Re-registering a dismissed activity reopens it. |
| `DELETE /api/me/live-activities/sessions` | `{deviceId, kind, subject, phase?}`. The user swiped it away, or the app ended it locally. `phase` is the phase it showed; without it the server uses the last phase it sent, or records the next one it computes. |
| `GET /api/me/live-activities[?language=]` | `MyLiveActivities` for the caller. |

The access posture matches `POST /api/me/push-tokens`: any signed-in, active
account may manage its own devices, with no capability and no audit row,
because this is delivery plumbing. Every write is an idempotent upsert. The
`/api/me/live-activities` paths are excluded from SSE identity invalidation
and session invalidation, as push tokens are, to avoid refresh loops.

Subjects: `judging` for the queue (one per participant) and `activity:<id>`
for activities.

### Schema (migration `0604_live_activities.sql`)

- `live_activity_devices`: one row per install (`device_id` unique), with
  `user_id` (cascade), `platform`, `push_to_start_token`, `expo_push_token`,
  `language` and `enabled`.
- `live_activity_sessions`: one row per `(device, kind, subject)`, with
  `activity_push_token`, `state_hash`/`props` for the last state sent,
  `last_sent_at`, `started_at`, `ended_at`, `end_reason` and
  `dismissed_phase` (`finished` = the server ended it and may restart it;
  `dismissed` = restart remotely only once the phase differs from
  `dismissed_phase`).

Account removal deletes the devices together with `push_tokens`. The H54
export lists only device metadata (platform, language, opt-out, creation
date), never tokens.

## Worker state machine

`live-activities` runs every 20 s. A call (H29) also schedules a deduplicated
early run 2 s later, so the alerting "go to room" update does not wait for the
next repetition. Each tick does the following:

1. Loads enabled devices of active users, plus any device that still has an
   open session (to end it). Only *actionable* devices (with a start path or
   an open session) have their desired state computed. `myQueueStatus` runs
   only for their users, only while the window is open, and only after
   `hasMyQueueItems` succeeds.
2. For each device and desired `(kind, subject)`, takes one of these paths:

| Known session | Action |
| --- | --- |
| none, or `finished` | **start**, if a start path exists: iOS `push_to_start_token` (and APNs configured) or Android `expo_push_token` |
| open, state hash changed | **update**. Activity updates where only the counter changed are throttled to one per 30 s per session; queue changes and phase changes go out immediately. iOS waits until the app reports the activity's own token. |
| open, hash unchanged | nothing |
| `dismissed`, same phase as `dismissed_phase` | nothing (the user removed it) |
| `dismissed`, phase changed (e.g. waiting → called, upcoming → live) | **start** again: new, essential information |
| `dismissed`, no `dismissed_phase` yet | record the current phase, send nothing |

   An open queue session whose state has not changed for 15 minutes gets a
   routine (priority 5) refresh, so its 30-minute `stale-date` never greys
   out a participant who is still waiting.

3. Every open session that is no longer desired is **ended**. This happens
   when the window closes, the team is done, the activity ends, the
   capability is revoked, or the device is disabled. A `dismissed` session
   that is no longer desired on a device that can still receive starts is
   turned into `finished`: the dismissal covered that run, so a later one
   (for example the next queue the team waits in) starts again.

**Concurrency and idempotency:**

- A session-level `pg_try_advisory_lock` admits one tick at a time across
  worker replicas. An overlapping tick returns `skipped`.
- Each send is preceded by an atomic claim. Starts use
  `INSERT … ON CONFLICT (device_id, kind, subject) DO UPDATE … WHERE
  end_reason = 'finished' RETURNING`. Updates and ends use a conditional
  `UPDATE … RETURNING` keyed on the previous hash, or on `ended_at IS NULL`.
  A retried tick therefore never sends twice.
- No transaction stays open across a network call.

**Failures:**

- A transient failure reverts its claim, so the next tick retries. A failed
  restart of a `finished` or `dismissed` session restores that row,
  including its `dismissed_phase`, instead of deleting it.
- Without APNs configured, iOS sessions that have a per-activity token stay
  open rather than being marked ended without a push; once APNs is set, the
  worker ends or updates them.
- A dead token clears that token: APNs 410, `BadDeviceToken`, `ExpiredToken`
  or `Unregistered`, or Expo `DeviceNotRegistered`. A dead iOS
  *per-activity* token means the activity is gone from the device, so its
  session is marked `dismissed` in the phase the device last showed, not
  the phase of the update that failed. Otherwise an update to `called`
  rejected because the user had removed the waiting activity would record
  `called`, and the call would never bring it back.

## Push formats

### iOS (APNs)

- Token auth: an ES256 JWT (`kid` = `APNS_KEY_ID`, `iss` =
  `APPLE_TEAM_IDENTIFIER`, `iat`), signed with `node:crypto` and cached for
  50 minutes. The cache is dropped on `ExpiredProviderToken`.
- The gateway is `APPLE_APNS_ENVIRONMENT` (shared with Wallet).
- Headers: `apns-push-type: liveactivity`,
  `apns-topic: <APNS_BUNDLE_ID>.push-type.liveactivity`. `apns-priority` is
  10 for start, end, the call and phase changes, and 5 for routine updates
  (budget-friendly).
- One HTTP/2 session per tick. Each request has its own stream error listener
  and a 15 s timeout, mirroring `logistics/apple-push.ts`.

```json
{
  "aps": {
    "timestamp": 1791712800,
    "event": "start | update | end",
    "content-state": { "name": "QueueActivity", "props": "{…QueueLiveProps JSON…}" },
    "attributes-type": "LiveActivityAttributes",
    "attributes": { "url": "hackos://queue" },
    "alert": { "title": "Robotics", "body": "Position #4 · ~12 min" },
    "stale-date": 1791714600,
    "relevance-score": 50,
    "dismissal-date": 1791713700
  }
}
```

- `content-state` must match `expo-widgets`'
  `LiveActivityAttributes.ContentState { name: String, props: String? }`
  exactly. `name` is `LIVE_ACTIVITY_WIDGET_NAMES[kind]` (`QueueActivity`,
  `StaffActivity`), and `props` is the props JSON *string*.
- `attributes-type` and `attributes` are sent on `start` only.
  `LiveActivityAttributes` is the struct name in
  `expo-widgets/ios/Widgets/WidgetLiveActivity.swift`, and its only field is
  `url`.
- `alert` is required on `start`, or iOS silently drops the start. On updates
  it is sent only when the team is called. It carries no `sound`, because the
  non-optional `queue.called` push notification already rings.
- `stale-date`: now + 30 min for the queue, and the activity's end for staff
  activities.
- `relevance-score`: 100 when called or in a room, 50 while waiting, 75 for a
  live activity and 25 for an upcoming one.
- `attributes` is expo-widgets' `LiveActivityAttributes { url: String? }`:
  `hackos://queue` or `hackos://scan?activity=<id>`. It is the tap target, so
  it must be present on every remote start.
- `dismissal-date` (on `end` only): 15 minutes after the end.

### Android (Expo data push)

A data-only message (no title or body) with `priority: "high"`. The app's
background notification task receives it and renders it through
`modules/live-updates`:

```json
{ "hackosLiveUpdate": { "event": "start | update | end", "kind": "queue", "subject": "judging", "props": { … } } }
```

`props` is omitted on `end`.

## Design rationale (Apple HIG)

Followed: <https://developer.apple.com/design/human-interface-guidelines/live-activities>.

- **One Live Activity per kind.** The queue activity tracks the nearest queue
  and shows how many others are pending ("track multiple events efficiently
  with a single Live Activity").
- **Update only when content changes.** Updates are hash-gated, and counters
  are throttled.
- **Alert only for essential updates.** The only alert is the call.
- **End when the task ends**, with a custom dismissal of about 15 minutes.
- **Single interactive element at most** (staff **Scan**). Every tap
  deep-links to the related screen.

Queue (participant):

| Presentation | Content |
|---|---|
| Compact leading | position `#4` |
| Compact trailing | ETA `~12 min` (not a ticking timer — it is an estimate) |
| Minimal | ETA minutes (or room initial when called) |
| Expanded | challenge title, position, ETA; **room only once called** |
| Lock Screen | same as expanded, plus "+N more queues" when relevant |
| Called state | compact: `Room B` · expanded: "Go to Room B — location" (alerting update) |
| Watch / CarPlay | challenge + `#4 · ~12 min` / room when called |

Meal / activity (staff):

| Presentation | Upcoming | Live |
|---|---|---|
| Compact leading | category symbol (fork.knife / person.3) | same |
| Compact trailing | countdown timer to start | scanned count |
| Minimal | countdown | count |
| Expanded | name, location, `hh:mm–hh:mm`, countdown | name, location, time range, counter, **Scan** button |
| Lock Screen | as expanded | as expanded |

## Operational setup

### Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `APNS_KEY_ID` | unset | Key ID of the APNs auth key. Set together with `APNS_AUTH_KEY_P8`. |
| `APNS_AUTH_KEY_P8` | unset | **Secret.** `base64 < AuthKey_XXXX.p8`, a single line. |
| `APPLE_TEAM_IDENTIFIER` | unset | Shared with Wallet; required when `APNS_KEY_ID` is set. |
| `APPLE_APNS_ENVIRONMENT` | `production` | Shared with Wallet. TestFlight and App Store builds use `production`; `sandbox` is only for development-signed builds and must not be set on a host that also pushes Wallet passes. |
| `APNS_BUNDLE_ID` | `com.hackudc.os` | Development builds use `com.hackudc.os.debug`. |
| `LIVE_ACTIVITY_LEAD_MINUTES` | `15` | Minutes before a scannable activity starts that staff get its Live Activity (1–240). |

Without the key, the API boots normally. The read endpoint and Android
delivery work, and the worker logs one warning and skips iOS. A half-set pair
fails boot (`config.ts`) and `deploy/scripts/check-env.sh`. Compose passes
the variables to both `api` and `worker`; see [env-vars.md](./env-vars.md)
and `deploy/README.md`.

### Creating the APNs key (human action)

1. In Apple Developer, go to Certificates, Identifiers & Profiles → Keys →
   **+**. Enable **Apple Push Notifications service (APNs)** with environment
   *Sandbox & Production* and download `AuthKey_<KEYID>.p8` (it can be
   downloaded only once).
2. Set `APNS_KEY_ID=<KEYID>`, and `APNS_AUTH_KEY_P8=$(base64 < AuthKey_<KEYID>.p8 | tr -d '\n')`
   in the secrets file (`hackos.env` in production, `hackos.secrets` in
   staging). `APPLE_TEAM_IDENTIFIER` must be the key's team.
3. Recreate `api` and `worker` (`deploy/README.md` § Safely changing
   environment values).

### EAS credentials (human action)

- The App ID `com.hackudc.os` needs the Push Notifications capability. Live
  Activities need `NSSupportsLiveActivities` (set by the app config).
- The CNG-generated widget extension `com.hackudc.os.ExpoWidgetsTarget` needs
  its own App ID and provisioning profile. Run `eas credentials` and select
  the target, or let `eas build` create it.
- Both the app and the extension need the App Group `group.com.hackudc.os`
  (`expo-widgets` shares layouts and props through it). Register the group in
  the developer portal and enable it on both App IDs before building.
- The client side (registration calls, token observers, Android module) is
  documented in [mobile.md](./mobile.md).

## Tests

`apps/api/test/live-activities/`:

- `state.test.ts`: window gating, nearest-queue selection, room only when
  called, lead window, phases, distinct and fixture-isolated counts, and
  capability resolution.
- `worker.test.ts`: start once, idempotent re-run, update on change and the
  call alert, throttle, end and restart, dismissal kept until the phase
  changes,
  concurrent ticks giving one start, and token cleanup. It uses stubbed
  APNs/Expo transports.
- `apns.test.ts`: payload shape and JWT signing with a generated P-256 key.
- `routes.test.ts`: auth, upsert/reassign, validation, ownership, and
  dismissal.
