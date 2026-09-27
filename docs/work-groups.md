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
late`), nullable `devpost_url`, and nullable unique `linked_repo_id` are stable
data contracts only: #853 will consume the preference in queue generation,
#854 will link imports, and #856 can use intended-challenge membership for
sponsor-scoped recipient resolution. None of that conversion, ordering,
matching, or notification behavior is implemented by #852.
