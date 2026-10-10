# Event diary (#935)

A private diary of the people and sponsor stands an attendee met during the
event. People are saved by scanning their badge (NFC tag or badge QR) or
ticket QR, or from the opt-in people directory (#934); sponsors are saved by
scanning a tag or printed QR at their stand. The diary replaces People as the
personal destination: saved contacts first, the directory search as a
secondary view of the same page. There is no Hxx story; code and commits
reference `#935` (and `#934` for the directory it builds on).

Module: `apps/api/src/modules/diary/`; stand tags and staff stand management
live in `apps/api/src/modules/sponsors/stands.ts` (printable QR SVGs in
`stand-qr.ts`). Tests: `apps/api/test/diary/api.test.ts`,
`apps/api/test/sponsors/stand-tags.test.ts`,
`apps/api/test/sponsors/stands-admin.test.ts`.

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
- **Every attendee may save people.** Saving and seeing people only needs
  event access, so Sponsor and Judging Team attendees, who lack
  `directory:read` (#934 D3), save people too (owner decision on #935). The
  visibility rules above still decide what any of them can see. Browsing the
  directory itself keeps its `directory:read` gate: scanning someone's badge
  is a deliberate in-person exchange, while browsing everyone is not.
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
rotation refuse a stand code (`assertNotStandTag`). The 409 carries
`details.usedBy` (`badge`, `ticket` or `stand`) so staff learn why, without
the person or the other enterprise being named.

`enterprises.stand_scannable` (migration `0703_enterprise_stand_scannable.sql`)
is the staff decision that attendees can collect a sponsor by scanning its
stand. Only `sponsors:manage` changes it; sponsor reps keep managing their own
tags but cannot turn scanning on. **Default:** off for new enterprises, so a
sponsor without a physical stand never shows up in the album; the migration
turned it on for every enterprise that already had a tag, which kept their
behaviour unchanged.

## Scan resolution

`POST /api/me/diary/scan` takes the raw `code` and tries, in order:

1. a stand tag (case-insensitive) → the sponsor, if its stand is scannable
   and the sponsor is revealed (`visibility = 'visible'`, never a review
   fixture); otherwise `stand_unavailable` (409), naming no one;
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
| `POST /api/me/diary/people` | authenticated + event access, `Idempotency-Key` |
| `PATCH /api/me/diary/:entryId` | owner + event access, `Idempotency-Key` |
| `DELETE /api/me/diary/:entryId` | owner + event access, `Idempotency-Key` |
| `GET /api/enterprises/:id/stand-tags` | enterprise access: that enterprise's sponsor reps or `sponsors:manage` |
| `POST /api/enterprises/:id/stand-tags` | enterprise access, `Idempotency-Key`, audited |
| `DELETE /api/enterprises/:id/stand-tags/:tagId` | enterprise access, `Idempotency-Key`, audited |
| `GET /api/enterprises/:id/stand-tags/:tagId/qr.svg` | enterprise access |
| `GET /api/enterprises/stands` | `sponsors:manage` |
| `PUT /api/enterprises/:id/stand-scannable` | `sponsors:manage`, `Idempotency-Key`, audited |
| `POST /api/enterprises/stands/qr` | `sponsors:manage`, `Idempotency-Key`, audited |
| `GET /api/enterprises/stands/codes.csv` | `sponsors:manage`, audited |
| `GET /api/enterprises/stands/qr.zip` | `sponsors:manage`, audited |

Stand tags use the same `enterprise-access` policy as editing the enterprise
profile (`sponsors/access.ts`): a sponsor representative generates QR tokens
and links NFC tags for their own stand only (another enterprise answers 403,
and a tag id from another enterprise answers 404), while staff with
`sponsors:manage` manage every enterprise. Every write is audited with its
actor.

The staff routes cover every enterprise inside the review-fixture boundary of
the enterprise list:

- `GET /api/enterprises/stands` lists each enterprise's name, logos,
  visibility, `scannable`, NFC and QR counts and newest QR tag id. It never
  includes codes.
- `PUT …/stand-scannable` sets the flag under the enterprise row lock;
  repeating the current value changes nothing, is not audited and broadcasts
  nothing. A change writes `stand.scannable_changed` with before/after.
- `POST /api/enterprises/stands/qr` gives every scannable enterprise without a
  QR one new QR tag. It locks those enterprise rows first (the lock a single
  tag write takes), so a concurrent or repeated run finds the QR already there
  and creates nothing; each created tag is audited as `stand_tag.added` with
  `bulk: true`.
- Exports cover the scannable stands only. Codes are what attendees scan, so
  each export writes `stand_codes.exported` with its format and counts (never
  the codes) and a 409 `stand_codes_empty` answers when there is nothing to
  export. The CSV is `enterprise_id,name,kind,code`, every NFC UID and QR
  token. The zip holds one SVG per QR tag, named `<company>-<token>.svg`.
- Every QR SVG (zip, single download and the reps' Stand tab) is rendered by
  the API (`stand-qr.ts`): a vector QR at error correction Q with a 4-module
  quiet zone, 80 mm wide, with the company name and the token printed
  underneath. The zip is built server-side because the codes never need to
  reach the browser for it, the export is audited where it happens, and the
  single and bulk files are identical; its entries are small in-memory
  strings, so nothing can fail mid-stream.

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
to collect. Tabs (`?tab=`): People (default), Companies, and Directory for
`directory:read` holders.

**Save and Favourite are separate.** Saving adds a person or stand to the
diary. Favourite only marks a saved entry and drives the Favourites filters;
un-favouriting never removes anything. Removal is the explicit "Remove from
diary" in the row's `…` menu (with confirmation), next to Add/Edit note
(dialog, 500 characters). Controls are disabled while their request runs and
every write sends an `Idempotency-Key`.

- **People** lists the person entries of `GET /api/me/diary` with a local
  search (name, headline, project, challenges, location and the private note,
  accent- and case-insensitive) and a Favourites toggle. Rows share the
  directory's columns, avatar and trailing actions (`personColumns`,
  `PersonMobileRow`): Favourite and `…`. The whole row opens
  `/people/<userId>` (desktop row click; on narrow screens a stretched link
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
- **Directory** keeps the directory list and its URL parameters
  ([`directory.md`](./directory.md)) with the same row as People: Save for
  someone not yet saved; once saved, "Saved", Favourite and the `…` menu.

The page refetches on the `directory` topic's `domain.changed` and when the
window regains focus. Without event access it shows access denied.

Person cards render for every attendee; only the Directory tab needs
`directory:read`, so an attendee without it sees the people they saved by
scanning on mobile but cannot browse the directory.

### Collection

`GET /api/me/diary/sponsors` counts the stands an attendee can collect: every
revealed sponsor (H45 visibility, never a review fixture) whose stand is
scannable and has at least one stand tag, plus revealed sponsors the caller
already collected even if their tags were removed or scanning was turned off
since. A sponsor that is not scannable and not collected is neither listed nor
counted. **A collected one stays in both `collected` and `total`**, as with
removed tags: progress never goes backwards and the ring never shows more
collected than total. A sponsor hidden again drops out of both counts. Items
come collected first (newest first), then by name; stand codes are never
included.

The enterprise page has a Stand tab (`stand-tags-card.tsx`) for staff with
`sponsors:manage` and for the enterprise's own sponsor reps (the page only
loads for their own enterprise). Reps manage stand tags on the web: link an
NFC tag by UID (separators stripped, uppercased; a malformed code, or one that
is already a badge or a stand, shows an inline error), generate a QR code
previewed with `qrcode.react` and downloaded as the API's printable SVG, and
remove a tag after confirmation. While the stand is not scannable the tab says
attendees cannot collect it yet; staff also get "Turn on scanning" there.

### Stands (staff)

`/stands` (`apps/web/src/app/(app)/stands/`, Sponsors workspace,
`sponsors:manage`) is one dense table of every enterprise, on the Users list
pattern (`ListToolbar`, `FilterMenu`, `DataTable`): logo and name (linking to
the enterprise's Stand tab), visibility (visible, scheduled or hidden), a
Scannable switch (optimistic, rolled back with a toast on failure) and the NFC
and QR counts. Filters: scannable, codes (without QR, with QR, with NFC, no
codes) and visibility; search by name. Each row's `…` menu generates a QR,
links an NFC tag by UID (a dialog validated like badges), downloads the newest
QR as SVG and opens the enterprise. The header shows "n of m scannable", the
primary "Generate missing QR codes (n)" (disabled when none is missing; an
icon on narrow screens) and a `…` menu with "Download all QR codes" (zip) and
"Export codes (CSV)". After a bulk run a status panel names the stands that
got a QR, with a direct zip download. Downloads go through `apiDownload`
(`lib/api.ts`), which keeps the API's file name (`content-disposition` is
exposed by CORS).

## Mobile

The Diary destination (People with search, favourites, the Directory scope and
full profiles; Companies as a collectible stand album) and its scan flow are
described in [`mobile.md`](./mobile.md#event-diary-935). Staff with
`sponsors:manage` link NFC tags to stands by tapping them from Account → Staff
→ Sponsor stands ([`mobile.md`](./mobile.md#sponsor-stands-935)).

## Account removal (H54)

Deleting a user cascades on both sides. Anonymization deletes, in the removal
transaction (`scrubRelationships`), the subject's own diary and every entry in
other diaries that points at them; the H54 trigger rejects new writes for a
pending or anonymized owner or target. The personal export bundle includes
the subject's own entries as `diary` (saved people by user id, sponsors by id
and name, favourite, note, timestamps). Entries that other attendees hold
about the subject are those attendees' private data and are not exported.
