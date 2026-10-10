# People directory (#934)

An opt-in directory where event attendees find each other: name, an optional
headline, an optional location note and, if they choose, their project and its
challenges. It is also the profile base that the NFC contact card (#935)
extends. There is no Hxx story yet; code and commits reference `#934`.

People manage their public profile (opt-in, surname/photo/project, headline,
location note and preview) from My profile (`/settings/profile`); there is no
separate settings page.

Module: `apps/api/src/modules/directory/`. Tests:
`apps/api/test/directory/api.test.ts`.

## Model

`user_public_profiles` (migration `0101_public_profile.sql`) is 1:1 with
`users`. Identity data stays in `users` and is projected, never copied.

| Column | Default | Meaning |
| --- | --- | --- |
| `directory_visible` | `false` | Explicit opt-in. No row means not visible. |
| `show_surname` | `false` | Full surname instead of its initial. |
| `show_photo` | `false` | Expose `users.image`. |
| `show_project` | `true` | Expose the project and its challenges. |
| `headline` | `NULL` | Free text, ≤80 characters. |
| `location_note` | `NULL` | Free text written by the person (for example "Floor 1, table 12"), ≤60 characters. There is no staff-assigned seating and presence (`time_logs`) is never exposed. |
| `consented_at` | `NULL` | Stamped on every hidden→visible transition; required while visible. |

Text is trimmed, empty text becomes `NULL`, and control characters are
rejected.

## What a reader sees

`DirectoryEntry` is the complete list of exposed fields:

| Field | Source | Condition |
| --- | --- | --- |
| `userId` | `users.id` | always |
| `displayName` | `name` + surname initial, or full surname | always |
| `photoUrl` | `users.image` | `show_photo` |
| `headline`, `locationNote` | profile | when set |
| `project` `{kind, id, name}` | active `submissions` → `repos` (`kind: "project"`), else an active, unlinked `planned_work_groups` membership (`kind: "workGroup"`) | `show_project` |
| `challenges[]` `{id, name}` | published, non-test challenges of that project (`queue_entries`) or group (`planned_work_group_challenges`) | `show_project` |

Nothing else leaves the module: no email, DNI, badge, intolerances,
university, size, application state, roles or capabilities, presence, test
flag or teammates. A project name may appear while its other members stay
hidden; members are never listed.

The directory contains a person only when the profile is visible, the person
is in `user_event_access` (active, not anonymized, an event-access role) and
is not a test account.

## Access

| Route | Guard |
| --- | --- |
| `GET /api/me/public-profile` | authenticated + event access |
| `PUT /api/me/public-profile` | authenticated + event access, `Idempotency-Key` |
| `GET /api/directory` | `directory:read` + event access |
| `GET /api/directory/:userId` | `directory:read` + event access |
| `DELETE /api/users/:id/public-profile` | `users:write` (moderation), `Idempotency-Key` |

`directory:read` is seeded for every seeded role except Sponsor and Judging
Team; `*` covers admins. The route schemas in `/documentation` are the request
and response reference.

- `GET /api/directory` takes `q` (≤80, display name, accent- and
  case-insensitive), `challengeId`, `limit` (≤50, default 25) and the opaque
  `cursor` from the previous page. Order is display name, then user id.
- `GET /api/directory/:userId` answers 404 for both missing and hidden
  profiles, so visibility cannot be probed.
- `GET /api/me/public-profile` returns the settings plus `preview`, the entry
  as readers would see it if visible.
- Moderation hides the profile and clears its free text; the person may opt in
  again.

## Writes, audit and concurrency

`PUT` locks the `users` row `FOR NO KEY UPDATE` (which also serializes the
first write, when no profile row exists yet), refuses removal-pending accounts
with 409 and non-attendees with 403, then upserts. A `PUT` that repeats the
stored settings (or the hidden defaults, without a row) writes nothing, is not
audited and broadcasts nothing. Every other `PUT` writes one `audit_log` row
(`public_profile.updated`) in the same transaction, recording the changed field
names and visibility before/after but never the free text. Moderation writes
`public_profile.moderated` with the staff reason and answers 409 for an account
being removed.

Listing pages first over the visible ids (search, `challengeId` as an `EXISTS`
over the shown project, keyset cursor and `LIMIT`) and only then projects the
project and challenges of that page. Challenges exclude cancelled and
disqualified queue entries.

## Realtime and caching

There is no server read cache (see `architecture.md`). The generic mutation
hook emits the payload-free `domain.changed` on the `directory` topic
(`domain:directory` scope: `directory:read` or event access, since Sponsor and
Judging Team attendees own a profile and its preview without reading the
directory), so open views refetch without receiving personal data over SSE.
It fires after a successful profile `PUT` that changed something, moderation,
and writes owned by other domains that change a card
(`directoryMutationForPath`): `/api/me` and `/api/users/:id` (name, surname,
photo, removal), project and work-group membership, and challenge
publication, visibility or title. Event-access (role) changes and queue
status changes are not mapped; open views pick them up when refocused.

## Account removal (H54)

Deleting a user cascades to the profile. Anonymization deletes the row in the
removal transaction (`scrubRelationships`), and the
`h54_require_active_user_reference` trigger rejects any write for a pending or
anonymized account. The profile row, with `consented_at`, is part of the
personal export bundle (`publicProfile`, `null` without a row).
