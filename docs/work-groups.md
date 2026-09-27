# Planned work groups — issue #852

`work-groups` is the deliberately pre-event planning boundary. A group is not
a `repos` row and intended challenges are not `queue_entries`: creating,
editing, inviting, accepting, declining, or changing intent never starts
judging or mutates the operational project model.

Participants with current event access use `/api/me/work-groups`. The creator
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

`/my-project` presents planned groups alongside projects using the same compact
record language; selecting one opens `/my-project/work-groups/:id`. Active
members can edit the name, description, Devpost/GitHub/demo URLs and stored
timing preference, manage invitations and intended challenges, or delete the
planning record. Deletion cascades only through planning rows and is audited;
it never deletes a linked `repos` row or queue history.

The linkage boundary is deliberately exact: confirming a Devpost import links
an otherwise-unlinked planned group only when `planned_work_groups.devpost_url`
equals the imported repository's canonical `repos.devpost_url`. Assigning that
same URL later performs the same lookup. There is no name, member, or fuzzy
matching; #854 can extend the model without changing this safety boundary.
