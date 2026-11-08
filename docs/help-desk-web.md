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
| `/help-desk` | Search published helpers by name or knowledge | Any browse capability |
| `/help-desk/helpers/:userId` | The helper's public profile (same `PersonProfile` as people), schedule and presence | Any browse capability |
| `/settings/profile?tab=public` | Helper section: publish, knowledge, availability (`/help-desk/profile` redirects here) | API eligibility, including accepted mentors before their role is assigned |
| `/help-desk/requests` | Create and follow individual and team requests | `HELPDESK_REQUEST` |
| `/help-desk/requests/:id` | Follow a request, including notification links | API-authorized requester, team member, helper or coverage reader |
| `/help-desk/inbox` | Open and personally assigned requests, claim/release/resolve | `HELPDESK_OFFER` |
| `/help-desk/coverage` | Event coverage timeline, topic counts and current presence | `HELPDESK_COVERAGE` |

The personal sidebar entry uses capability constants. Each page renders
`HelpDeskSectionHeader` (title plus sibling links) as Home and Projects do; there
is no layout. The helper record renders the people reader's `PersonProfile`
(`people/[userId]/person-detail.tsx`) from the API's `profile`, followed by the
current presence and the schedule. Publishing is the consent that shows that
public profile to help desk users; it never enables networking sharing.

Helpers edit everything in My profile → Public profile: the public profile form
owns the bio and headline (fields stay editable while published even if the
badge-scan switch is off), and `settings/profile/helper-section.tsx` adds publish
with consent copy, the knowledge picker and availability. The tab is shown by
`visibleProfileTabs(helperEligible)`, so accepted mentors without event access
still reach it.

## Interaction rules

Knowledge uses one searchable `MultiSelect` catalogue across profile and request
forms. New topics use the catalogue endpoint; requests offer Other separately.
Personal/team selection uses the API's active-project list. Team updates use the
same authorized request projection, including meeting instructions and allowed
actions. API business errors use the existing localized error-reason resolver.
A successful inbox claim opens Assigned to me so meeting instructions and lifecycle
actions remain in view. A lost concurrent claim retains a visible explanation and refreshes the inbox.
Controls disable during writes; the API client preserves mutation intent keys
through transport retries.

Availability is a complete replacement of up to 30 dated intervals, edited in
`availability-editor.tsx`: intervals are rows grouped by event day ("Sat 27 ·
10:00–13:00") over a compact 24 h track (`schedule-view.tsx`). Add opens a dialog
with day and from/to times; overlap and over-24 h errors show inline, an
interval may end after midnight, and each row has a labelled Remove. Every change
saves immediately. Times use the event time zone (`useEventTimeZone`); grouping
and validation live in `schedule.ts`. Stated availability and venue presence
always render as distinct states.

Coverage (`coverage/`) shows, for organizers: Right now (scheduled and inside,
scheduled, inside the venue), a per-day bar timeline of helpers scheduled per slot
with a legend, the current-time line, gap markers for slots with no helper, a
slot detail, and a knowledge table with gap flags. `coverage-model.ts` derives
the view; bars are keyboard-navigable. Historical and future slots never acquire
a fabricated presence count.

Requests render with `RequestTable` (rows on narrow screens) and `RequestDetail`;
Claim opens a short dialog (on my way / meet at). In the detail, the claiming
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
