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
| `/help-desk` | Unified request selector: My requests for requesters, Open and My assignments for eligible helpers; directory available to every browser | Any browse capability |
| `/help-desk/helpers` | Support team: search by name, company or knowledge; Role, Knowledge and current-state filters; role at the right edge, company below the name, green presence dot on the avatar only when inside | Any browse capability |
| `/help-desk/helpers/:userId` | The helper's public profile (same `PersonProfile` as people), schedule and presence | Any browse capability |
| `/settings/profile?tab=help-desk` | Help desk tab: publish, knowledge, availability, challenge limit (`/help-desk/profile` redirects here) | API eligibility, including accepted mentors before their role is assigned |
| `/help-desk/requests` | Create and follow individual and team requests | `HELPDESK_REQUEST` |
| `/help-desk/requests/:id/requester` | The requester's public profile (same `PersonProfile`), when the API's `requesterProfile` is non-null | Helpers who can read the request |
| `/help-desk/requests/:id` | Follow a request, including notification links | API-authorized requester, team member, helper or coverage reader |
| `/help-desk/inbox` | Compatible entry to the unified selector, defaulting to Open for eligible helpers | `HELPDESK_OFFER` |
| `/help-desk/hours` | Opening hours editor (H64) | `HELPDESK_MANAGE` |
| `/help-desk/coverage` | Event coverage timeline, topic counts and current presence | `HELPDESK_COVERAGE` |

The header's gear menu holds Coverage (`HELPDESK_COVERAGE`) and My support profile (eligible people, → Settings › Help desk); the sibling navigation keeps Requests and Support team, with a live available count on the directory link. My requests, Open and My assignments share one `TabBar` on the entry screen. Open/My assignments require both `HELPDESK_OFFER` and server eligibility; request capability remains additive. Coverage-only viewers retain directory access without querying request lists. Topic pickers allow adding to the catalogue only in the support profile (`allowAdd`). Coverage bars show their count when slots are 1 h or wider. The personal sidebar entry uses capability constants. Each page renders
`HelpDeskSectionHeader` (title plus sibling links) as Home and Projects do; there
is no layout. The helper record renders the people reader's `PersonProfile`
(`people/[userId]/person-detail.tsx`) from the API's `profile`, followed by the
stated availability and any challenge restrictions. Its role capsule sits in the profile header;
company name and logo have their own row immediately before knowledge. Presence
is only a green dot at the avatar edge when inside (with a screen-reader label),
never an outside placeholder. Knowledge falls back to the card's topics. Publishing
also enables public-profile sharing; unpublishing support leaves that choice on.

Helpers edit in My profile: the Public profile tab owns the bio, headline and
CV (the same fields a badge scan shows), and its own **Help desk** tab
(`?tab=help-desk`) renders the same `PublicProfileCard` editor (preview, in-place editing, save) for people with event access, then `settings/profile/helper-section.tsx`: the
"Available to mentor" switch (publication), then the **Mentor profile** block in
the same order as mobile: "Challenge alerts" (checkboxes of the event's challenges, for any eligible helper;
none = every request); knowledge; and the
availability plan day by day (every day of the hacking window, else the event
window, with its ranges, a 24-hour track and an Add availability action
prefilled on that day; availability cannot start before the hacking time). Publishing also turns the
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
Creation and editing share `requests/request-editor.tsx`: closing a dirty form confirms discard within the owning modal, cancelling keeps the draft, and pending writes cannot dismiss it. Controls disable during writes; the API client preserves mutation intent keys
through transport retries.

Availability ("When do you plan to be at the venue?") is a complete replacement of
up to 30 dated intervals, edited in `availability-editor.tsx`: intervals are rows
grouped by event day ("Sat 27 · 10:00–13:00") over a compact 24 h track
(`schedule-view.tsx`). Add opens a from/to date-time dialog prefilled with the
first 24 hours of the API's `suggestedInterval` (hacking window); each existing interval also has Edit, replacing it atomically without deleting the saved interval first. Failed replacements retain the saved schedule and the editor draft; order, overlap and over-24 h errors
show inline, and each row has a labelled Remove. Every change
saves immediately. Times use the event time zone (`useEventTimeZone`); grouping
and validation live in `schedule.ts`. Stated availability and venue presence
always render as distinct states.

