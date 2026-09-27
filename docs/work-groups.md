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
members, never pending or declined invitees.

The stored `presentation_timing_preference` (`no_preference | early | middle |
late`) is consumed as a soft ordering input when a queue group is first
generated: linked repos preferring early, middle, or late are placed near that
part of the initial logical queue. It never overrides an existing queue's
operational order, manual moves, or queue safety rules; a shared queue still
shows and calls one logical entry per repo. The nullable `devpost_url` and
nullable unique `linked_repo_id` remain stable contracts: #854 will link
imports, and #856 can use intended-challenge membership for sponsor-scoped
recipient resolution. None of that conversion, Devpost matching, or
notification behavior is implemented here.

## Participant project-like view (#852, #854)

`/my-project` is **My projects**: it presents planned groups alongside projects
in one compact record list. Each record starts with its name and lists the
challenges it targets. Imported/native projects render the live queue state
(position, room and status) in those challenge rows; planned groups render the
same rows as planned until they become operational. The legacy `/my-queue`
route redirects here, so queue state never becomes a second, competing view.
Selecting a group opens `/my-project/work-groups/:id`. Active
members can edit the name, description, Devpost/GitHub/demo URLs and stored
timing preference, manage invitations and intended challenges, or delete the
planning record. Deletion cascades only through planning rows and is audited;
it never deletes a linked `repos` row or queue history.

The challenge lineup and deletion close when the scheduled judging period
starts. A group linked to an imported project also cannot be deleted. Metadata
— especially the Devpost URL used for exact linking — remains editable, so an
import can still reconcile the planned group after that point.

## Devpost import linkage (#854)

A valid Devpost project URL is the authoritative signal. On import, an
otherwise-unlinked group links only when its URL and the imported
`repos.devpost_url` agree after case and trailing-slash normalization; a valid
stored URL never falls back to inference.

Without a valid URL, the importer may link only when one and only one planned
group has the complete resolved Devpost roster **and** the exact same non-empty
set of intended challenges as the imported project's mapped prize challenges.
Both sides must have exactly one candidate. Missing identities, unmatched
participants, a challenge mismatch, or any candidate tie leave every group
unlinked for manual review. Names, titles, partial rosters, and fuzzy URL/slug
matches are never link signals. These links are audited in the same import
transaction and do not alter planning metadata, members, preferences, or queue
history.
