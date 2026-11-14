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

## What's on screen now

`GET /api/tv/mode` (public, no auth — the wall polls it) returns the resolved
state. `resolveTvState()` in `queue/tv.ts` uses the operator's current
selection when there is one, and otherwise returns the rooms view:

| State | Where it lives | `source` |
| --- | --- | --- |
| **Manual selection** — a mode chosen from `/tv/control` | Valkey `tv:mode` (ephemeral display state) | `"manual"` |
| **Default** — the judging rooms grid | constant | `"default"` |

A selection stays visible until somebody selects another mode or resets it
with `DELETE /api/tv/mode`. Resetting returns every screen to rooms. There is
no TV timetable, rotation, or scheduler.

### Public realtime boundary

`/api/tv/stream` and `/api/content/stream` are deliberately invalidation-only
public streams. The TV screen uses only `/api/tv/stream`: its dedicated
`public-tv` topic mirrors `queue`, `tv`, and public `content` changes. The
separate `public-content` topic remains available to content-only consumers
and is mirrored from `content` and explicit public sponsor/challenge changes.
Their `data.changed` envelope is empty — no display, room, account, project,
or source-event payload — so a screen refetches the public
`/api/tv/mode`, sanitized `/api/tv/rooms`, and public content projections after
it arrives without observing unrelated system writes. The room projection includes only
visible room/challenge/team-status fields, never team-member identities, email,
project links, or cross-room operator diagnostics. Raw `tv.mode.changed` and
queue events remain on authenticated operational channels, so opening a venue
screen cannot grant judging access.

## Modes

