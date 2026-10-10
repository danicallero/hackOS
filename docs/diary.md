# Event diary (#935)

A private diary of the people and sponsor stands an attendee met during the
event. People enter it only dynamically, by scanning their badge (NFC tag or
badge QR) or ticket QR; sponsors are saved by scanning a tag or printed QR at
their stand. There is no browsable people directory and no way to save a
person by id: the product owner retired it on #935 ("al final queremos que sea
dinámico"). What a scanner sees is the person's opt-in public profile
([`directory.md`](./directory.md)). The diary replaces People as the personal
destination. There is no Hxx story; code and commits reference `#935` (and
`#934` for the public profile it builds on).

Module: `apps/api/src/modules/diary/`; stand tags live in
`apps/api/src/modules/sponsors/stands.ts`. Tests:
`apps/api/test/diary/api.test.ts`, `apps/api/test/sponsors/stand-tags.test.ts`.

## Privacy rules

- **Only public cards.** A saved person is shown with exactly the
  `DirectoryEntry` projection from `directory/service.ts`
  (`visibleDirectoryEntries`); a saved sponsor with its public card (name,
  logos, description, website, published challenges). The badge, ticket,
  email or any other identifier never appears in a response.
- **Hidden profiles reveal nothing.** Scanning someone whose public profile
  is not shared answers `profile_not_shared` (409) with no name or id, and
  stores nothing.
- **Live, never cached.** Only the owner's own choices are stored (favourite,
  private note). The card is projected on every read, so a person who hides
  their profile later, loses event access or is removed shows as unavailable
  (`person: null`), and a sponsor hidden again shows `sponsor: null`. The
  owner can still remove such an entry.
- **Private to the owner.** Entries are only ever read or changed by their
  owner; other users get 404. Staff have no route to read diaries.
- **No notification.** The scanned person is not told, and no realtime event
  carries diary data.
- **Every attendee may save people.** Scanning and reading saved people only
  needs event access, including Sponsor and Judging Team attendees (owner
  decision on #935). No capability, not even `*`, lets anyone read a profile
  they have not saved: scanning someone's badge is a deliberate in-person
  exchange, while browsing everyone is not.
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

People then need a currently visible profile (`profile_not_shared`); the
caller's own badge answers `diary_self` (409). A
new entry answers 201, an existing one 200 with the stored favourite and note.

## Access

| Route | Guard |
| --- | --- |
| `GET /api/me/diary` | authenticated + event access |
| `GET /api/me/diary/sponsors` | authenticated + event access |
| `POST /api/me/diary/scan` | authenticated + event access, `diary-scan` rate limit, `Idempotency-Key` |
| `PATCH /api/me/diary/:entryId` | owner + event access, `Idempotency-Key` |
| `DELETE /api/me/diary/:entryId` | owner + event access, `Idempotency-Key` |
| `GET /api/enterprises/:id/stand-tags` | enterprise access: that enterprise's sponsor reps or `sponsors:manage` |
| `POST /api/enterprises/:id/stand-tags` | enterprise access, `Idempotency-Key`, audited |
| `DELETE /api/enterprises/:id/stand-tags/:tagId` | enterprise access, `Idempotency-Key`, audited |

Stand tags use the same `enterprise-access` policy as editing the enterprise
profile (`sponsors/access.ts`): a sponsor representative generates QR tokens
and links NFC tags for their own stand only (another enterprise answers 403,
and a tag id from another enterprise answers 404), while staff with
`sponsors:manage` manage every enterprise. Every write is audited with its
actor.

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
labelled Diary in the personal nav ([`navigation.md`](./navigation.md)). It
keeps people and companies apart: people are contacts, a company is a stand
to collect. Tabs (`?tab=`): People (default) and Companies; an old
`?tab=directory` link opens People.

**Save and Favourite are separate.** Scanning adds a person or stand to the
diary. Favourite only marks a saved entry and drives the Favourites filters;
un-favouriting never removes anything. Removal is the explicit "Remove from
diary" in the row's `…` menu (with confirmation), next to Add/Edit note
(dialog, 500 characters). Controls are disabled while their request runs and
every write sends an `Idempotency-Key`.

- **People** lists the person entries of `GET /api/me/diary` with a local
  search (name, headline, project, challenges, location and the private note,
  accent- and case-insensitive) and a Favourites toggle. Rows show the avatar,
  name, headline, project, challenges and location (`personColumns`,
  `PersonMobileRow` in `people/person-row.tsx`) with the trailing actions:
  Favourite and `…`. The whole row opens `/people/<userId>` (desktop row click; on narrow screens a stretched link
  with a full-width hover/pressed state); the trailing controls never trigger
  it. Someone who no longer shares a profile shows one quiet line, has no
  link, and can still be removed.
- **Companies** reads `GET /api/me/diary/sponsors`: a progress ring with
  "collected of total", then an album of round logo badges. Collected stands
  are in colour (a star marks favourites); the rest are muted and dashed with
  a lock. A badge opens a dialog with the public card (description, website,
  challenges) and, once collected, the collection date, the note, Favourite,
  Edit note and Remove. Uncollected badges explain how to collect them. A
  Favourites toggle narrows the album to starred stands.

The page refetches on the `directory` topic's `domain.changed` and when the
window regains focus. Without event access it shows access denied.

People are added on mobile, which has the scanner; the web diary shows and
edits what was saved.

### Collection

`GET /api/me/diary/sponsors` counts the stands an attendee can collect: every
revealed sponsor (H45 visibility, never a review fixture) with at least one
stand tag, plus revealed sponsors the caller already collected even if their
tags were removed since. A sponsor hidden again drops out of both counts.
Items come collected first (newest first), then by name; stand codes are never
included.

The enterprise page has a Stand tab (`stand-tags-card.tsx`) for staff with
`sponsors:manage` and for the enterprise's own sponsor reps (the page only
loads for their own enterprise). Mobile has no enterprise screen, so reps
manage stand tags on the web: link an NFC tag by UID (separators stripped, uppercased; a malformed or
already-used code shows an inline error), generate a QR code shown with
`qrcode.react` and downloadable as SVG, and remove a tag after confirmation.

## Mobile

The Diary destination (People with search, favourites and full profiles; Companies as a collectible stand album) and its scan flow are
described in [`mobile.md`](./mobile.md#event-diary-935).

## Account removal (H54)

Deleting a user cascades on both sides. Anonymization deletes, in the removal
transaction (`scrubRelationships`), the subject's own diary and every entry in
other diaries that points at them; the H54 trigger rejects new writes for a
pending or anonymized owner or target. The personal export bundle includes
the subject's own entries as `diary` (saved people by user id, sponsors by id
and name, favourite, note, timestamps). Entries that other attendees hold
about the subject are those attendees' private data and are not exported.
