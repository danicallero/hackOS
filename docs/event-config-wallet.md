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
| `venue_name`, `venue_latitude`, `venue_longitude` | Venue; coordinates are all-or-nothing (`CHECK`) and drive the pass's lock-screen `locations` relevance. |
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

Saving `PUT /api/event` with an actual change bumps every issued Apple pass's
`update_tag` and enqueues a wallet push, so Wallet devices refetch immediately
(no-op saves push nothing).

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