| Mode | Shows |
| --- | --- |
| `live` | The everyday screen: countdown + upcoming schedule + sponsor grid + Wi-Fi, each block individually toggleable |
| `rooms` | Per-room judging grid: presenting now, waiting room, next in queue (H41) |
| `schedule` | The same self-advancing upcoming-agenda component used by `live`, without countdown, sponsors or Wi-Fi |
| `sponsors` | Event name and sponsor logo wall, without a redundant “Sponsors” wordmark |
| `wifi` | Full-screen network name + password |
| `github` | Top committers and pull-request authors, per person and per project team, from `GET /api/tv/github` (polled every 15 s); see [GitHub activity](./github-activity.md) |
| `connections` | Networking graph of attendees and companies from `GET /api/tv/connections` (#934, #935); see [Connections graph view](#connections-graph-view) |

Only the seven modes above are valid in a Valkey selection. Migration 0404
removes the retired timetable and its stored entries. A stale or malformed
Valkey payload is discarded on read; it is never translated into a current
mode. The countdown remains available as a block of the `live` composition.

### Connections graph view

`connections-view.tsx` (+ `connections-graph.tsx`, `connections-layout.ts`)
renders the typed `TvConnectionsResponse` from `@hackos/shared/tv-connections`
(#934, #935). Only people who share their networking profile are in the data, so
every person node carries a name; the view still treats a missing label
defensively. There is no stats row, legend or caption: the header and the graph
are all there is. Display rules:

- Plain SVG drawn by `connections-graph.tsx` (no chart library), styled after
  org-roam-ui: flat dark canvas (flat light twin in light mode), thin translucent
  links, every person the same single flat colour (no glow), radius growing
  with the square root of degree (leaf ~4.6 px to hub 22 px at 1000 px height,
  capped; no controls). Communities steer only the camera and dimming, never colour.
- Companies are drawn *as* their logo (SVG `<image>`, no frame), always bigger
  than any person, with no name label (their logo is the node). The negative logo is used on dark
  canvases, the plain one on light; each URL is probed off-DOM, a failed variant
  falls back to the other, and a company with no loadable logo is a large neutral
  disc with its initial. The logos are the already-public sponsor URLs (`logoUrl`,
  `logoNegativeUrl` on company nodes); the web app sets no CSP and `<image>` needs
  no CORS since nothing reads pixels.
- Sections: `detectSections` runs a deterministic label propagation over the
  people (companies are fixed anchors that vote at half weight; visit order comes
  from a hash of the id, never `Math.random`). Communities of 3+ people become
  sections, biggest first, at most 12. Graphs under 6 people, or with no 3-person
  community, only show the overview.
- Camera loop (`buildSequence`): overview (6 s, calm, no names) →
  section 1 … section 3 → overview → section 4 … The camera is one SVG transform
  tweened per frame (1.6 s ease-in-out, zoom interpolated in log space);
  `cameraFor` frames the section's people and home companies. In a section its
  people, their companies and their edges are lit, the rest fades to ~10 %
  (opacity transitions). Names are placed only once the camera settles, by
  `selectLabels` (people only, priority = degree; companies are obstacles; collision-free, inside the
  frame, capped), and fade in. Nothing else is drawn on the canvas: no caption.
- Motion: the loop pauses while the page is hidden; with
  `prefers-reduced-motion` it still steps through sections but jumps without
  animation. Nothing reacts to hover, focus or clicks, and there is no roam.
- Layout is computed by our own deterministic force pass (`layoutGraph`):
  positions are seeded from the node id, kept by id across polls, new nodes start
  next to their neighbours, and the simulation runs a bounded number of steps
  then stops. Node ids rotate server-side, so a rotation re-seeds the layout once.
  A poll retargets the camera from where it currently is, so it never resets
  mid-transition.
- Refresh: polled every 15–30 s with random spacing, plus the public TV stream's
  `data.changed` (forwarded by `TvDisplay` as an `invalidation` counter, jittered
  3 s, never more often than every 5 s). A failed poll keeps the last snapshot and
  shows the reconnecting note; with no snapshot yet it shows an error state.
- `truncated` shows a short note; an empty snapshot shows a friendly "no
  connections yet" state.

### Winners

`GET /api/tv/winners` (public) returns `{}` until a challenge's winners are
published (H46/#1010), then `{winners:[{challengeId,challengeTitle,rank,repoId,repoName}]}`.
Publication is scheduled or manual (`/api/challenges/:id/winners/publication`,
`/publish`) and the reveal arrives over `/api/tv/stream` as a payload-free
invalidation; screens refetch.

### Announcements on screens

An announcement independently chooses whether it sends user notifications and
how it appears on TVs: `none`, `embedded`, or `fullscreen`. Its
`publish_at`/`expires_at` window controls both public visibility and screen
presence; no expiry means it remains until deletion. If several eligible
announcements overlap, the newest visible announcement for each placement is
the deterministic winner.

- `fullscreen` occupies the TV frame above the current base mode, while the
  underlying manual selection continues unchanged.
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

## Display language

The wall renders in a fixed, operator-chosen language — never a signed-in
caller's own account preference. A staff session cookie sitting in the kiosk
browser must never change what a public screen shows, so `LocaleProvider`
(`apps/web/src/lib/i18n.ts`) skips its usual "follow the caller's own
language" sync on `/tv`; `TvDisplay`'s own `load()` is the only thing that
calls `setLanguage` there, driven by the venue config it already fetches.

`language` lives in `event_config.tv_language` (nullable —
null means "no override", the wall falls back to Spanish) alongside the Wi-Fi
fields, so it survives control-page reloads and applies even when nobody is
at the control page. `GET /api/tv/config` serves it publicly; `PATCH
/api/tv/config` (capability `TV_CONTROL`, audited under `event_config`)
sets it from the **Display language** section of `/tv/control` and broadcasts
`tv.config.changed` on the `tv` topic, mirrored to the public wall like every
other TV change.

## Venue Wi-Fi

Credentials live in `event_config` (`wifi_ssid`, `wifi_password`), edited in
**Settings → Event → Venue** behind
`VENUE_MANAGE`. `GET /api/tv/config` serves them to the screens; both the
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
  measured width to choose a column count. The outer grid packs complete rows
  and distributes spare tracks between the groups already on that row, so a
  sparse final row still fills the wall. A large shared queue may split into
  connected visual segments to use the end of the preceding row: its summary
  and first room sit beside the smaller groups already there, while the
  remaining room tiles continue across the row below. A measured inline SVG
  fills the gap and draws one rounded outline around both segments, so the
  result is a real connected L-shaped body rather than two nearby cards or the
  group's rectangular bounding box. The shared-queue heading remains above its
  first room, preserving the same hierarchy used by smaller shared queues. That
  room card stretches to the bottom of the shared outer row, aligned with its
  neighbours; the L's inner shoulder starts after the lower segment's padding
  gutter, so the connecting fill never visually touches the room card edge.

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

1. **Current display** — live preview, SSE connection state, and the current
   manual/default state, with **Reset to rooms** when a mode is selected.
2. **Display mode** — choose what is visible now: live, rooms, schedule, sponsors,
   and Wi-Fi. Wi-Fi has no credential editor; it reads event configuration.
   Announcements and standalone countdowns are not selectable modes.
3. **Display language** — sets the wall's fixed render language (or clears the
   language override back to the default), independent of the selected mode.

## Related

- Events: `TV_MODE_CHANGED` and `TV_CONFIG_CHANGED` in
  `packages/shared/src/events.ts`, both on the `tv` SSE topic.
- [Design rulebook](./DESIGN.md) — TV surface rules.
- [Event config & Wallet pass](./event-config-wallet.md) — the `event_config`
  singleton the Wi-Fi fields join.

## Multiplexed realtime transport (#892)

TV keeps one public payload-free stream for every rendered domain. Details are
in [realtime transport](./realtime-transport.md).

<!-- BEGIN connections-graph-api (T3: API part only; the display is documented elsewhere in this file) -->
## Connections graph API (#934, #935)

Mode `connections` (`TV_CONNECTIONS_MODE`, shared contract
`packages/shared/src/tv-connections.ts`) is accepted by `PATCH /api/tv/mode`
and returned by `GET /api/tv/mode` like any other mode. Its data comes from
the public, unauthenticated `GET /api/tv/connections` (`public:public-tv`),
implemented in `apps/api/src/modules/queue/tv-connections.ts` and tested in
`apps/api/test/queue/tv-connections.test.ts`.

- **One aggregate SQL**, not `visibleDirectoryEntries`, scoped by
  `current_edition()`. Cached in the shared cache for **15 s** per edition;
  that TTL is the stale-data bound for sharing changes, account removal and edition
  switches (nothing else caches it). SSE stays payload-free and nothing is
  broadcast per scan: screens refetch on their own poll or on the existing TV
  invalidations.
- **Who is a node.** People with event access (active, not removal-pending or
  anonymized), not a test account, with `directory_visible` true (networking
  profile shared; no profile row or sharing off means absent, with no anonymous
  dot); companies of the active edition that are `visible` and
  not synthetic. Only nodes with at least one edge are returned.
- **Edges.** A person pair is one undirected edge while *either* side keeps
  the diary entry (one-way, reciprocal and one-sided deletion converge on one
  edge). A person–company edge exists only for a visible person. Both person
  endpoints must be visible, so turning sharing off removes every incident edge,
  and `degree` and `totals` count visible people only.
- **Labels.** A person's `label` is always their display name (surname only if
  `show_surname`, else initial); it is never null. Company label is its name.
  No photos. Company nodes (only) also carry `logoUrl` and `logoNegativeUrl`
  (`string | null`): the already-public sponsor logo fields, in the same form
  as `/api/public/sponsors` and the sponsors TV mode
  (`COALESCE(logo_negative_url, logo_url)` for the negative). Person nodes have
  neither key.
- **Node ids** are `base64url(HMAC-SHA256(key, kind:id))[0..22]`, where `key`
  is derived from `BETTER_AUTH_SECRET` and the current UTC hour. Ids are stable
  within the hour (layout continuity) and uncorrelatable across hours; raw user
  or enterprise ids never appear. A snapshot cached across an hour boundary
  keeps its ids for at most one TTL.
- **Bound.** At most 2000 nodes and 30 000 edges (`TV_GRAPH_MAX_NODES`,
  `TV_GRAPH_MAX_EDGES`; a 600-person graph with 40 scans each, 24 000 edges, is
  under the cap, ~1.3 MB JSON before compression). Over the cap the lowest-degree
  nodes, then the edges between the lowest-degree endpoints, are dropped
  deterministically (degree, kind, internal id), nodes left without an edge are
  omitted, and `truncated` is `true`. `totals` and each node's `degree` always
  describe the full eligible graph.
- **Never in the body:** user ids, emails, notes, stars, timestamps.
<!-- END connections-graph-api -->
