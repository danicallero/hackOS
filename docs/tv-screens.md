# TV screens (H41, H42)

How the venue's screens decide what to show, how organisers drive them, and
what each mode renders. Code lives in `apps/api/src/modules/queue/tv*.ts` and
`apps/web/src/app/(public)/tv/`; the control panel is
`apps/web/src/app/(app)/tv/control/`.

## The fleet is one broadcast

There is exactly one public route, `/tv`, and every screen in the venue shows
the same thing — that is the product decision, not a limitation to route
around. What changes over the event is *which* view is on it: the combined
live screen for most of the day or the judging rooms grid while judging runs.
Announcements are a content layer managed from **Programme → Announcements**:
they can reserve space inside the current view or temporarily occupy the full
screen without becoming a manually selectable TV mode.

## What's on screen: three layers

`GET /api/tv/mode` (public, no auth — the wall polls it) returns the resolved
state. `resolveTvState()` in `queue/tv.ts` picks the first that applies:

| Precedence | Layer | Where it lives | `source` |
| --- | --- | --- | --- |
| 1 | **Operator override** — a manual broadcast from `/tv/control` | Valkey `tv:mode` (ephemeral display state) | `"override"` |
| 2 | **Timetable slot** covering `now` | Postgres `tv_slots` (migration 0403) | `"slot"` |
| 3 | **Default** — the judging rooms grid | constant | `"default"` |

