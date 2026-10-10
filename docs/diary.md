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

Module: `apps/api/src/modules/diary/`; company tags and their staff management
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
  would copy a private social graph into a staff-readable trail. Company-tag
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

### Company tags

A company tag is how an attendee collects a company ("visited stand X"): an
NFC tag or wristband, or a printed QR code, that staff define for that
company. Tags belong to the company, not to anyone's profile: a rep may wear
one on a lanyard or a table may hold one, and a company may have several.
Scanning a person's badge, a sponsor rep's included, only ever saves that
person; it never grants their company. The schema keeps the original `stand`
naming.

`sponsor_stand_tags` (migrations `0702_sponsor_stand_tags.sql`,
`0704_company_tag_labels.sql`):

| Column | Meaning |
| --- | --- |
| `enterprise_id` | The company the tag belongs to. |
| `kind` | `nfc`: an NFC tag or wristband, by its serial number (the 7-byte NTAG UID, uppercase hex — the badge encoding in [`mobile.md`](./mobile.md)); or `qr`. |
| `code` | Globally unique. QR codes are generated as `STAND-` plus 16 characters. |
| `label` | Optional staff label (≤40 characters, no control characters) to tell a company's tags apart, such as "Lanyard Ana" or "Table 3". |

Participant badges and company tags use the same wristbands, but a given
wristband is one or the other, never both. Linking refuses a UID that is or
was someone's badge (current or rotated away) or a ticket token, with a 409
"This wristband is already a badge; use an unassigned one"; badge check-in and
badge replacement refuse a company tag with a 409 (`details.code:
"company_tag"`, `assertNotStandTag`). The linking 409 carries
`details.usedBy` (`badge`, `ticket` or `stand`) so staff learn why, without
the person or the other company being named.

