# Event diary (#935)

A private diary of the people and sponsor stands an attendee met during the
event. People are saved by scanning their badge (NFC tag or badge QR) or
ticket QR, or from the opt-in people directory (#934); sponsors are saved by
scanning a tag or printed QR at their stand. The diary replaces People as the
personal destination: saved contacts first, the directory search as a
secondary view of the same page. There is no Hxx story; code and commits
reference `#935` (and `#934` for the directory it builds on).

Module: `apps/api/src/modules/diary/`; stand tags live in
`apps/api/src/modules/sponsors/stands.ts`. Tests:
`apps/api/test/diary/api.test.ts`, `apps/api/test/sponsors/stand-tags.test.ts`.

## Privacy rules

- **Only public cards.** A saved person is shown with exactly the
  `DirectoryEntry` projection from `directory/service.ts`
  (`visibleDirectoryEntries`); a saved sponsor with its public card (name,
  logos, description, website, published challenges). The badge, ticket,
  email or any other identifier never appears in a response.
- **Hidden profiles reveal nothing.** Scanning someone whose directory profile
  is not visible answers `profile_not_shared` (409) with no name or id, and
  stores nothing. Saving from the directory by user id answers 404 for both
  hidden and missing people, as the directory does.
- **Live, never cached.** Only the owner's own choices are stored (favourite,
  private note). The card is projected on every read, so a person who hides
  their profile later, loses event access or is removed shows as unavailable
  (`person: null`), and a sponsor hidden again shows `sponsor: null`. The
  owner can still remove such an entry.
- **Private to the owner.** Entries are only ever read or changed by their
  owner; other users get 404. Staff have no route to read diaries.
- **No notification.** The scanned person is not told, and no realtime event
  carries diary data.
- **Directory access still applies to people.** Saving or seeing people needs
  `directory:read` (#934 D3: Sponsor and Judging Team roles do not have it by
  default). An attendee without it keeps a stands-only diary, and person
  cards they saved earlier read as unavailable.
- **Not shared with sponsors.** Scanning a stand gives the attendee the
  sponsor's public card; nothing about the attendee reaches the sponsor.
- **Enumeration.** Scan lookups are rate-limited to 20 per minute per account
  (`diary-scan`, [`rate-limiting.md`](./rate-limiting.md)).
- **Audit.** Diary writes are the owner's own personal data, not a sensitive
  staff action (H53), and are not written to `audit_log`; recording them there
  would copy a private social graph into a staff-readable trail. Stand-tag
  changes by staff are audited.

## Model

`diary_entries` (migration `0103_event_diary.sql`):

| Column | Meaning |
| --- | --- |
| `owner_id` | The attendee whose diary this is. |
| `target_user_id` / `enterprise_id` | Exactly one is set: a saved person or a saved sponsor. |
| `starred` | Favourite; favourites list first. |
| `note` | Private note, ≤500 characters, trimmed, empty clears it. Newlines allowed, other control characters rejected. |

Partial unique indexes on `(owner_id, target_user_id)` and
`(owner_id, enterprise_id)` make a re-scan, a retry and a concurrent double
save converge on one row. A person cannot save themselves.

`sponsor_stand_tags` (migration `0702_sponsor_stand_tags.sql`):

| Column | Meaning |
| --- | --- |
| `enterprise_id` | The sponsor the stand belongs to. |
| `kind` | `nfc` (a 7-byte NTAG213 UID, uppercase hex — the badge encoding in [`mobile.md`](./mobile.md)) or `qr`. |
| `code` | Globally unique. QR codes are generated as `STAND-` plus 16 characters. |

A stand code can never identify a person: linking refuses a code that is a
current or rotated-away badge or a ticket token, and badge check-in and
rotation refuse a stand code (`assertNotStandTag`).

## Scan resolution

`POST /api/me/diary/scan` takes the raw `code` and tries, in order:

1. a stand tag (case-insensitive) → the sponsor, if revealed (`visibility =
   'visible'`, never a review fixture); otherwise `stand_unavailable` (409);
2. a current badge (`resolveByBadge`, as the scanners use) — a rotated-away
   or retired badge answers `badge_revoked` (409);
3. a ticket token of an active account;
4. otherwise `diary_code_unknown` (404).

People then need `directory:read` (403) and a currently visible profile
(`profile_not_shared`); the caller's own badge answers `diary_self` (409). A
new entry answers 201, an existing one 200 with the stored favourite and note.

## Access

| Route | Guard |
| --- | --- |
| `GET /api/me/diary` | authenticated + event access |
| `POST /api/me/diary/scan` | authenticated + event access, `diary-scan` rate limit, `Idempotency-Key` |
| `POST /api/me/diary/people` | `directory:read` + event access, `Idempotency-Key` |
| `PATCH /api/me/diary/:entryId` | owner + event access, `Idempotency-Key` |
| `DELETE /api/me/diary/:entryId` | owner + event access, `Idempotency-Key` |
| `GET /api/enterprises/:id/stand-tags` | `sponsors:manage` |
| `POST /api/enterprises/:id/stand-tags` | `sponsors:manage`, `Idempotency-Key`, audited |
| `DELETE /api/enterprises/:id/stand-tags/:tagId` | `sponsors:manage`, `Idempotency-Key`, audited |

No new capability exists: the diary uses the event-access gate of
`GET /api/me/public-profile`. Writes lock the owner's `users` row and refuse
accounts being removed (409). The route schemas in `/documentation` are the
request and response reference.

## Realtime

None. `/api/me/diary` mutations are excluded from the generic `identity`
refresh (`sse-routing.ts`), because the diary is private and changes no shared
read model. Clients update from the mutation response and refetch on focus.

## Web

`/people` (`apps/web/src/app/(app)/people/event-diary.tsx`) is the diary,
labelled Diary in the personal nav ([`navigation.md`](./navigation.md)). The
default Saved tab lists `GET /api/me/diary`: people reuse the directory row
(name links to `/people/<userId>`), sponsors show logo, name, clamped
description, website and challenges, and unavailable entries show one quiet
line and can still be removed. Each row has a favourite star and a menu with
Add/Edit note (dialog, 500 characters) and Remove (confirmation). Controls
are disabled while their request runs and every write sends an
`Idempotency-Key`. The secondary Directory tab (`?tab=directory`,
`directory:read` only) keeps the directory list and its URL parameters
([`directory.md`](./directory.md)) and adds Save per row. The page refetches on
the `directory` topic's `domain.changed` and when the window regains focus.
Without event access it shows access denied.

The enterprise page has a Stand tab (`stand-tags-card.tsx`, `sponsors:manage`
only): link an NFC tag by UID (separators stripped, uppercased; a malformed or
already-used code shows an inline error), generate a QR code shown with
`qrcode.react` and downloadable as SVG, and remove a tag after confirmation.

## Mobile

The Diary destination and its scan flow are described in
[`mobile.md`](./mobile.md#event-diary-935).

## Account removal (H54)

Deleting a user cascades on both sides. Anonymization deletes, in the removal
transaction (`scrubRelationships`), the subject's own diary and every entry in
other diaries that points at them; the H54 trigger rejects new writes for a
pending or anonymized owner or target. The personal export bundle includes
the subject's own entries as `diary` (saved people by user id, sponsors by id
and name, favourite, note, timestamps). Entries that other attendees hold
about the subject are those attendees' private data and are not exported.