Slots may overlap; **the covering slot with the latest `starts_at` wins**, so a
short "opening ceremony" window naturally beats the all-day window it sits
inside. An override holds until it is cleared (`DELETE /api/tv/mode`, the
control page's *Back to schedule*) or until its optional `expiresAt` passes,
at which point the timetable takes back over — landing on whatever slot is
running *at that moment*, not on whatever was showing before.

The `tv-scheduler` worker (5 s tick, see
[background workers](./background-workers.md)) drops due overrides and
broadcasts `tv.mode.changed` when — and only when — the resolved state
actually changes, so slot boundaries reach the fleet with nobody at a keyboard
and a quiet tick doesn't wake every screen.

### Public realtime boundary

`/api/tv/stream` and `/api/content/stream` are deliberately invalidation-only
public streams. The former subscribes to the dedicated `public-tv` topic, which
is mirrored only from `queue` and `tv`; the latter subscribes to
`public-content`, mirrored only from `content`. Their `data.changed` envelope
is empty — no display, room, account, project, or source-event payload — so a
screen refetches the public `/api/tv/mode`, sanitized `/api/tv/rooms`, and
public content projections after it arrives without observing unrelated system
writes. The room projection includes only visible room/challenge/team-status
fields, never team-member identities, email, project links, or cross-room
operator diagnostics. Raw `tv.mode.changed` and queue events remain on
authenticated operational channels, so opening a venue screen cannot grant
judging access.

### Rotation inside a slot

A slot's `items` is an ordered list of `{ mode, payload, seconds }`. One entry
renders statically; several make the display cycle them on each entry's dwell.
Cycling is client-side (`useRotatedState` in `tv-display.tsx`) and is driven
off the **slot's own `startsAt`**, so screens switched on hours apart still
flip at the same instant, and rotation generates no SSE traffic.

## Modes

| Mode | Shows |
| --- | --- |
| `live` | The everyday screen: countdown + upcoming schedule + sponsor grid + Wi-Fi, each block individually toggleable |
| `rooms` | Per-room judging grid: presenting now, waiting room, next in queue (H41) |
| `schedule` | The same self-advancing upcoming-agenda component used by `live`, without countdown, sponsors or Wi-Fi |
| `sponsors` | Event name and sponsor logo wall, without a redundant “Sponsors” wordmark |
| `wifi` | Full-screen network name + password |

The former `announcement` and `timer` modes are normalised out of stored
timetable JSON by migration 0602. A legacy timer becomes `live`; a legacy
announcement item is removed, with `live` used when that would empty a slot.
The countdown remains available as a block of the `live` composition.

### Announcements on screens

An announcement independently chooses whether it sends user notifications and
how it appears on TVs: `none`, `embedded`, or `fullscreen`. Its
`publish_at`/`expires_at` window controls both public visibility and screen
presence; no expiry means it remains until deletion. If several eligible
announcements overlap, the newest visible announcement for each placement is
the deterministic winner.

- `fullscreen` occupies the TV frame above the current base mode, while the
  underlying override/timetable continues to resolve normally.
- `embedded` reserves layout space: below the reduced sponsor grid on `live`,
  as an announcement card in the room grid, and as a compact non-covering band
  on schedule, sponsors, and Wi-Fi views.

Deleting an announcement broadcasts a public-content invalidation so an
indefinite message disappears from already-open screens immediately.

### The live screen's payload

Both an override and a slot item carry the same shape, normalised by
`liveConfigFrom()` in `apps/web/src/lib/tv.ts` — every field falls back to its
default rather than disappearing, so a malformed payload never blanks a wall:

```ts
{
  timer:    { show, target, label, endsAt },  // target: auto | hackingStartsAt |
                                              // hackingEndsAt | judgingStartsAt |
                                              // judgingEndsAt | custom
  schedule: { show, upcoming },               // upcoming = rows the block is tall
  sponsors: { show },
  wifi:     { show, showPassword, showQr },
}
```

`target: "auto"` defers to the shared hacking/judging phase logic in
`components/public/timer.tsx` (the same countdown the public site runs). A
target whose date isn't configured falls back to that phase logic too, rather
than freezing on `--:--:--`.

The schedule block parks itself on the first activity that hasn't finished —
whatever is running stays visible, past entries dim and scroll away — and stops
scrolling once the last page would show blank rows (`upcomingWindow()`, unit
tested in `apps/web/src/lib/tv.test.ts`).

## Venue Wi-Fi

Credentials live in `event_config` (`wifi_ssid`, `wifi_password`,
migration 0008), edited in **Settings → Event → Venue** behind
`SCHEDULE_MANAGE`. `GET /api/tv/config` serves them to the screens; both the
`live` screen and the full-screen `wifi` mode read from there, so a *scheduled*
Wi-Fi slot works with nobody at the control page.

They are **not** on `/api/public/event` — that feed backs the public website.
`/api/tv/config` is public like the rest of the TV feed: this is a password
printed on the venue wall, and the screens showing it are unauthenticated
kiosks. An audit entry records that the password changed, never its value.

The TV control page never edits or overrides those credentials. Both the live
block and full-screen Wi-Fi mode always read the event configuration, keeping a
single source of truth for the network shown across the venue.

Both surfaces render a **join QR** (`WifiQr`, `wifiJoinCode()`): the standard
`WIFI:T:…;S:…;P:…;;` payload a phone camera joins from, so nobody types a
password off a wall. It is generated locally with `qrcode.react` — a venue
screen may have no uplink (the Wi-Fi it is advertising is often exactly what
isn't working yet), and the password must not travel to a QR service to be
turned into pixels. Security type is inferred: password present → `WPA`,
absent → `nopass`. The QR only renders from stored venue config, never from a
half-typed operator payload that would fail to connect anyone.

## Adapting to the screen

Nobody can scroll, zoom, or squint at a TV, and the same page has to work on a
1080p panel, a 4K wall and a portrait totem. Two mechanisms, deliberately:

- **`TvScreen`** (`tv-screen.tsx`) — the frame for every mode, with one shared
  `TvHeader`. The rooms grid selects the compact header and keeps its specialised
  fitting strategy below that universal chrome.
  It is exactly one screen tall (`h-dvh`, never scrolls) and sets a root font
  size from `useTvScale()` (see the short-side rule below). Views
  size themselves in **`em`** (`text-[2em]`, `p-[1.5em]`), never in Tailwind's
  rem steps, which would stay pinned to the browser root and ignore the screen.
  It also reports `portrait` so views can stack instead of squeezing.
- **`useFitToViewport`** — kept by the `rooms` grid only. It scales with a
  transform and pre-widens to avoid horizontal letterboxing, which is safe
  there because every label in those cards is single-line `MarqueeText`; on
  wrapping text a transform feeds back into layout width. It also needs the
  measured width to choose a column count.

Scaling is off the **short side** (`min(width, height) / 1080`): a portrait
totem then matches a 1080p panel instead of rendering at 0.56x, which is what
`min(w/1920, h/1080)` would give it.

Text that overflows uses `MarqueeText` (`marquee-text.tsx`) rather than an
ellipsis — on a kiosk nobody can reveal the rest. Every marquee on the page
moves on one shared clock.

Blocks that can't be sized by text alone measure their own box and decide:
the agenda splits its height into rows (bounded, so a tall screen doesn't turn
six activities into six islands), and the sponsor grid takes the fewest columns
whose logo-shaped tiles still fit — fewest columns meaning biggest logos, never
fewer than two (`bestSponsorColumns`).

## Control panel

`/tv/control` (capability `TV_CONTROL`) has three parts:

1. **Current broadcast** — live preview, SSE connection state, and *why* the
   screens show what they show (override / timetable slot / default), with
   **Back to schedule** when an override is live.
2. **Display mode** — the manual broadcast for live, rooms, schedule, sponsors,
   and Wi-Fi. Wi-Fi has no credential editor; it reads event configuration.
   Announcements and standalone countdowns are not selectable modes.
3. **Screen timetable** — slot CRUD. Slot mutations are audited (H53) and
   broadcast `tv.schedule.changed`; editing the running slot changes the wall
   immediately rather than at the next tick.

## Related

- Events: `TV_MODE_CHANGED`, `TV_SCHEDULE_CHANGED` in
  `packages/shared/src/events.ts`, both on the `tv` SSE topic.
- [Design rulebook](./DESIGN.md) — TV surface rules.
- [Event config & Wallet pass](./event-config-wallet.md) — the `event_config`
  singleton the Wi-Fi fields join.
