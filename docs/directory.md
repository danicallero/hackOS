# Public profile (#934, #935)

An opt-in public profile that an attendee shares with the people who scan
their badge: name, photo, an optional headline, bio, location note, links and
CV and, if they choose, their projects and their challenges. There is no
browsable people directory: the product owner retired it on #935 ("al final
queremos que sea dinámico"), so a person enters someone's event diary only by
a scan ([`diary.md`](./diary.md)), and only then can that attendee read their
profile. The module and routes keep their `directory` names. There is no Hxx
story; code and commits reference `#934` and `#935`.

People manage their public profile (opt-in, surname/photo/project, headline,
location note, bio, links, CV and preview) from My profile
(`/settings/profile`); there is no separate settings page. The account photo
is uploaded in the same page's Personal details section, because it is the
account's photo everywhere, not only on the public profile.

The "Public profile" section (`settings/profile/public-profile-card.tsx`)
shows only the opt-in switch ("Share my profile"), with one line saying that
only people who scan the person's badge will see it, until the person opts in; then it reveals the surname, photo and project switches, the
headline and location note (placeholder "Room 2.1", so people know which classroom to enter), the bio (with a character count), up to six links
(type + address rows; empty rows are not saved), the CV and a preview card.
The preview is the server's `preview` until something changes; then name
(surname initial by code point, as the API), photo, text, links and the
shared CV follow the unsaved edits, while the projects and challenges stay the
saved ones until saving. While the opt-in is off the hidden fields neither
enable Save nor get published: switching it off saves the stored text and
toggles unchanged. Fields are locked while a save is in flight, and each
change set saves with one `Idempotency-Key`.

The CV file saves on its own (upload, replace, remove), like the photo; the
"Share CV" switch appears once a CV exists and is part of the form. Removing
the CV also stops sharing it. A CV taken from the person's application (see
below) shows its file name and "From your application" with no upload,
replace or remove controls; the share switch still works. Link addresses are typed as text, not a native
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

## Mobile and the confirmation invite

