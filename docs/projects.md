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
fields with `validation.text_condition="url"`. A project text question can also
opt into YouTube validation and presentation with `project_video: true`. A single image is a file field
with image MIME types; a photo list is an `images` field (project form only,
up to `MAX_IMAGES_PER_FIELD` keys). One text field is the project description
(`project_description: true`, else a text field keyed `description`; see
`projectDescriptionField`): saving a draft copies its answer into
`repos.description`, and a project whose answer is empty shows its existing
description in that field, so lists, the gallery and cards all read one value.
Imported descriptions with flattened `## Heading` sections are normalized for
display and summarized as plain clamped text in lists
(`apps/web/src/lib/project-text.ts`). `GET/PUT /api/projects/form` reads or versions the definition;
writes require project editing and record a transactional audit.

`PUT /api/me/projects/:id/draft` accepts `{responses,revision}`. The project row
is locked and revision must match before saving. A stale save receives 409 and
never replaces a newer draft. Submission validates required fields and verifies
that uploaded file keys belong to this project and field. Required fields are
not enforced during autosave. A submitted project is frozen for participants
(H20, H21): edits, invitations, challenge enrolment and the GitHub link answer
409 `project_frozen`. Inside the submission window a member calls
`POST /api/me/projects/:id/withdraw-submission` (`canWithdraw`), which returns the
project to a plain draft (`submitted_at` cleared, so the deadline still binds),
then edits and submits again. Leaving, deleting and withdrawing from a challenge
stay available. Staff with `projects:edit` return a submitted project with
`POST /api/projects/:id/unlock` (`decision: "unlock"`, reason required), which
keeps `submitted_at` so the team may resubmit after the deadline; staff edits
never need it. Submission history remains immutable and gallery projections use the
last submitted snapshot and its form version. With `project_github_required`
(Event settings → Projects) submission needs a linked repository or one entered
by staff, else 400 `project_github_required`.
Staff answer corrections use `PUT /api/repos/:id/draft` with the same revision
contract, audited independently of participant windows (H21/H53).

## Phases and reads

Event settings use the existing `GET/PUT /api/event` transaction and save scope.
Fields are `projectDraftsOpenAt`, `projectSubmissionsCloseAt`,
`projectDraftVisibility`, `projectGalleryOpensAt`, `projectGalleryAudience`
and `projectMaxTeamSize`. Editing and submission close together at `projectSubmissionsCloseAt`. Missing draft/submission bounds
inherit the hacking window. A missing gallery opening means closed. PostgreSQL
compares boundaries to `now()`; API host time does not authorize operations.

`projects/policy.ts` owns phase, viewer, gallery and project decisions. Members
retain their team view; public/nonmember content obeys draft visibility and
gallery audience. Public responses and authorized file streams use no-store
so a time or consent change cannot retain a privileged cached projection.
The web gallery refreshes its server projection on public invalidations and
every 15 seconds for SQL-clock phase boundaries. Consent changes emit only a
payload-free public invalidation. The configured web origin may make credentialed
public reads for attendee-only galleries and winners; external catalogue origins
retain anonymous wildcard CORS.

## Gallery and files

`GET /api/public/projects` accepts page/pageSize, challengeId, search and winnersOnly=true and
returns `{items,total,page,pageSize}`. The winner filter applies before pagination
and includes only published, visible winners; combined with challengeId it
selects winners of that challenge. Unpublished selections never affect its count. Detail is `/api/public/projects/:id`.
The same paths accept optional authenticated sessions for attendee galleries.
Batch projections use a fixed number of queries across a page.

