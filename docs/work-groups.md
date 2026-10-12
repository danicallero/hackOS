# Planned work groups — issue #852

`work-groups` is the deliberately pre-event planning boundary. A group is not
a `repos` row and intended challenges are not `queue_entries`: creating,
editing, inviting, accepting, declining, or changing intent never starts
judging or mutates the operational project model.

Participants with current event access use `/api/me/work-groups`. Creating a
group, like creating a native project, requires the event's
`participants_can_create_projects` setting. The creator
is the first active member; invitations are `invited` until that exact account
accepts or declines. Every write locks the relevant rows and writes an audit
row in the same transaction. `GET /api/work-groups/estimates` gives
`PROJECTS_READ` staff all challenges, while sponsor representatives see only
their own enterprise's challenges; counts include distinct groups and active
members, never pending or declined invitees. Mandatory challenges are effective
intent for every group, including groups created before the setting changes;
they cannot be withdrawn. This projection never creates queue entries.
Estimates include `projectCount` and `expectedCount`: expected projects are the
union of unlinked planned groups and submitted projects, so conversion never
doubles the forecast and imported challenge corrections replace planned intent. Sponsor scope stays limited
to the representative's enterprise.

Participant self-service changes are restricted when Event Settings defines a
custom participant window. With both bounds blank, groups retain their legacy
open planning behavior for events that have not configured a schedule; a
custom bound can close or reopen that editing window.

The stored `presentation_timing_preference` (`no_preference | early | middle |
late`) is inherited by the project on linkage and consumed as a soft ordering
input when a queue group is first generated: projects preferring early, middle,
or late are placed near that
part of the initial logical queue. It never overrides an existing queue's
operational order, manual moves, or queue safety rules; a shared queue still
shows and calls one logical entry per repo. The nullable `devpost_url` and
nullable unique `linked_repo_id` connect import reconciliation and initial
queue ordering. Intended-challenge membership also supplies sponsor-scoped
notification recipients (#854, #856).

## Participant project-like view (#852, #854)

`/my-project` opens the participant's only project directly, whether planned
or imported. Multiple records, or pending invitations, retain the compact
record list, with one bordered section per project (never per member or
challenge). `/my-project?view=all` explicitly opens that list and its creation
action; the record's overflow menu keeps it reachable. Each record starts with
its name and lists the challenges it targets. Imported/native projects render
each queue independently (position, ETA, rooms and status); a team can wait in
several queues at once. Detail pages use open sections and a wider challenge
column beside the team, stacking on narrow screens. Quiet heading and row
hairlines keep independent queues clearly separated. Static metadata uses text,
with badges reserved for queue states. The legacy `/my-queue`
route redirects here, so queue state never becomes a second, competing view.
Participants see only **projects**: one creation action creates the planning
record, and sections and editors use the same project terminology in both stages.
Selecting a group opens `/my-project/work-groups/:id`; after linking, that URL
opens `/my-project/projects/:id` when the caller is an active imported member.
There is no separate linked/imported-project notice or duplicate card. Active
members can edit the name, description, Devpost/GitHub/demo URLs and stored
timing preference, manage invitations and intended challenges, or delete the
planning record via the record's overflow menu and confirmation dialog.
The timing field is labelled “Judging preference”. Deletion cascades only
through planning rows and is audited;
it never deletes a linked `repos` row or queue history.

The same metadata editor remains available after linking. For active project
members its changes update project metadata in the same audited transaction;
editing a preference alone preserves imported metadata. An unchanged preference
does not block metadata edits after queue generation. Pending members accept or
decline in the project view and never gain edit controls through an invitation.
An established link survives later URL edits.

Project overview and detail views share `PresentationStatus`: logical queue
rank (one project per shared queue), estimated waiting minutes and all possible
rooms until called, then the assigned room. Participant views refresh on their
personal queue stream; staff/sponsor project views use payload-free public queue
invalidations to refetch their authorized projection.

The challenge lineup and deletion close when the scheduled judging period
starts. A group linked to an imported project also cannot be deleted. Metadata
— especially the Devpost URL used for exact linking — remains editable, so an
import can still reconcile the planned group after that point.

## Devpost import linkage (#854)

A valid Devpost project URL is the authoritative signal. On import, an
otherwise-unlinked group links only when its URL and the imported
resolved Devpost identity agree. Public `/software/` and exported event
`/submissions/` URLs are supported, including query strings and trailing slashes.
Event URLs are resolved through bounded, Devpost-only redirects before opening
the database transaction; successful identities are cached on both records.
Unavailable or unsafe redirects never block an import or trigger a guessed link. A valid
stored URL never falls back to inference.

When a code or exact URL link is established, planning membership remains
separate from the imported roster. Participant differences are surfaced rather
than unioned. Accepted planning members retain relationship access; pending
invitations never confer membership. Verified email aliases count as one person. Imported name and description win when linking. Saving a group URL also
reconciles existing imports, including records imported before identity caching.

Without a valid URL, the importer may link only when one and only one planned
group has the complete resolved Devpost roster **and** the exact same non-empty
set of intended challenges as the imported project's mapped prize challenges.
Both sides must have exactly one candidate. Missing identities, unmatched
participants, a challenge mismatch, or any candidate tie leave every group
unlinked for manual review. Names, titles, partial rosters, and fuzzy URL/slug
matches are never link signals. Links, roster additions and preference inheritance
are audited in the same transaction. Projects store their own presentation
preference, defaulting to `no_preference` and inheriting the group's on linking.
It remains editable until the first queue entries for that
project are generated; then it is locked.


## Native submission and recovery

Planning projects now have a stable, copyable reconciliation code. Participants
can Submit project without Devpost; this creates the linked operational repo,
preserves the code and preference, copies accepted membership and intended
challenges, and saves a locked submission snapshot. All participant mutations
respect the linked repo's explicit lock. Request edits sends an organizer
request; approval reopens the project with history retained and requires a new
submission. See [Projects lifecycle](./challenges-devpost.md#project-submission-lifecycle-h6-h16h21-h30-h53)
and [the audit](./project-lifecycle-audit.md). Existing links are never replaced
by heuristic matching on a later import. After the deadline, planning records
with no submission remain visible as not submitted; they are not deleted.