Coverage (`coverage/`) shows, for organizers: Right now (scheduled and inside the venue as independent totals, with no inferred intersection), a per-day bar timeline of helpers scheduled per slot
with a legend (scale reads "0–N people"), the current-time line, gap markers for slots with no helper, a
slot detail, and a knowledge table with gap flags. `coverage-model.ts` derives
the view; bars are keyboard-navigable. Historical and future slots never acquire
a fabricated presence count.

Requests render with `RequestTable` (rows on narrow screens) and `RequestDetail`.
The shared `ListToolbar`/`FilterMenu` provides text search plus simultaneous status
and challenge choices, persistent checkbox focus, removable chips and Clear filters.
My requests omits the caller's identity and current location, retaining project
context for team requests; meeting instructions keep the helper name and a requested
destination, while an on-the-way update does not repeat the caller's location.
Every status uses its own symbol and readable label; open reads "Waiting for support".
The directory's available count follows actual presence, independently of planned
intervals, and its filter options remain stable while text search changes.
The inbox lists open requests in queue order (oldest first) and shows "#N in queue" in each row's secondary line. A requester can edit an open request (`viewer.canEdit`): Edit opens the request form prefilled, an unchanged edit cannot be saved; an alert confirms that saving a change moves it to the end of the support queue, and saving sends `PATCH /api/helpdesk/requests/:id`; the detail shows the new `queuePosition`. Claimed requests hide Edit. Claim opens a short dialog (on my way / meet at). In the detail, the claiming
helper's name links to their helper record. Its identity section includes the shared avatar, highest visible role and company; the timestamp describes the current state (`claimedAt`, `resolvedAt`, `cancelledAt`, otherwise `createdAt`). Removed helpers keep an explicit removed-account fallback.

Normal notification inbox messages in the `helpdesk` category link to the
request using its numeric ID. Internal delivery fields are not rendered as
message details. Empty, loading, retryable failure and denied states use existing
shared components. Copy is supplied in Spanish, Galician and English in the web
locale resources, maintained by the shared workstream.

## Opening hours (H64)

`hours/` lets `HELPDESK_MANAGE` set when the help desk accepts new requests,
reached from the header options menu. `HoursEditor` lists the windows (event time
zone, `GET/PUT /api/helpdesk/schedule`), shows Open now / Closed with the next
change, and adds (prefilled from `suggestedInterval`), edits or removes a
window; each change saves the complete sorted replacement at once. No windows
means always open. Order and overlap are checked before the call; the API
refuses the rest. Closed only blocks creating: `useHelpdeskSchedule`
(`hooks/`) shares the schedule, rereads it every minute and at the next change,
and Request help is disabled (header action and form) with one line,
`HelpdeskClosedNotice`. Only an explicit `open: false` closes.

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

## URL compatibility and return context

`/help-desk`, `/help-desk/requests` and `/help-desk/inbox` render the same
workflow. No automatic redirect rewrites a bookmark. The inbox defaults to Open;
the other entries default to My requests when permitted, else Open. `?tab=mine`,
`?tab=open` and `?tab=claims` restore selection; `assigned` is accepted as a legacy
alias. Invalid or no-longer-authorized choices fall back to an available view.
`useUrlTab` keeps explicit selections stable during live refreshes. Request links
carry a validated `from` list URL so their labelled return link restores the
selected view, including after a reload; helper/requester profile links retain the same request and list return context, and directory navigation retains the selected view. Browser Back retains normal history.
Numeric notification links remain valid without `from` and use a capability-based
fallback. A successful creation opens My requests; a successful claim selects My
assignments.

Interaction tests cover capability combinations and eligibility, legacy entries,
deep links, query switching, claim-to-assignment, lifecycle actions, helper
identity and state timestamps, plus atomic interval editing with failure/retry
and a 36-hour suggested window. API tests remain the owner of FIFO/routing,
sponsor scope, concurrency and notification delivery; this web-only change does
not modify those contracts. The web editor renders project/challenge lookup failures in place and only opens edits from a loaded request; mobile-side fixes are reviewed separately.
