# Web help desk (H61–H67)

The authenticated `/help-desk` experience uses the [help desk API
contract](./help-desk-contract.md). All reads and mutations go through `lib/api.ts`;
production has no substitute data. `domain:helpdesk` invalidates directory,
request and coverage views through the existing live-query transport and its
recovery policy. Directory and coverage reads also refresh every minute while
visible, because availability boundaries and venue presence can change independently
of help desk writes.

## Routes and access

| Route | Purpose | Access |
| --- | --- | --- |
| `/help-desk` | Support team: search by name or knowledge; Role and Knowledge filters; each row shows the role as a capsule at the right edge and the company after the name | Any browse capability |
| `/help-desk/helpers/:userId` | The helper's public profile (same `PersonProfile` as people), schedule and presence | Any browse capability |
| `/settings/profile?tab=help-desk` | Help desk tab: publish, knowledge, availability, challenge limit (`/help-desk/profile` redirects here) | API eligibility, including accepted mentors before their role is assigned |
| `/help-desk/requests` | Create and follow individual and team requests | `HELPDESK_REQUEST` |
| `/help-desk/requests/:id/requester` | The requester's public profile (same `PersonProfile`), when the API's `requesterProfile` is non-null | Helpers who can read the request |
| `/help-desk/requests/:id` | Follow a request, including notification links | API-authorized requester, team member, helper or coverage reader |
| `/help-desk/inbox` | Open and personally assigned requests, claim/release/resolve | `HELPDESK_OFFER` |
| `/help-desk/coverage` | Event coverage timeline, topic counts and current presence | `HELPDESK_COVERAGE` |

The header's gear menu holds Coverage (`HELPDESK_COVERAGE`) and My support profile (eligible people, → Settings › Help desk); the tabs keep Support team, My requests and Inbox. Topic pickers allow adding to the catalogue only in the support profile (`allowAdd`). Coverage bars show their count when slots are 1 h or wider. The personal sidebar entry uses capability constants. Each page renders
`HelpDeskSectionHeader` (title plus sibling links) as Home and Projects do; there
is no layout. The helper record renders the people reader's `PersonProfile`
(`people/[userId]/person-detail.tsx`) from the API's `profile`, followed by the
Role row (company included), current presence and the schedule; knowledge falls back to the card's topics. Publishing is the consent that shows that
public profile to help desk users; it never enables networking sharing.

Helpers edit in My profile: the Public profile tab owns the bio, headline and
CV (the same fields a badge scan shows), and its own **Help desk** tab
(`?tab=help-desk`) renders the same `PublicProfileCard` editor (preview, in-place editing, save) for people with event access, then `settings/profile/helper-section.tsx`: the publish
switch, the availability plan, knowledge and, for sponsor representatives with
own challenges, "Only requests about my challenges". Publishing also turns the
public profile sharing on (the API does it; unpublishing leaves it). The tab is
shown by `visibleProfileTabs(helperEligible)`, so accepted mentors without
event access still reach it.

## Interaction rules

Knowledge uses one searchable `MultiSelect` catalogue across profile and request
forms. New topics use the catalogue endpoint; in the request form Other is the
pinned first row of the same list, exclusive with the catalogue topics (`TopicsPicker`'s `other` prop). The request form also
picks a challenge (None, then the requester's project challenges, then the
rest, from `/api/helpdesk/challenges`) and a "Prefer a sponsor" switch.
Request rows and detail show the challenge and the sponsor preference. Request
help is the primary header action of every help desk page
(`requests/request-help-action.tsx`), for `HELPDESK_REQUEST`.
Personal/team selection uses the API's active-project list. Team updates use the
same authorized request projection, including meeting instructions and allowed
actions. API business errors use the existing localized error-reason resolver.
A successful inbox claim opens Assigned to me so meeting instructions and lifecycle
actions remain in view. A lost concurrent claim retains a visible explanation and refreshes the inbox.
Controls disable during writes; the API client preserves mutation intent keys
through transport retries.

Availability ("When do you plan to be at the venue?") is a complete replacement of
up to 30 dated intervals, edited in `availability-editor.tsx`: intervals are rows
grouped by event day ("Sat 27 · 10:00–13:00") over a compact 24 h track
(`schedule-view.tsx`). Add opens a from/to date-time dialog prefilled with the
API's `suggestedInterval` (hacking window); order, overlap and over-24 h errors
show inline, and each row has a labelled Remove. Every change
saves immediately. Times use the event time zone (`useEventTimeZone`); grouping
and validation live in `schedule.ts`. Stated availability and venue presence
always render as distinct states.

Coverage (`coverage/`) shows, for organizers: Right now (scheduled and inside,
scheduled, inside the venue), a per-day bar timeline of helpers scheduled per slot
with a legend (scale reads "0–N people"), the current-time line, gap markers for slots with no helper, a
slot detail, and a knowledge table with gap flags. `coverage-model.ts` derives
the view; bars are keyboard-navigable. Historical and future slots never acquire
a fabricated presence count.

Requests render with `RequestTable` (rows on narrow screens) and `RequestDetail`;
The inbox lists open requests in queue order (oldest first) and shows "#N in queue" in each row's secondary line. A requester can edit an open request (`viewer.canEdit`): Edit opens the request form prefilled, an alert confirms that editing moves it to the end of the support queue, and saving sends `PATCH /api/helpdesk/requests/:id`; the detail shows the new `queuePosition`. Claimed requests hide Edit. Claim opens a short dialog (on my way / meet at). In the detail, the claiming
helper's name links to their helper record.

Normal notification inbox messages in the `helpdesk` category link to the
request using its numeric ID. Internal delivery fields are not rendered as
message details. Empty, loading, retryable failure and denied states use existing
shared components. Copy is supplied in Spanish, Galician and English in the web
locale resources, maintained by the shared workstream.

## Verification

`schedule.test.ts` covers grouping, adjacent, overlapping, invalid and overlong
availability; `coverage-model.test.ts` the coverage derivation.
`request-list.test.tsx` covers pending claim controls, the exact claim body,
concurrent-claim feedback, removed identities and the helper link. Profile page
tests cover the helper section and eligibility-based tab. Navigation tests cover
the separate capabilities. API integration tests own routing, transaction
concurrency, authorization, notification idempotency and team visibility.


The Support team role label and role filter use the person's highest assigned
visible role (`visibleRoleName`, H8); `kind` remains the routing/coverage category.
The company is separate. The Public profile and Help desk tabs share a single
mounted public-profile editor, so switching tabs preserves one pending draft.
