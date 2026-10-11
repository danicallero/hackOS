# Live Activities and Live Updates (#966)

System-level, glanceable surfaces for the time-bound moments of the event.
Organizers turn each kind on or off, rank them and choose the roles that
receive them ([Configuration](#configuration)):

- **Participant queue (H38)**: during the judging window only, the
  participant's *nearest* queue, with position and ETA, then the room once the
  team is called (H29).
- **Staff meal or activity (H25, H26)**: for holders of `activity:scan`, from
  `LIVE_ACTIVITY_LEAD_MINUTES` before a scannable activity starts until it
  ends, a countdown and then `scanned/accredited` with one **Scan**
  action that opens the scanner already bound to that activity.
- **Attendee activity (H59)**: for a schedule item organizers opted in
  (`liveActivityAudience`), its audience gets a countdown from
  `LIVE_ACTIVITY_LEAD_MINUTES` before the start, then "Now · ends in". No
  buttons.
- **Submission deadline (H19, H20)**: for participants, from
  `LIVE_ACTIVITY_DEADLINE_LEAD_MINUTES` before submissions close, a countdown
  with the team's hackOS submission status.
- **Accreditation desk (H22, H24)**: for `accredit:scan` holders, around the
  arrival rush, accredited/eligible, people inside and arrivals in the last
  10 minutes, with one **Scan** action.

On iOS these are ActivityKit Live Activities (Dynamic Island, Lock Screen,
Apple Watch Smart Stack, CarPlay), rendered by `expo-widgets`. On Android they
are promoted ongoing notifications (Live Updates on Android 16, plain ongoing
notifications before that), rendered by the local `modules/live-updates`
module. Home-screen widgets are out of scope. This page covers the API side;
the client side is in [mobile.md](./mobile.md).

## Architecture

```
   candidates.ts (gates, ranking, per-device cut) ← state.ts, kinds.ts (builders)
           /                         \
GET /api/me/live-activities      worker.ts (every 20 s)
(app in foreground: starts         ├─ iOS: apns.ts → APNs HTTP/2, token auth
 and updates locally)              └─ Android: android.ts → Expo data push
```

| File (`apps/api/src/modules/live-activities/`) | Role |
| --- | --- |
| `state.ts` | Builds `QueueLiveProps` and `ActivityLiveProps` (`@hackos/shared/live-activities`), the judging window and the state hash. |
| `kinds.ts` | Loaders and builders for `AttendeeActivityLiveProps`, `DeadlineLiveProps` and `AccreditationLiveProps`. Each loader reads its data set once for every candidate user. |
| `candidates.ts` | `loadLiveActivityContext` (every data set once per tick or request), `candidatesFor` (kind configuration, roles and intrinsic gates, in priority order), `selectForDevice` (the `maxConcurrent` cut) and the read model. Both the read endpoint and the worker call it, so a local refresh and a remote push never disagree. |
| `settings.ts` | Organizer configuration: read, save (audited) and each kind's required capability. |
| `routes.ts`, `schemas.ts` | Device/session registry, the read model and the configuration routes. |
| `apns.ts` | ES256 provider token, the `aps` payload, and the HTTP/2 transport. |
| `android.ts` | Data-only Expo push through `postExpoPushMessages` (shared with the notification push channel). |
| `worker.ts` | The `live-activities` repeatable job: desired state against known sessions, then start, update or end. |
| `kick.ts` | `requestLiveActivitySync`: the debounced early tick that domain modules request ([Latency](#latency)). |
| `foreground.ts` | The short window in which an iOS app starts its own activities, so the worker does not push-start duplicates. |

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
- `accredited` (live only, H24/H25): the denominator of `scanned`, active
  accounts with a badge, the desk's `accredited` (`loadAccreditationCounts`,
  read once per tick and shared with the desk): the people the operator's
  people finder lists with a badge (`scannerSubjectScope`).
  Upcoming activities get `null`; they show the countdown. **Decision:** this
  replaced the meal-only `inside`/`remaining` presence breakdown, so every
  live activity shows one ratio against one denominator; app builds that
  still read those fields fall back to the bare count.
- `name`: `name_i18n[language]`, then `name_i18n.en`, then `name`.
- `url` and `scanUrl`: both `hackos://scan?activity=<id>`. A tap and the Scan
  button both open the scanner bound to that activity. iOS keeps the tap URL
  in the static `attributes.url`.

### Attendee activity (H59)

- Items: `schedule.live_activity_audience = true`, live for their audience
  with the same rule as the audience-aware schedule feed (`visibility =
  'shown'`, `publish_at` unset or past, at least one audience tag), starting
  within `LIVE_ACTIVITY_LEAD_MINUTES` or still running. `phase` is `upcoming`
  before `starts_at` and `live` until `ends_at`, when it ends.
- Audience: `attendeeScheduleAudiencesForUsers` (logistics/schedule.ts), the
  bulk form of `callerScheduleAudiences`. Everyone has `participant`; a
  linked sponsor rep adds `sponsor`; a user whose displayed role is Mentor
  adds `mentor`. **Decision:** the staff override of the schedule feed (any
  capability holder sees every item) is not applied, because it exists so
  staff can run the show. Since `participant` is universal, staff still get
  participant items unless organizers untick their roles for this kind.
- Opt-in is edited with the item: `liveActivityAudience` on `POST
  /api/schedule` (default false), `PATCH /api/schedule/:id` and `GET
  /api/schedule`. **Decision:** the flag lives on `schedule`, beside
  `audiences`, not on the mirrored `activities` row.
- `name`: `title_i18n[language]`, then `title_i18n.en`, then `title`.
- `url`: `hackos://schedule/<id>`.

### Submission deadline (H19, H20)

- **Decision:** submissions close at `event_config.hacking_ends_at`. That is
  the instant `projects/lifecycle.ts` enforces ("The submission deadline has
  passed"), Devpost imports lock at and the reconciliation overview calls
  `deadline`. The participant self-service window only bounds editing.
- Window: from `LIVE_ACTIVITY_DEADLINE_LEAD_MINUTES` (default 180) before the
  deadline until it passes. `startsAt` is `hacking_starts_at` (for a
  progress bar), or null.
- Who: holders of `queue:status` (the participant capability; `*` passes)
  with event access (`user_event_access`).
- `submission`: every project or work group the user is an active member of
  (the three membership sources of `isActiveProjectMember`, H54 boundary
  included). `submitted` only when all are submitted, `draft` when one is
  not (an unlinked work group counts as draft), and `null` when the user has
  none in hackOS, for example a Devpost team that is not imported yet. A
  `null` status is unknown and is never shown as "not submitted".
- `phase`: `submitted`; `closing` in the last 15 minutes
  (`DEADLINE_CLOSING_MINUTES`) for a known draft; otherwise `open`.
- **Alert policy:** one alerting update, when a known draft enters
  `closing`. A `null` status never alerts.
- `url`: `hackos://project` (proposed; the app has no project screen yet).

### Accreditation desk (H22, H24, H27)

- **Decision:** `event_config` has no check-in window, so the desk's window
  is derived. It opens `LIVE_ACTIVITY_ACCREDITATION_LEAD_MINUTES` (default 60)
  before `event_starts_at` (else `hacking_starts_at`) and closes
  `LIVE_ACTIVITY_ACCREDITATION_TAIL_MINUTES` (default 60) after
  `hacking_starts_at` (else the event start). Outside it, staff are not
  interrupted all event long.
- Who: holders of `accredit:scan` (or `*`).
- Counts follow the scanner home tile (`scannerRoleStats`): `eligible` is
  active accounts with event access, and `accredited` is active accounts
  with a badge. `recentArrivals` is badges assigned in the last 10 minutes.
  These cover the operator's scanner roster (`scannerSubjectScope`, the
  people finder's population): every real account for a real operator, only
  the synthetic participant fixtures for a synthetic one (H54). `inside` is the presence
  estimate (`occupancyEstimate`, real accounts only, read once per tick);
  synthetic operators get `null`.
- Single phase `live`. Counter updates are throttled like activity counters.
- `url` and `scanUrl`: `hackos://scan`.

### Preferences

Organizers decide which kinds exist and for which roles
([Configuration](#configuration)).

**Decision:** queue calls are already non-optional operational notices (H51),
and the Live Activity mirrors the queue screen rather than adding a new
notification category. The opt-out is therefore the device's `enabled` flag
(`PUT /api/me/live-activities/device`) rather than an H51 preference row. A
dismissed activity stays away until its phase changes (see the state machine)
or the person opens the app, which brings back everything still relevant
(`POST …/dismissals/reopen`).

## Configuration

Organizers configure the kinds in event settings (`event:manage`, the
capability that owns event identity and timing):

| Route | Purpose |
| --- | --- |
| `GET /api/live-activities/settings` | `LiveActivitySettings`: `maxConcurrent`, `kinds` sorted by priority, and `roles` (every non-deleted role, highest position first, raw name as `GET /api/roles` returns it) so the editor needs no roles-manager permission. |
| `PUT /api/live-activities/settings` | `{ maxConcurrent: 1–5, kinds: [{ kind, enabled, roleIds }] }`. `kinds` lists every kind exactly once and its **array order is the priority** (first = 0 = highest). Unknown or deleted role ids are a 400. Audited (`live_activity_settings`, H53) in the same transaction; `Idempotency-Key` replays. |

Kinds (`LIVE_ACTIVITY_CONFIG_KINDS`) and the gate each keeps on top of its
role list (`requiredCapability` in the response):

| Kind | Who | Intrinsic gate |
| --- | --- | --- |
| `activity` | staff at a meal or scannable activity | `activity:scan` |
| `attendee_activity` | the audience of an opted-in schedule item | schedule audience (data) |
| `queue` | participants in a judging queue | a live queue entry (data) |
| `accreditation` | the check-in desk | `accredit:scan` |
| `deadline` | participants before submissions close | `queue:status` + event access |

A user receives a kind only when it is **enabled**, they hold **at least one
of its roles** (a non-deleted role from `live_activity_kind_roles`), and the
intrinsic gate still holds. An empty role list means nobody receives it.
**Decision (H8):** roles here select an *audience*; they never grant
anything — the capability or data gate always applies as well.

Storage (migration `0604_live_activities.sql`): the singleton
`live_activity_settings.max_concurrent` (default 2),
`live_activity_kind_settings (kind, enabled, priority)` with a deferred
unique priority, and `live_activity_kind_roles (kind, role_id)` (cascade on a
hard role delete; a soft-deleted role is ignored when reading). The migration
seeds every kind enabled in the order `activity`, `attendee_activity`,
`queue`, `accreditation`, `deadline` (the product owner ranks
meals and activities above the submission countdown). Role lists are seeded
from the roles that explicitly allow the kind's capability (`activity`,
`accreditation`, `deadline`), or from every role with event access for the
data-gated kinds. **Roles created
later are not added to any kind automatically**; organizers tick them in the
editor. A missing kind row reads as disabled with no roles (fail closed).

**Admin UI.** Event settings → Live Activities (`/settings/event?tab=liveActivities`,
`apps/web/src/app/(app)/settings/event/live-activities-tab.tsx`) follows the
roles manager's list/editor layout (drill-down below `md`). The list is the
priority order: reorder by drag handle (pointer or keyboard) or the editor's
move up/down buttons; each row has its on/off switch and a plain-text role
summary. The editor shows the kind's description, the read-only
`requiredCapability` and role checkboxes from the response's `roles`. The
shown-at-once limit and every kind share one draft and the category's single
Save footer and unsaved-changes guard, sent as one `PUT`. Per schedule item,
the item editor's "Show Live Activity to audience" switch (only for items with
an audience) sets `liveActivityAudience`.

### Ranking and the per-device limit

A user's candidates are ranked by kind priority, then by each kind's own
order: earliest activity or schedule item first. Each
device keeps at most `maxConcurrent` of them:

- **Hysteresis:** within a kind, a subject already open on the device
  sorts before a new one, so two activities of the same kind never swap
  back and forth. A candidate of a **higher-priority kind** displaces a
  running lower one. The displaced one is ended (`finished`) and starts again
  when a slot frees.
- A candidate the user dismissed in its current phase takes no slot. It
  stays desired, so its dismissal is kept until the phase changes or the app
  is opened.
- `rank` (0 = most important) goes into every props object and the Android
  message (`hackosLiveUpdate.rank`, for the notification sort key). iOS gets
  `relevance-score = 100 − 10 × rank` (`relevanceForRank`,
  `@hackos/shared/live-activities`), so the Dynamic Island shows the top
  one. A rank change is a visible change, so it is pushed.
- **The app must send the same score.** ActivityKit's `relevanceScore`
  belongs to the activity's *content*, and every update, remote or local,
  replaces the whole content; an update without a score sets it to 0, and
  ActivityKit shows the first-started of equal-score activities. Without a
  score, the app's own starts and updates (every foreground reconcile, through
  `expo-widgets`, which had no relevance parameter) reset the score to 0, so
  the oldest activity led the island whatever the Settings order; the
  server's hash was already current and never re-sent it. The app now passes
  `relevanceForRank(rank)` on each local start and update (a pnpm patch of
  `expo-widgets` adds the argument; see [mobile.md](./mobile.md)).
- **Platform limits.** The order applies among this app's activities. Which
  app's activity the Dynamic Island shows when several apps have one is the
  system's choice. On Android the sort key orders the app's own
  notifications only while their priorities match, so an alerting post may
  sort first regardless of rank.
- `GET /api/me/live-activities?deviceId=` applies the same cut with that
  device's sessions. Without `deviceId`, it treats the device as showing
  nothing yet.

**Product note:** with the default order, a participant with two opted-in
schedule items running gets no queue activity when `maxConcurrent` is 2.
Organizers can rank `queue` higher.

## Registry

| Route | Purpose |
| --- | --- |
| `PUT /api/me/live-activities/device` | Upsert this install: `deviceId`, `platform`, `pushToStartToken` (iOS 17.2+), `expoPushToken` (Android), `language`, `enabled`. Omitted fields keep their value; `null` clears it. A token belongs to one device: registering it clears it from any other row (a reinstall). A `deviceId` registered by another account moves to the caller; its ended sessions are dropped, and the open ones stay so the worker updates them for the caller or ends them. |
| `PUT /api/me/live-activities/sessions` | `{deviceId, kind, subject, activityPushToken}`. Registers a running activity right after a local start (token omitted until iOS has one) and the iOS per-activity token after a local start, a remote start, or a token rotation. Re-registering a dismissed activity reopens it. |
| `DELETE /api/me/live-activities/sessions` | `{deviceId, kind, subject, phase?}`. The user swiped it away, or the app ended it locally. `phase` is the phase it showed; without it the server uses the last phase it sent, or records the next one it computes. |
| `POST /api/me/live-activities/dismissals/reopen` | `{deviceId}`, sent by the app on launch and foreground. Every `dismissed` session of the device becomes `finished` (startable); returns `{status, reopened}`. Idempotent. Background pushes never do this. |
| `GET /api/me/live-activities[?language=][&deviceId=]` | `MyLiveActivities` for the caller. With `deviceId`, also opens the device's 30 s foreground window (below). |

The access posture matches `POST /api/me/push-tokens`: any signed-in, active
account may manage its own devices, with no capability and no audit row,
because this is delivery plumbing. Every write is an idempotent upsert. The
`/api/me/live-activities` paths are excluded from SSE identity invalidation
and session invalidation, as push tokens are, to avoid refresh loops.

Subjects: `judging` for the queue (one per participant), `activity:<id>`
for staff activities, `schedule:<id>` for attendee activities, `deadline`
and `accreditation`. The session routes reject a
subject that does not match its kind.

Deep links (the app maps them; the ones marked *proposed* need a screen or a
route mapping in `apps/mobile`):

| Kind | Tap | Action |
| --- | --- | --- |
| `queue` | `hackos://queue` | — |
| `activity` | `hackos://scan?activity=<id>` | Scan: same URL |
| `attendee_activity` | `hackos://schedule/<scheduleId>` (`app/schedule/[id].tsx`) | — |
| `deadline` | `hackos://project` (*proposed*) | — |
| `accreditation` | `hackos://scan` | Scan: same URL |

### Schema (migration `0604_live_activities.sql`)

- `live_activity_devices`: one row per install (`device_id` unique), with
  `user_id` (cascade), `platform`, `push_to_start_token`, `expo_push_token`,
  `language` and `enabled`.
- `live_activity_sessions`: one row per `(device, kind, subject)` (kind one
  of `queue`, `activity`, `attendee_activity`, `deadline`,
  `accreditation`), with
  `activity_push_token`, `state_hash`/`props` for the last state sent,
  `last_sent_at`, `started_at`, `ended_at`, `end_reason` and
  `dismissed_phase` (`finished` = the server ended it and may restart it;
  `dismissed` = restart remotely only once the phase differs from
  `dismissed_phase`).

Account removal deletes the devices together with `push_tokens`. The H54
export lists only device metadata (platform, language, opt-out, creation
date), never tokens.

## Worker state machine

`live-activities` runs every 20 s, plus debounced early runs ([Latency](#latency)).
Each tick does the following:

1. Loads enabled devices of active users, plus any device that still has an
   open session (to end it). Only *actionable* devices (with a start path or
   an open session) have their desired state computed. `myQueueStatus` runs
   only for their users, only while the window is open, and only after
   `hasMyQueueItems` succeeds.
2. For each device and desired `(kind, subject)`, takes one of these paths:

| Known session | Action |
| --- | --- |
| none, or `finished` | **start**, if a start path exists: iOS `push_to_start_token` (and APNs configured) or Android `expo_push_token`. Not on an iOS device inside its foreground window: the app starts it and registers it. |
| open, state hash changed | **update**. Same-phase changes of staff and attendee activities, the deadline and the accreditation desk are throttled to one per 30 s per session; queue changes and every phase change go out immediately. iOS waits until the app reports the activity's own token. |
| open, hash unchanged | nothing |
| `dismissed`, same phase as `dismissed_phase` | nothing (the user removed it) |
| `dismissed`, phase changed (e.g. waiting → called, upcoming → live) | **start** again: new, essential information |
| `dismissed`, no `dismissed_phase` yet | record the current phase, send nothing |

   An open queue session whose state has not changed for 15 minutes gets
   a routine (priority 5) refresh, so its 30-minute `stale-date` never
   greys out a team that is still waiting.

3. Every open session that is no longer desired is **ended**. This happens
   when the window closes, the team is done, the activity ends, the
   capability or role is revoked, the kind is disabled, a higher-priority
   kind outranks it, or the device is disabled. An iOS session without a
   per-activity token is the exception: only that token can end the
   activity, so the session stays open until the app reports it (the next
   tick then ends it) or ActivityKit's 12-hour lifetime has passed. Keeping
   it open also means a returning subject is updated rather than
   push-started a second time. A `dismissed` session
   that is no longer desired on a device that can still receive starts is
   turned into `finished`: the dismissal covered that run, so a later one
   (for example the next queue the team waits in) starts again.

### Latency

How long a change takes to reach a device:

| Step | Delay |
| --- | --- |
| Domain change → tick | ≤ 2 s after a queue change (transition, call, deletion, topology: `notifyChallengeQueueChanged`), a judging-window edit (`PATCH /api/queue/settings`), a schedule edit (`emitScheduleChanged`) or a configuration save. Anything else (scan counters, event dates) waits for the 20 s repetition. |
| Throttle | Same-phase counter updates of staff and attendee activities, the deadline and the desk: one per 30 s per session. Queue changes and phase changes are not throttled. |
| Push | APNs priority 10 for start, end, the call and phase changes; 5 for routine updates, which iOS may delay. Expo data pushes are `high`. |
| iOS update or end | Needs the activity's own token, which only the app can report. A push-started activity's token reaches the server when the app next runs its reconcile (launch or foreground); until then the server cannot update or end it. |
| App | Reconciles on launch, foreground, the personal queue events and phase boundaries, so an open app shows the change within about a second of its SSE event. |

`requestLiveActivitySync` (`kick.ts`) adds one `kick` job delayed 2 s with a
BullMQ deduplication window of the same length: requests inside the window
join the pending tick, a later one schedules the next, so a change made while
a tick runs is not lost. A kick that finds another replica's tick holding the
lock schedules itself again. Kicks are global (every device is recomputed),
which is why per-scan counters do not kick: they are throttled to 30 s anyway.

**Foreground window.** `GET /api/me/live-activities?deviceId=` marks the iOS
device in Valkey for 30 s (`live-activities:foreground:<id>`). The app starts
what that read returns and registers it at once (`PUT …/sessions` without a
token), so during the window the worker sends no push-to-start to that
device. Without it, a push-to-start racing the app's local start leaves two
activities of one subject, and the one whose token the server never learns
stays on the device.

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
  `StaffActivity`, `AttendeeActivity`, `DeadlineActivity`,
  `AccreditationActivity`), and `props` is the props JSON *string*.
- `attributes-type` and `attributes` are sent on `start` only.
  `LiveActivityAttributes` is the struct name in
  `expo-widgets/ios/Widgets/WidgetLiveActivity.swift`, and its only field is
  `url`.
- `alert` is required on `start`, or iOS silently drops the start. On updates
  it is sent only when the team is called (queue) or a known draft enters the
  last 15 minutes (deadline). It carries no `sound`, because the
  non-optional `queue.called` push notification already rings.
- `stale-date`: now + 30 min for the queue, which has no end instant. Otherwise the item's own end: the activity or schedule item end,
  the deadline, or the accreditation window end.
- `relevance-score`: `100 − 10 × rank` (see
  [Ranking](#ranking-and-the-per-device-limit)).
- `attributes` is expo-widgets' `LiveActivityAttributes { url: String? }`,
  the props `url` (see the deep link table). It is the tap target, so it must
  be present on every remote start.
- `dismissal-date` (on `end` only): 15 minutes after the end.

### Android (Expo data push)

A data-only message (no title or body) with `priority: "high"`. The app's
background notification task receives it and renders it through
`modules/live-updates`:

```json
{ "hackosLiveUpdate": { "event": "start | update | end", "kind": "queue", "subject": "judging", "rank": 0, "props": { … } } }
```

`props` and `rank` are omitted on `end`.

### Push-triggered refresh (app side)

A notification push can reach the phone before the Live Activity update for
the same change: the worker's early run follows a call by 2 s, and iOS can
only update a push-started activity after the app has reported its token.
The app therefore re-reads `GET /api/me/live-activities` when a queue or
schedule notification (`isLiveActivityPushCategory`: `queue`,
`schedule:<id>`) arrives:

- Foreground (received) and tap (response): a reconcile, debounced with the
  SSE events that the same change publishes.
- iOS background: the notification channel sends those pushes with
  `_contentAvailable: true` (Expo's `content-available`; ignored on Android),
  which wakes a backgrounded app; its notification task runs the same
  reconcile. The alert is unchanged, so this costs no extra push. iOS does not
  wake a force-quit app and throttles background wakes; a backgrounded app can
  update or end an activity but not start one. Those cases rely on APNs alone
  until the next foreground reconcile.

The refresh does not fight a newer APNs update: the notification is sent
after the change it announces is committed, so the read returns at least that
state; reads are applied in order (an older response never overwrites a
newer one); and identical props cause no update.

## Design rationale (Apple HIG)

Followed: <https://developer.apple.com/design/human-interface-guidelines/live-activities>.

- **One Live Activity per kind.** The queue activity tracks the nearest queue
  and shows how many others are pending ("track multiple events efficiently
  with a single Live Activity").
- **Update only when content changes.** Updates are hash-gated, and counters
  are throttled.
- **Alert only for essential updates.** The only alerting updates are the
  call and an unsubmitted team's final 15 minutes.
- **End when the task ends**, with a custom dismissal of about 15 minutes.
- **Single interactive element at most** (staff and desk **Scan**, with a
  radio-waves symbol for the NFC badge: `wave.3.right` on iOS). Every tap
  deep-links to the related screen.
- **Live timers tick on the device.** Countdowns and the pitch timer travel
  as instants, never as per-second pushes.
- **Few at once.** A device shows at most `maxConcurrent` (default 2), the
  most important leading the Dynamic Island.

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
| Compact trailing | countdown timer to start | `scanned/accredited`, e.g. `42/180` (monospaced; the bare count without `accredited`) |
| Minimal | countdown | progress ring `scanned / accredited` (the count without `accredited`) |
| Expanded | name, location, `hh:mm–hh:mm`, countdown | symbol, Scanned `42/180`, scanned-share bar, name, ends in, **Scan** button |
| Lock Screen | as expanded | as expanded |

Attendee activity:

| Presentation | Upcoming | Live |
|---|---|---|
| Compact leading | category symbol | same |
| Compact trailing | countdown timer to start | countdown to end |
| Minimal | countdown | countdown |
| Expanded | name, location, `hh:mm–hh:mm`, "Starts in" timer | name, location, "Now · ends in" timer |
| Lock Screen | as expanded | as expanded, with a progress bar from `startsAt` to `endsAt` |
| Watch / CarPlay | name + countdown | name + "Now" |

Submission deadline:

| Presentation | Open | Closing | Submitted |
|---|---|---|---|
| Compact leading | `hourglass` | `exclamationmark.circle` (tinted) | `checkmark.circle` |
| Compact trailing | countdown timer | countdown timer | countdown timer (muted) |
| Minimal | countdown | countdown (tinted) | checkmark |
| Expanded | title, countdown, project name; status only when known | "Not submitted · project", countdown | "Submitted ✓ · project", countdown |
| Lock Screen | as expanded, with a progress bar from `startsAt` to `endsAt` | as expanded | as expanded |
| Watch | countdown | countdown + "Not submitted" | "Submitted" |

Accreditation desk:

| Presentation | Content |
|---|---|
| Compact leading | `person.badge.key` |
| Compact trailing | `accredited` |
| Minimal | progress ring `accredited / eligible` |
| Expanded | `accredited / eligible` with a ring, `inside`, arrivals in the last 10 min, **Scan** |
| Lock Screen | as expanded |
| Watch | `accredited / eligible` |

## Operational setup

### Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `APNS_KEY_ID` | unset | Key ID of the APNs auth key. Set together with `APNS_AUTH_KEY_P8`. |
| `APNS_AUTH_KEY_P8` | unset | **Secret.** `base64 < AuthKey_XXXX.p8`, a single line. |
| `APPLE_TEAM_IDENTIFIER` | unset | Shared with Wallet; required when `APNS_KEY_ID` is set. |
| `APPLE_APNS_ENVIRONMENT` | `production` | Shared with Wallet. TestFlight and App Store builds use `production`; `sandbox` is only for development-signed builds and must not be set on a host that also pushes Wallet passes. |
| `APNS_BUNDLE_ID` | `com.hackudc.os` | Development builds use `com.hackudc.os.debug`. |
| `LIVE_ACTIVITY_LEAD_MINUTES` | `15` | Minutes before a scannable activity (staff) or an opted-in schedule item (attendees) starts that its Live Activity appears (1–240). |
| `LIVE_ACTIVITY_DEADLINE_LEAD_MINUTES` | `180` | Minutes before submissions close (`hacking_ends_at`) that participants get the deadline countdown (15–1440). |
| `LIVE_ACTIVITY_ACCREDITATION_LEAD_MINUTES` | `60` | Minutes before the event start that the accreditation desk activity opens (0–1440). |
| `LIVE_ACTIVITY_ACCREDITATION_TAIL_MINUTES` | `60` | Minutes after hacking starts that the accreditation desk activity stays open (0–1440). |

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
  APNs/Expo transports. Also: deleted queue entries end the queue activity
  on both platforms, a token-less iOS session stays open until its token
  arrives (and closes after ActivityKit's lifetime), and no push-to-start
  during the foreground window.
- `kick.test.ts`: a burst of early-tick requests becomes one delayed job, and
  queue changes, schedule edits and configuration saves request it.
- `apns.test.ts`: payload shape and JWT signing with a generated P-256 key.
- `routes.test.ts`: auth, upsert/reassign, validation, ownership,
  dismissal, reopening dismissals, the full GET shape and the per-device cut
  with `deviceId`.
- `kinds.test.ts`: configuration gates (disabled kind, missing role, deleted
  role, capability still required), priority and `maxConcurrent`, and each
  new kind's state, gates and H54 isolation.
- `settings.test.ts`: configuration routes (access, validation, priorities,
  audit, idempotent replay).
- `test/notifications/push.test.ts`: queue and schedule pushes are
  `content-available`; others are not.
- `worker.test.ts` also covers start, update and end per new kind, the
  deadline alert, throttled desk counters,
  displacement by a higher-priority kind without flapping, and ending a
  disabled kind.

Tests run with `allowLiveActivities()` (fixtures.ts), because `truncateAll`
wipes 0604's seeded configuration and roles.
