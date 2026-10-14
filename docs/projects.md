# Native projects (H16–H21, #1005–#1009)

Projects use one `repos` row throughout draft and submitted states. The SQL name
and `repo_id` queue/judging foreign keys remain internal; no external import or
reconciliation endpoint exists. `submissions` is the single invited/active/declined
membership table. `project_challenges` owns challenge intent before queue generation.
Submission snapshots retain the same project ID, accepted roster, answers,
challenge selections and immutable form version.

## Forms and autosave

Applications and projects share `packages/shared/src/forms.ts`: trilingual
`TemplateField` definitions, sections and validation. URL questions are text
fields with `validation.text_condition="url"`. Images are file fields with
image MIME types. `GET/PUT /api/projects/form` reads or versions the definition;
writes require project editing and record a transactional audit.

`PUT /api/me/projects/:id/draft` accepts `{responses,revision}`. The project row
is locked and revision must match before saving. A stale save receives 409 and
never replaces a newer draft. Submission validates required fields and verifies
that uploaded file keys belong to this project and field. Required fields are
not enforced during autosave. Members may continue editing after submission
while editing is open (H20); submission history remains immutable. Nonmember
submitted projections use the last submitted snapshot and its form version.
Staff answer corrections use `PUT /api/repos/:id/draft` with the same revision
contract, audited independently of participant windows (H21/H53).

## Phases and reads

Event settings use the existing `GET/PUT /api/event` transaction and save scope.
Fields are `projectDraftsOpenAt`, `projectSubmissionsCloseAt`,
`projectDraftVisibility`, `projectGalleryOpensAt`, `projectGalleryAudience`,
`projectEditsLockAt` and `projectMaxTeamSize`. Missing draft/submission bounds
inherit the hacking window. A missing gallery opening means closed. PostgreSQL
compares boundaries to `now()`; API host time does not authorize operations.

`projects/policy.ts` owns phase, viewer, gallery and project decisions. Members
retain their team view; public/nonmember content obeys draft visibility and
gallery audience. Public responses and authorized file streams use no-store
so a time or consent change cannot retain a privileged cached projection.

## Gallery and files

`GET /api/public/projects` accepts page/pageSize, challengeId and search and
returns `{items,total,page,pageSize}`. Detail is `/api/public/projects/:id`.
The same paths accept optional authenticated sessions for attendee galleries.
Batch projections use a fixed number of queries across a page.

Gallery consent is independent of badge-directory consent:
`GET/PUT /api/me/project-gallery-consent` carries `{showName,showPhoto}`.
Names default to visible; photos default to hidden. Opt-in explicitly covers
potential public indexing. Team reads retain private member names and invitation
statuses; nonmembers receive only active, consented display information.
Photo reads recheck current consent and project visibility on each request.

Multipart `POST /api/me/projects/:id/uploads?fieldKey=...` sniffs PNG/JPEG/WebP
or PDF bytes, enforces field type/size limits and writes an idempotent project
object key. Images receive WebP thumbnails. File answers are objectKey strings;
the DTO's `files` array provides authorized original/thumbnail URLs.
Storage keys alone grant no access. Project deletion removes its storage prefix;
H54 inventories originals and thumbnails uploaded by the removed subject before
scrubbing database memberships and consent.

## Queue and judging

Draft creation never creates queue entries. Submitted project intent feeds queue
generation; H21 corrections enter a generated queue at its end and withdrawal
records one transition and compacts positions. H30 membership derives solely from
active native memberships, retaining ordered advisory locks across teams sharing
a member. `project_eligibility` evaluates submitted status, explicit exclusion
and configured team-size limits even when event settings have no singleton yet.
Migration `0705_native_projects.sql` is the single migration that introduces the
native model; earlier applied migrations are immutable and still mention retired
integration vocabulary.

## Teams, invitations and challenge intent

`POST /api/me/projects` creates a draft (H19; allowed while the draft phase is
open) and `GET /api/me/projects` returns `{projects,canCreate}`. Members invite
by email with `POST /api/me/projects/:id/invites`; the invitee answers with
`POST /api/me/projects/:id/invites/accept|decline` and sees pending invitations
at `GET /api/me/projects/invites`. Accepting locks the project and enforces
`projectMaxTeamSize`. `PUT|DELETE /api/me/projects/:id/challenges/:challengeId`
edit intended challenges; mandatory challenges are added automatically and
cannot be withdrawn (H17). `GET /api/projects/estimates` gives staff and
sponsors per-challenge project counts from the same stores and scope.
Staff create/edit projects with `POST /api/repos` and `PUT /api/repos/:id/draft`
and enrol or withdraw all projects with
`POST /api/challenges/:challengeId/repos/bulk-add|bulk-remove` (H21), audited in
the same transaction.

## Winner publication (H46, #1010)

Challenge winners stay private until revealed. `GET|PUT
/api/challenges/:id/winners/publication` read or schedule `{publishAt,publishedAt}`
and `POST /api/challenges/:id/winners/publish` reveals them now (idempotent).
The scheduled reveal runs in the existing 15 s visibility tick
(`challenges/visibility-publisher.ts` calling `winner-publication.ts`) using the
SQL clock. Before reveal, public challenge feed/detail, the native gallery and
`GET /api/tv/winners` omit winners; after reveal TV returns
`{winners:[{challengeId,challengeTitle,rank,repoId,repoName}]}` and gallery
badges omit repo fields. Reveal emits one public `DATA_CHANGED` after commit;
private winner edits never trigger public invalidation (`lib/sse-routing.ts`).
A winner may be a project entered in any challenge of the same queue group.
Regression coverage: `test/challenges/winner-publication.test.ts`.