The public landing page includes a gallery section. `/gallery` and its project
records retain the shared application shell and navigation when signed in;
anonymous visitors get the public brand, language/theme controls and sign-in
entry. Both contexts use the same server projection and audience rules. The
listing uses the shared list toolbar with search and challenge filters, resetting
pagination when either changes. Published winners show a trophy and localized
rank on both the list and record. Cards share equal grid tracks, show consent-aware
team avatar groups at the foot, and preview two challenge names with a popover
for the complete challenge list without expanding the grid. Records include challenges, all authorized
files for each field, choice labels and the visible team. Gallery navigation,
challenge links and external files/demos use shared Button variants with
Phosphor icons; record sections use the open SectionCard layout.

A member's photo on project data follows their public profile (#934): it is
shown exactly when the profile is visible (`directory_visible` with consent)
and shares its photo (`show_photo`); there is no separate gallery photo
consent. Names default to visible (`users.gallery_show_name`); nonmember list
and detail projections return a null name when it is off, including after
submission; active teammates retain their private roster names. Team reads
retain private member names and invitation statuses; nonmembers receive only
active display information. Photo reads recheck the public profile and project
visibility on each request.

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
Migration `0705_native_projects.sql` introduces the native model. Applied files
in `apps/api/db/migrations/` are checksum-enforced and immutable, including the
retirement migration itself; `apps/api/db/migration-history/` preserves retired
development history and is never applied. Both directories may mention retired
integration vocabulary and must not be rewritten to erase that history (#1005).

The existing `pnpm check:retired-auth` lint guard also rejects retired project
integration names in API source/scripts/tests, web source, mobile source/tests,
shared source/locales and root scripts. It checks vocabulary case-insensitively
and includes a regression suite that introduces forbidden tokens. SQL history,
documentation retirement notes, generated output and the guard's own definition
and tests are outside this runtime check. Ordinary scanner or Live Activity
reconciliation remains supported.

Until #1016 removes secondary email, only the exact existing `en`, `es` and `gl`
values at `web.json:devpostEmailPlaceholder`, `web.json:willUseToMatchDevpost`
and `email.json:mail.auth.verifySecondaryEmail.body` are temporarily exempt.
The guard pins each path/key/value digest, so another key, file or edited value
cannot reuse the exception. Remove these nine exceptions and their dedicated
test when #1016 lands; no project import capability or compatibility export
remains.

## Teams, invitations and challenge intent

`POST /api/me/projects` creates a draft (H19; allowed while the draft phase is
open) and `GET /api/me/projects` returns `{projects,canCreate}`. Members invite
by email with `POST /api/me/projects/:id/invites`; the invitee answers with
`POST /api/me/projects/:id/invites/accept|decline` and sees pending invitations
at `GET /api/me/projects/invites`; `invitedBy` is the active inviter’s display
name (or null), never an internal user ID. Accepting locks the project and enforces
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

## Project form exports and video presentation (H16/H54)

The organizer creates all questions, choices, required flags and sections in the
existing dynamic form editor. Saving preserves that definition exactly; no
external reporting template, special answer keys or mandatory questions are
injected. Event-specific requirements belong in the event's form definition.

Organizers with `exports:run` download `/api/exports/projects.csv` from Projects.
The CSV includes project metadata, one column per configured question, challenge
selections and separate first/last/email columns for the active submitter and
additional members. Drafts use the current form. Submitted answers use their
immutable form version, and deleted historical questions retain a column so
submitted data is not lost. Choice answers use the form version's display labels.
Fixture projects and anonymized members are excluded. Downloads are audited,
private/no-store and neutralize spreadsheet formulas. Gallery audience settings
still control access to the exported post-event project URLs.

Any project text question can be marked **YouTube video** in the editor's options;
the persisted `project_video` property controls validation and presentation,
independently of the question key or label. Supported HTTPS links include watch,
shorts, embed and youtu.be with an eleven-character video ID. Drafts may remain
incomplete; submission validates only the questions and video fields configured
in the form. The web editor and gallery show a video preview, load a
privacy-enhanced embed on activation, and retain a direct YouTube link.
Gallery answers preserve authored section order, hide empty optional answers,
render descriptions as Markdown and display images in an adaptive media grid.

A project URL text question can also be marked **Judging panel link** (`judging_link: true`);
its answer appears beside the repository and demo links as an action in the judging panel.

## One participant project workspace

Participants open one record in reading mode and use **Edit project** to edit the
same questions in the same two-column workspace. Empty new drafts start in editing
mode. **View project** saves pending answers before returning to the shared reading
presentation. Team and challenge actions are available while editing. The gallery
uses the same `ProjectAnswers` renderer, and an active member's edit action opens
this workspace directly. The judging presentation panel can expand the same answers,
media and files without leaving its timer or review. Project loading errors stay
visible with retry rather than silently replacing the project with empty content.

`library` questions use [question-owned catalogues](./form-libraries.md): proposal
and curation belong to the field, not to event-level Libraries. Their answers and
CSV exports are arrays of human-readable names, with no count limit.

Project editor fields validate on blur, including phone normalization, required
consent and configured text/number/selection constraints. Inline errors use the
same validator as applications and staff response editing. Submission repeats
validation and focuses the first invalid field; incomplete drafts still autosave.

The management list (`/projects`) presents CSV export as a secondary header
action beside project creation. Export remains gated by `exports:run`,
independently of the ability to create projects.

## Unified inspection and administration (H18–H21)

Gallery, a participant's own record and staff inspection use `ProjectOverview`
for authored answers, team, challenges and queue state. A record title is the page
heading; the shared navigation links My projects, Gallery and Manage projects
according to access. Staff records open in reading mode, including drafts; editing
is an explicit action. A new empty participant draft still starts in the editor.
Returning to reading waits for answer persistence. An incomplete staff record
shows its missing/invalid questions alongside the normal overview.

Participant read/edit flags honor organizer locks and approved reopening after
the normal deadline. A submitted team's working changes remain private until
resubmission; the workspace says when changes are not yet submitted and offers
Update submission. Staff corrections instead append a new authoritative admin
version. Previous participant and administrative snapshots are never rewritten.

Create project in management creates on behalf of selected people, never adds
the operator implicitly, and collects challenge choices and dynamic answers.
The interface requires at least one selected member and links their existing
projects so staff can inspect one before creating another; multiple projects
per person remain supported. Staff may leave questions
incomplete for later correction; uploads are added after the project exists.
The API validates provided answers and library values transactionally with the
roster, description, challenge enrollment and submission snapshot.

An explicit staff challenge enrollment appends even a draft to an existing queue,
including after participant editing closes. A draft remains ineligible to be
called until submitted. Repeat enrollment does not duplicate an active entry;
withdrawal still records history and compacts the queue.

### Access boundaries

| Viewer | Gallery list | Project inspection | Editing |
| --- | --- | --- | --- |
| Anonymous visitor | Opening time, public audience, configured draft visibility | Publicly visible records and submitted snapshot | Never |
| Admitted attendee | Opening time and attendee/public audience | Own team always; other records follow visibility | Active team within window, unlocked or explicitly reopened |
| Project reader | May preview gallery before opening | All records in their fixture boundary | Never without edit capability |
| Project editor | Same preview access | All records, independently of participant windows | Audited staff corrections |
| Assigned judge / sponsor | Normal gallery audience rules | Only projects entered in their enterprise's challenges, before or after queue generation | Never without edit capability |

`canInspect` is computed from the exact server-side project scope, so a public
record never links a judge to an unrelated enterprise's management record.
Scoped readers see the last submitted answers, not a teammate's unpublished
working changes. File authorization uses the same scope, including before the
public gallery opens. A judge-panel capability alone grants no global project
read access. Test fixtures remain isolated from real records.

Gallery records omit hidden challenges even for a team preview; personal and
authorized management inspection retain their intended challenge lineup. Public
readers see consented active members only. Team file access accepts both their
working-copy and submitted-gallery attachments, while nonmembers remain limited
to the submitted projection.
