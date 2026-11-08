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
| `/help-desk/helpers/:userId` | Published bio, knowledge, dated schedule and presence | Any browse capability |
| `/help-desk/profile` | Publish/unpublish, edit the shared public bio and knowledge, replace dated availability | API eligibility, including accepted mentors before their role is assigned |
| `/help-desk/requests` | Create and follow individual and team requests | `HELPDESK_REQUEST` |
| `/help-desk/requests/:id` | Follow a request, including notification links | API-authorized requester, team member, helper or coverage reader |
| `/help-desk/inbox` | Open and personally assigned requests, claim/release/resolve | `HELPDESK_OFFER` |
| `/help-desk/coverage` | Event coverage timeline, topic counts and current presence | `HELPDESK_COVERAGE` |

The personal sidebar entry uses capability constants. My profile also offers an
eligibility-based Helper profile action, so accepted mentors can prepare before
confirmation. The editor uses the existing account identity and `BioField`; the
API writes the same bio used by networking. Publishing helper visibility never
enables networking sharing. Published knowledge also appears on existing public
profile cards and scanned-person detail pages.

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

Availability is a complete replacement of up to 30 dated intervals. The client
checks ordering, overlaps and the 24-hour duration limit before sending the
replacement. Date/time controls and displays use the event time zone. Profile
and availability have separate save owners and unsaved-change guards. Stated
availability and actual venue presence always render as distinct states; a
scheduled helper outside the venue is never presented as available inside.

Coverage shows scheduled counts and knowledge for every returned time slot,
including gaps, independently of current scheduled/inside/available counts.
Historical and future slots never acquire a fabricated presence count.

Normal notification inbox messages in the `helpdesk` category link to the
request using its numeric ID. Internal delivery fields are not rendered as
message details. Empty, loading, retryable failure and denied states use existing
shared components. Copy is supplied in Spanish, Galician and English in the web
locale resources, maintained by the shared/API workstream.

## Verification

`apps/web/src/app/(app)/help-desk/model.test.ts` covers multi-day, adjacent,
overlapping, invalid and overlong availability. `request-list.test.tsx` covers
pending claim controls, the exact claim body, concurrent-claim feedback and
removed identities. Navigation tests cover the separate help desk capabilities.
Runtime screenshot evidence is captured outside the checkout; deterministic
browser API fixtures exercise real Next rendering without entering production
code. API integration tests own routing, transaction concurrency, authorization,
notification idempotency and team visibility enforcement.
