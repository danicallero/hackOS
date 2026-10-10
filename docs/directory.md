# People directory (#934)

An opt-in directory where event attendees find each other: name, photo, an
optional headline, bio, location note, links and CV and, if they choose, their
project and its challenges. It is also the profile base that the NFC contact
card (#935) extends. There is no Hxx story yet; code and commits reference
`#934` and `#935`.

People manage their public profile (opt-in, surname/photo/project, headline,
location note, bio, links, CV and preview) from My profile
(`/settings/profile`); there is no separate settings page. The account photo
is uploaded in the same page's Personal details section, because it is the
account's photo everywhere, not only in the directory.

The "Public profile" section (`settings/profile/public-profile-card.tsx`)
shows only the opt-in switch, with one line naming who will see it, until the
person opts in; then it reveals the surname, photo and project switches, the
headline and location note, the bio (with a character count), up to six links
(type + address rows; empty rows are not saved), the CV and a preview card.
The preview is the server's `preview` until something changes; then name
(surname initial by code point, as the API), photo, text, links and the
shared CV follow the unsaved edits, while the project and challenges stay the
saved ones until saving. While the opt-in is off the hidden fields neither
enable Save nor get published: switching it off saves the stored text and
toggles unchanged. Fields are locked while a save is in flight, and each
change set saves with one `Idempotency-Key`.

The CV file saves on its own (upload, replace, remove), like the photo; the
"Share CV" switch appears once a CV exists and is part of the form. Removing
the CV also stops sharing it. Link addresses are typed as text, not a native
URL input, so a bare host like `github.com/ana` is accepted and the API adds
`https://`.

The section does not subscribe to the `directory` topic, which fires for any
attendee's write and would make every open My profile refetch. It refetches
after its own `PUT` (the response replaces the state, and a `GET` that started
before the save is discarded), when the session's name, surname or photo
changes (edited in the same page), on `user.session.changed` over the personal
stream the shell already holds (event access changes), and when the tab
regains focus after a while. A 403 (no event access) hides the
section; any other load failure shows an inline error with Retry, not a toast.

Module: `apps/api/src/modules/directory/` (the photo routes live in
`identity/routes/photo.ts`; shared storage helpers in `lib/profile-files.ts`).
Tests: `apps/api/test/directory/api.test.ts` and
`apps/api/test/directory/profile-files.test.ts`.

## Model

`user_public_profiles` (migrations `0101_public_profile.sql` and
`0102_public_profile_extended.sql`) is 1:1 with `users`. Identity data,
including the account photo, stays in `users` and is projected, never copied.

| Column | Default | Meaning |
| --- | --- | --- |
| `directory_visible` | `false` | Explicit opt-in. No row means not visible. |
| `show_surname` | `false` | Full surname instead of its initial. |
| `show_photo` | `false` | Expose the account photo (`users.photo_key`). |
| `show_project` | `true` | Expose the project and its challenges. |
| `headline` | `NULL` | Free text, ≤80 characters. |
| `location_note` | `NULL` | Free text written by the person (for example "Floor 1, table 12"), ≤60 characters. There is no staff-assigned seating and presence (`time_logs`) is never exposed. |
| `bio` | `NULL` | Free text, ≤500 characters; line breaks kept, other control characters rejected. |
| `socials` | `[]` | Up to 6 distinct `{kind, url}`; `kind` is `linkedin`, `github`, `x`, `instagram`, `website` or `other`. `url` must be https (a bare host gets `https://`; credentials and hosts without a dot are rejected) and is stored in the parsed URL's canonical form. |
| `share_cv` | `false` | Readers may download the CV. Requires an uploaded CV (400 otherwise); removing the CV clears it. |
| `cv_key`, `cv_filename`, `cv_uploaded_at` | `NULL` | The private CV object, its sanitized original name and upload time; all set or all null. |
| `consented_at` | `NULL` | Stamped on every hidden→visible transition; required while visible. |

Text is trimmed, empty text becomes `NULL`, and control characters are
rejected. `PUT` may omit `bio`, `socials` and `shareCv` to keep their stored
values.

### Account photo and CV storage

Both files live in private object storage under `profiles/<user id>/`
(`photo/<op>.<png|jpg|webp>` and `cv/<op>.pdf`), a prefix the bucket never
exposes anonymously (only `enterprises/` is public). `<op>` is derived from
the upload's `Idempotency-Key`, so a retried upload addresses the same
object. The type is sniffed from the bytes (PNG/JPEG/WebP signatures, `%PDF-`)
and the declared type is ignored; photos are capped at 2 MB, CVs at 5 MB.
Oversize, empty and unsupported files are explicit 400s. The object is written
while the owner's `users` row is locked, the same lock H54 removal takes, and
a replaced or removed object is deleted after the row commits.

`users.photo_key` replaces the old free URL in `users.image`, which hackOS no
longer reads or writes (`PATCH /api/me` refuses `image`). Every `image` field
the API returns (`/api/me`, `/api/users/:id`) and every `photoUrl` is the
authenticated route `/api/users/<id>/photo?v=<op prefix>`; the web prefixes it
with the API origin (`apiAssetUrl` in `apps/web/src/lib/directory.ts`) so the
session cookie travels with the image request.

Why a profile CV instead of the application's CV: application file fields are
defined per form (there is no canonical "CV" field), their H56 consent covers
sharing with sponsors, not directory readers, and the file belongs to an
application lifecycle. The directory therefore keeps its own opt-in PDF.

## What a reader sees

`DirectoryEntry` is the complete list of exposed fields:

| Field | Source | Condition |
| --- | --- | --- |
| `userId` | `users.id` | always |
| `displayName` | `name` + surname initial, or full surname | always |
| `photoUrl` | `/api/users/:id/photo?v=…` for `users.photo_key` | `show_photo` and a photo exists |
| `headline`, `bio`, `locationNote` | profile | when set |
| `socials[]` `{kind, url}` | profile | always (may be empty) |
| `cvUrl` | `/api/directory/:userId/cv` (the owner's preview: `/api/me/public-profile/cv`) | `share_cv` and a CV exists |
| `project` `{kind, id, name}` | active `submissions` → `repos` (`kind: "project"`), else an active, unlinked `planned_work_groups` membership (`kind: "workGroup"`) | `show_project` |
| `challenges[]` `{id, name}` | published, non-test challenges of that project (`queue_entries`) or group (`planned_work_group_challenges`) | `show_project` |

Nothing else leaves the module: no email, DNI, badge, intolerances,
university, size, application state, roles or capabilities, presence, test
flag, teammates or storage keys (the CV download names the file as uploaded).
A project name may appear while its other members stay hidden; members are
never listed.

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
| `GET /api/directory/:userId/cv` | `directory:read` + event access; visible profile with `share_cv` |
| `POST /api/me/public-profile/cv` | authenticated + event access, multipart, `Idempotency-Key` |
| `DELETE /api/me/public-profile/cv` | authenticated + event access, `Idempotency-Key` |
| `GET /api/me/public-profile/cv` | authenticated (own CV, shared or not) |
| `POST /api/me/photo` | authenticated, multipart, `Idempotency-Key` |
| `DELETE /api/me/photo` | authenticated, `Idempotency-Key` |
| `GET /api/users/:id/photo` | the person; or `users:read`; or `directory:read` + event access while the person is listed with `show_photo` |
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
- `GET /api/directory/:userId/cv` and `GET /api/users/:id/photo` answer the
  same 404 for a hidden profile, an unshared or missing file and (photo) a
  reader without access, so neither visibility nor the file's existence can be
  probed. Files stream through the API with `x-content-type-options: nosniff`;
  photos are cached privately for 5 minutes (a switch turned off can take that
  long to disappear from a reader's browser), CVs are `private, no-store`.
- Moderation hides the profile, clears its headline, location note, bio and
  links and stops sharing the CV (the file stays the owner's); the person may
  opt in again.

## Web

`/people` (`apps/web/src/app/(app)/people/`) is the event diary (#935,
[`diary.md`](./diary.md)); the directory is its secondary `Directory` tab
(`?tab=directory`, shown with `directory:read`), where each row also has a
Save action (`POST /api/me/diary/people`) that shows Saved once in the diary.
Saving people into a diary, by scan or by id, only needs event access, so
attendees without `directory:read` can keep the people they meet; they still
only ever see directory-visible cards.
That tab lists `GET /api/directory` with
the shared `ListToolbar`: a name search, a single challenge filter (options
from `GET /api/public/challenges`) and Previous/Next over the opaque cursor.
`q`, `challenge` and `cursor` live in the URL so a view can be shared; writes
are skipped when the query string would not change (R003). A row shows the
photo or initials, display name, headline, project, challenges and location
note; challenge chips use the localized title from those options. The search
field resyncs from the URL only on navigation it did not write, and `q` is
trimmed on both sides. The page refetches in place on `domain.changed` for the
`directory` topic; a failed refresh keeps the rows and shows a toast. Paging
is disabled while a new query loads. Without `directory:read` the tab is
hidden and opens no directory request; the nav entry (personal area) needs
event access (`docs/navigation.md`). Each directory row links to the
person's page (the desktop row link and the whole narrow-screen row).

`/people/<userId>` (`people/[userId]/person-detail.tsx`) reads
`GET /api/directory/:userId`: a header with the photo, name, headline and a
"Download CV" action when shared, the bio, then hairline rows for links (the
address stays visible next to the icon; links open with
`rel="noopener noreferrer nofollow ugc"`), where to find the person, project
and challenges. Empty rows are omitted. A 404 (hidden or missing) shows
"Person not found"; other failures keep an inline error with Retry. It
refetches on `domain.changed` for the `directory` topic and, like the list,
opens nothing without `directory:read`.

## Writes, audit and concurrency

`PUT` locks the `users` row `FOR NO KEY UPDATE` (which also serializes the
first write, when no profile row exists yet), refuses removal-pending accounts
with 409 and non-attendees with 403, then upserts. A `PUT` that repeats the
stored settings (or the hidden defaults, without a row) writes nothing, is not
audited and broadcasts nothing. Every other `PUT` writes one `audit_log` row
(`public_profile.updated`) in the same transaction, recording the changed field
names and visibility before/after but never the free text or links. CV uploads
and removals write the same action with `changedFields: ["cv"]` (plus
`shareCv` when removal stops sharing), never the file name. Photo uploads and
removals write `user.photo_updated` / `user.photo_removed` on the `user`
entity with only `hasPhoto` before/after. Moderation writes
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
It fires after a successful profile `PUT` that changed something, CV writes,
moderation, and writes owned by other domains that change a card
(`directoryMutationForPath`): `/api/me`, `/api/me/photo` and `/api/users/:id`
(name, surname, photo, removal), project and work-group membership, and challenge
publication, visibility or title. Event-access (role) changes and queue
status changes are not mapped; open views pick them up when refocused.

## Account removal (H54)

Deleting a user cascades to the profile. Anonymization deletes the row in the
removal transaction (`scrubRelationships`), and the
`h54_require_active_user_reference` trigger rejects any write for a pending or
anonymized account. Removal's storage phase deletes the whole
`profiles/<user id>/` prefix (photo, CV and any object a failed replacement
left behind) before the final transaction, and is retried like the other
storage cleanup; the keys disappear with the `users`/profile rows (a
review-fixture reset clears `photo_key`). Uploads refuse removal-pending
accounts with 409.

The profile row (with `consented_at`, bio, links, `share_cv` and the CV's file
name and upload time) is part of the personal export bundle (`publicProfile`,
`null` without a row), and `subject.photo` records the photo's type and upload
time; both files stay downloadable by their owner through the routes above.