The mobile app edits the same profile from Account ("Edit networking profile",
see [`mobile.md`](./mobile.md)) with the opt-in, the three visibility switches,
headline, location note and bio; links and the CV stay on web. After a
participant confirms their spot (H15), the web "place confirmed" card, the
public confirmation page (only for the token holder's own session) and the
mobile wallet banner show `NetworkingProfileInvite` / `NetworkingInvite`: one
sentence saying other participants and company representatives they network
with will read this profile, and a button to the editor. It appears only while
`consentedAt` is `null` (the profile was never created) and is hidden when
`GET /api/me/public-profile` fails.

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
| `share_cv` | `false` | Readers may download the CV. Requires an uploaded or application CV (400 otherwise); removing the CV clears it. |
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

User staff (`users:write`) can replace or remove someone else's photo from the
user detail page (`POST`/`DELETE /api/users/:id/photo`). The same storage
rules and locks apply; the audit row records the staff actor with source
`admin`, and the synthetic review-account boundary of every user edit applies
(H8).

`users.photo_key` replaces the old free URL in `users.image`, which hackOS no
longer reads or writes (`PATCH /api/me` refuses `image`). Every `image` field
the API returns (`/api/me`, `/api/users/:id`) and every `photoUrl` is the
authenticated route `/api/users/<id>/photo?v=<op prefix>`; the web prefixes it
with the API origin (`apiAssetUrl` in `apps/web/src/lib/directory.ts`) so the
session cookie travels with the image request.

### CV from the application

The profile picks the CV up from the application automatically. Application
file fields are defined per form, so the field is found in this order: the
file question the organizer marked as the profile CV (`profile_cv: true` in
the template, H11; the form builder's "Use as profile CV" switch, at most one
per form) and, with no mark needed, a file question whose key or label names a
CV (whole word `cv`, `curriculum`/`currículum`/`currículo`, `resume`/`résumé`;
other file questions such as ID documents are never taken). When the person
has a submitted (non-draft) response to such a form, and the stored upload is
a PDF under that response's own `uploads/<application>/<user>/` prefix, the
most recently submitted one (a marked field before a name match) is their
profile CV:

- it wins over any CV they uploaded on the profile, which stays stored but
  unused; `GET /api/me/public-profile` reports `cv.source: "application"`
  (`"upload"` otherwise) with the submission time as `uploadedAt`;
- `POST` and `DELETE /api/me/public-profile/cv` answer 409 while it exists;
- `shareCv` can be turned on without an upload. Sharing with the people who
  scanned them stays the person's own consent: the H56 sponsor consent does not
  imply it;
- both CV download routes stream the application object, named after the
  uploaded file. Removing the field from the form, or a non-PDF upload, falls
  back to the profile upload.

Application objects are removed with the application responses on H54
removal, like any other upload.

## What a reader sees

A reader is an attendee who saved the person in their diary by scanning their
badge or ticket.

`DirectoryEntry` is the complete list of exposed fields:

| Field | Source | Condition |
| --- | --- | --- |
| `userId` | `users.id` | always |
| `displayName` | `name` + surname initial, or full surname | always |
| `photoUrl` | `/api/users/:id/photo?v=…` for `users.photo_key` | `show_photo` and a photo exists |
| `headline`, `bio`, `locationNote` | profile | when set |
| `socials[]` `{kind, url}` | profile | always (may be empty) |
| `cvUrl` | `/api/directory/:userId/cv` (the owner's preview: `/api/me/public-profile/cv`) | `share_cv` and a CV exists |
| `projects[]` `{kind, id, name}` | every active `submissions` → `repos` (`kind: "project"`), then every active, unlinked `planned_work_groups` membership (`kind: "workGroup"`), each by id | `show_project` |
| `project` | deprecated: the first of `projects` (or `null`), kept for app builds that predate the list | `show_project` |
| `challenges[]` `{id, name}` | published, non-test challenges of any of those projects (`queue_entries`) or groups (`planned_work_group_challenges`) | `show_project` |

Nothing else leaves the module: no email, DNI, badge, intolerances,
university, size, application state, roles or capabilities, presence, test
flag, teammates or storage keys (the CV download names the file as uploaded).
Project names may appear while its other members stay hidden; members are
never listed.

A profile is shared only while it is visible, the person is in
`user_event_access` (active, not anonymized, an event-access role) and is not
a test account. The same rule decides whether a scan saves the person
(`profile_not_shared` otherwise) and whether a saved entry shows its card.

## Access

| Route | Guard |
| --- | --- |
| `GET /api/me/public-profile` | authenticated + event access |
| `PUT /api/me/public-profile` | authenticated + event access, `Idempotency-Key` |
| `GET /api/directory/:userId` | event access + the person is in the caller's diary (#935) |
| `GET /api/directory/:userId/cv` | as above; visible profile with `share_cv` |
| `POST /api/me/public-profile/cv` | authenticated + event access, multipart, `Idempotency-Key` |
| `DELETE /api/me/public-profile/cv` | authenticated + event access, `Idempotency-Key` |
| `GET /api/me/public-profile/cv` | authenticated (own CV, shared or not) |
| `POST /api/me/photo` | authenticated, multipart, `Idempotency-Key` |
| `DELETE /api/me/photo` | authenticated, `Idempotency-Key` |
| `POST /api/users/:id/photo` | `users:write`, multipart, `Idempotency-Key` |
| `DELETE /api/users/:id/photo` | `users:write`, `Idempotency-Key` |
| `GET /api/users/:id/photo` | the person; or `users:read`; or event access + the person is in the caller's diary, while their profile is shared with `show_photo` |
| `DELETE /api/users/:id/public-profile` | `users:write` (moderation), `Idempotency-Key` |

No capability grants directory browsing. Staff may read profiles through
user management as described below. The former `directory:read` (seeded by
`0101_public_profile.sql`) is retired by `0801_retire_directory_read.sql`,
which deletes its grants and seeded-role defaults and removes it from the
catalogue constraint. Admins (`*`) and user staff get no browsing shortcut:
only `users:read` still reaches photos, as the staff user pages need. The
route schemas in `/documentation` are the request and response reference.

- There is no listing route and no save-by-id route; people are added to a
  diary only by `POST /api/me/diary/scan`.
- `GET /api/directory/:userId` answers 404 for missing, hidden and unsaved
  people alike, so visibility cannot be probed.
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
[`diary.md`](./diary.md)), with People and Companies tabs only; there is no
directory tab.

`/people/<userId>` (`people/[userId]/person-detail.tsx`) reads
`GET /api/directory/:userId`: a header with the photo, name, headline and a
"View CV" action when shared, the bio, then hairline rows for links (the
address stays visible next to the icon; links open with
`rel="noopener noreferrer nofollow ugc"`), where to find the person, project
and challenges. Empty rows are omitted. A 404 (hidden or missing) shows
"Person not found"; other failures keep an inline error with Retry. It
refetches on `domain.changed` for the `directory` topic. Only attendees who
saved the person in their diary may open it; the API answers the same 404 to
anyone else.

Every CV link on the web (the person page, the owner's file name and the
"View CV" link of the My profile preview) opens the shared viewer
(`components/profile/cv-viewer.tsx`) instead of a new tab. It fetches the CV
route as a blob with the session cookie, shows it from an object URL in an
`<iframe>` (the browser's own PDF viewer) and revokes the URL when it closes.
The dialog is wide and nearly full height on desktop and full screen on
phones; its header offers Download, named after the original file through
`content-disposition` (which the API exposes to the web origin for this), and
Open in new tab on the API route. Loading shows a page-shaped skeleton; a 404
shows "Person not found" (the owner's routes: "No file uploaded."), and other
failures an inline error with Retry. Browsers without an inline PDF viewer
(`navigator.pdfViewerEnabled === false`, such as Chrome on Android) get the
file name and a Download button instead.

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

A card's challenges exclude cancelled and disqualified queue entries.

## Realtime and caching

There is no server read cache (see `architecture.md`). The generic mutation
hook emits the payload-free `domain.changed` on the `directory` topic
(`domain:directory` scope: event access, since every attendee owns a profile
preview and a diary of saved cards), so open views refetch without receiving
personal data over SSE.
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

## User-management profile moderation (#935, H8, H53)

The user detail page includes a Public profile tab. `users:read` can see the
stored profile and its reader preview even when sharing is off, with the CV
available independently of its sharing switch. `users:write` can edit the
profile's text, links and display switches, stop sharing, remove the account
photo and delete an uploaded profile CV. Each moderation action requires
confirmation; unsaved text survives file removal. Staff cannot turn sharing
back on: that consent belongs to the person. An application CV stays attached
to its application; staff can stop sharing it through the profile switch.
No moderation notification is sent.

| Route | Access |
| --- | --- |
| `GET /api/users/:id/public-profile` | `users:read`, shared or hidden |
| `PUT /api/users/:id/public-profile` | `users:write`, idempotency, audited |
| `GET /api/users/:id/public-profile/cv` | `users:read`, shared or unshared |
| `DELETE /api/users/:id/public-profile/cv` | `users:write`, idempotency, audited |

These routes enforce the same synthetic-account boundary as other user edits.
Staff writes use the owner's row lock and refuse pending account removal;
they do not require the target to retain event access. Audit records identify
the staff actor, source `admin` and changed fields without retaining profile
text, links or filenames. Repeating unchanged settings writes and broadcasts
nothing. The existing photo removal route records its own audit entry.
The legacy hide-and-clear route also enforces the synthetic-account boundary.