Every tag has a link, `https://<web host>/s/<code>`, where the code is the
tag's own code (the UID or the `STAND-` token), so a link resolves to exactly
one tag. Printed QR codes hold the link, which the app and the web both open (see
[Tag links](#tag-links)); NFC tags are collected by serial number and carry no
link. A separate per-tag token was not added: the UID is readable by any
phone, so a second secret would protect nothing. The web host is the API's `WEB_URL` and
must be the app's associated domain.

`enterprises.stand_scannable` (migration `0703_enterprise_stand_scannable.sql`)
is the staff decision that attendees can collect a company by scanning its
tags. Only `sponsors:manage` changes it. **Default:** off for new
enterprises, so a sponsor without a stand never shows up in the album; the
migration turned it on for every enterprise that already had a tag, which
kept their behaviour unchanged.

## Scan resolution

`POST /api/me/diary/scan` takes the raw `code`. A tag link on the web host
(`https://<WEB_URL host>/s/<code>`) is reduced to its code first; a link on
another host is left as is and answers `diary_code_unknown`. It then tries,
in order:

1. a company tag (case-insensitive) → the company, if it is scannable and
   revealed (`visibility = 'visible'`, never a review fixture); otherwise
   `stand_unavailable` (409), naming no one;
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
| `GET /api/enterprises/:id/stand-tags` | enterprise access: that company's sponsor reps or `sponsors:manage` |
| `GET /api/enterprises/:id/stand-tags/:tagId/qr.svg` | enterprise access |
| `POST /api/enterprises/:id/stand-tags` | `sponsors:manage`, `Idempotency-Key`, audited |
| `PATCH /api/enterprises/:id/stand-tags/:tagId` | `sponsors:manage`, `Idempotency-Key`, audited |
| `DELETE /api/enterprises/:id/stand-tags/:tagId` | `sponsors:manage`, `Idempotency-Key`, audited |
| `GET /api/enterprises/stands` | `sponsors:manage` |
| `PUT /api/enterprises/:id/stand-scannable` | `sponsors:manage`, `Idempotency-Key`, audited |
| `POST /api/enterprises/stands/qr` | `sponsors:manage`, `Idempotency-Key`, audited |
| `GET /api/enterprises/stands/codes.csv` | `sponsors:manage`, audited |
| `GET /api/enterprises/stands/qr.zip` | `sponsors:manage`, audited |

Staff (`sponsors:manage`) define every company's tags. A company's own
sponsor reps can read its tags and download its QR SVGs through the same
`enterprise-access` policy as the enterprise profile (`sponsors/access.ts`;
another company answers 403), but they cannot add, label or remove tags, nor
turn scanning on. Every write is audited with its actor: `stand_tag.added`
(kind and label), `stand_tag.labelled` (before/after),
`stand_tag.removed`.

The staff routes cover every enterprise inside the review-fixture boundary of
the enterprise list:

- `GET /api/enterprises/stands` lists each enterprise's name, logos,
  visibility, `scannable`, NFC and QR counts, newest QR tag id and every tag
  (kind, serial number or token, label, creation time).
- `PUT …/stand-scannable` sets the flag under the enterprise row lock;
  repeating the current value changes nothing, is not audited and broadcasts
  nothing. A change writes `stand.scannable_changed` with before/after.
- `PATCH …/stand-tags/:tagId` sets or clears (`null` or empty) the label;
  repeating it changes nothing and is not audited.
- `POST /api/enterprises/stands/qr` gives every scannable company without a
  QR one new QR tag. It locks those enterprise rows first (the lock a single
  tag write takes), so a concurrent or repeated run finds the QR already there
  and creates nothing; each created tag is audited as `stand_tag.added` with
  `bulk: true`.
- Exports cover the scannable companies only. Each export writes
  `stand_codes.exported` with its format and counts (never the codes) and a
  409 `stand_codes_empty` answers when there is nothing to export. The CSV is
  `enterprise_id,name,kind,code,label,url` (`url` is the tag link). The zip
  holds one SVG per QR tag, named `<company>-<token>.svg`.
- Every QR SVG (zip, single download and the Tags tab) is rendered by the API
  (`stand-qr.ts`): a vector QR of the tag link at error correction Q with a
  4-module quiet zone, 80 mm wide, with the company name (two lines when long)
  and the token printed underneath. The zip is built server-side because the
  export is audited where it happens and the single and bulk files are
  identical; its entries are small in-memory strings, so nothing can fail
  mid-stream.

## Tag links

`https://<web host>/s/<code>` opens:

- **the app**, when installed: iOS through the `applinks` associated domain
  (the web serves `/.well-known/apple-app-site-association`, `applinks` for
  `/s/*`), Android through a verified App Link (`/.well-known/assetlinks.json`
  from `ANDROID_APP_CERT_SHA256`, [`deploy/README.md`](../deploy/README.md))
  (NFC tags carry no link: they are collected by serial number,
  [`mobile.md`](./mobile.md#company-tags-935)). The app route
  `app/s/[code].tsx` hands the code to the Diary, which collects it like a
  scan and celebrates on the Companies album; signed out, it waits for
  sign-in and resumes;
- **the web fallback** otherwise: `/s/[code]` (`apps/web/src/app/(public)/s/`)
  collects the company through the same scan for a signed-in attendee and
  shows its badge with a link to the Companies tab; signed out, it offers
  sign-in (returning to the link) and notes that the app opens the link
  directly.

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

`GET /api/me/diary/sponsors` counts the companies an attendee can collect:
every revealed sponsor (H45 visibility, never a review fixture) that is
scannable and has at least one company tag, plus revealed sponsors the caller
already collected even if their tags were removed or scanning was turned off
since. A company that is not scannable and not collected is neither listed
nor counted. **A collected one stays in both `collected` and `total`**, as
with removed tags: progress never goes backwards and the ring never shows more
collected than total. A sponsor hidden again drops out of both counts. Items
follow the public logo grid's order (`enterprises.priority`, 1 first and unset
last, then name), collected or not, so uncollected companies sit among the
collected ones as a nudge to scan them; tag codes are never
included.

The enterprise page has a Tags tab (`stand-tags-card.tsx`, `?tab=stand`) for
staff with `sponsors:manage` and for the company's own sponsor reps (the page
only loads for their own enterprise). Each tag shows its kind, optional label,
full code with a copy button, creation date and, for QR codes, a preview of
the tag link with a download of the API's printable SVG. Reps only see them.
Staff link an NFC tag or wristband by serial number (separators stripped,
uppercased; a malformed code, a wristband that is a badge or a tag of another
company shows an inline error), add a QR code, edit a tag's label and remove
a tag after confirmation. While the company is not scannable the tab says
attendees cannot collect it yet; staff also get "Turn on scanning" there.

### Company tags (staff)

`/company-tags` (`apps/web/src/app/(app)/company-tags/`, Sponsors workspace,
`sponsors:manage`) is one dense table of every enterprise, on the Users list
pattern (`ListToolbar`, `FilterMenu`, `DataTable`): logo and name (linking to
the enterprise's Tags tab), visibility (visible, scheduled or hidden), a
Scannable switch (optimistic, rolled back with a toast on failure) and its
tags, each as a chip with kind, label, the serial number (NFC; QR tokens are
shortened to `STAND-…XXXX`) and a copy button for the full code. Filters:
scannable, codes (without QR, with QR, with NFC, no codes) and visibility; the
search matches name, serial number (with or without separators) and label.
Each row's `…` menu adds a QR code, links an NFC tag or wristband by serial
number with an optional label (a dialog validated like badges), downloads the
newest QR as SVG and opens the enterprise. The header shows "n of m
scannable", the primary "Generate missing QR codes (n)" (disabled when none is
missing; an icon on narrow screens) and a `…` menu with "Download all QR
codes" (zip) and "Export codes (CSV)". After a bulk run a status panel names
the companies that
got a QR, with a direct zip download. Downloads go through `apiDownload`
(`lib/api.ts`), which keeps the API's file name (`content-disposition` is
exposed by CORS).

## Mobile

The Diary destination (People with search, favourites and
full profiles; Companies as a collectible stand album) and its scan flow are
described in [`mobile.md`](./mobile.md#event-diary-935). Staff with
`sponsors:manage` link NFC tags and wristbands to companies by tapping them
from Account → Staff → Company tags, the same tap that accredits a badge
([`mobile.md`](./mobile.md#company-tags-935)).

## Account removal (H54)

Deleting a user cascades on both sides. Anonymization deletes, in the removal
transaction (`scrubRelationships`), the subject's own diary and every entry in
other diaries that points at them; the H54 trigger rejects new writes for a
pending or anonymized owner or target. The personal export bundle includes
the subject's own entries as `diary` (saved people by user id, sponsors by id
and name, favourite, note, timestamps). Entries that other attendees hold
about the subject are those attendees' private data and are not exported.
