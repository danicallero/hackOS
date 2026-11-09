# Help desk (H61-H67)

Participants ask for help; mentors, sponsor representatives and staff offer
it. Endpoint shapes for clients live in
[`help-desk-contract.md`](./help-desk-contract.md); route schemas in
`/documentation` carry the same rules. Module:
`apps/api/src/modules/helpdesk/`. Tests: `apps/api/test/helpdesk/`.
Migration: `0901_help_desk.sql` includes the complete unmerged PR schema, challenge routing and FCFS edits.

## Who can do what (H8)

| Capability | Seeded on | Grants |
| --- | --- | --- |
| `helpdesk:offer` | Mentor, Sponsor, Organizer, Day Staff, Event Director | Own helper profile and availability, helper inbox, claim/release/resolve |
| `helpdesk:request` | Participant, Event Director | Browse helpers, open/cancel/resolve own and team requests |
| `helpdesk:coverage` | Organizer, Event Director | Coverage view (H67) |
| `helpdesk:manage` | Event Director | Rename and merge catalogue topics |

**Eligibility.** A helper is eligible while they hold `helpdesk:offer`, or
have an accepted or confirmed application response to a form whose granted
role carries it. Application roles are granted only on confirmation
(H15), so the second clause is what lets an accepted mentor prepare their
profile right after acceptance (H61) without event access. Eligibility is
evaluated on every read: an ineligible helper's card disappears from
browsing, routing and coverage even if it was published, and they cannot
claim. The catalogue (`GET /api/helpdesk/topics`) also accepts eligible
helpers for the same reason; `POST` (adding a topic) is limited to eligible
helpers and `helpdesk:manage`, so requesters get 403 `helper_not_eligible`.

**Public role.** Cards and expanded profiles expose `visibleRoleName`: the highest-position assigned visible, non-deleted role, using the same identity projection as badges. Hidden roles are never exposed. This label is independent of routing kind; sponsor company stays in `affiliation`.

**Kind** (routing/coverage category only): `sponsor` when the person belongs to an enterprise
(`sponsors`), else `mentor` when they hold, or were accepted for a form
granting, the seeded Mentor role, else `staff`.

## Helper profile (H61) and availability (H62)

`helper_profiles` stores only the explicit publication (`published`,
`published_at`). Name, photo, headline and bio are projected from `users` and
`user_public_profiles`, never copied. The helper profile is the public profile:
the bio and every other field are edited only in the public profile editor, and
`PUT /api/me/helper-profile` takes `published`, `topicIds` and, for sponsors with challenges, `ownChallengesOnly`. Turning publication on also sets the public profile's `directory_visible` in the same transaction (audited as `directoryVisible`); unpublishing never unshares. `GET` adds `suggestedInterval` (hacking window, else event window) for prefilling availability. The helper
detail (`GET /api/helpdesk/helpers/:userId`) returns the directory's own entry
as `profile`, honouring the person's per-field switches; publication is the
consent for help desk readers, who also get the CV (while `share_cv` is on)
and photo routes for that helper. Publishing does not change
per-field sharing switches; publishing enables `directory_visible`, and sharing a public
profile alone does not publish a helper card. The card follows the public profile's
surname and photo switches; the photo route serves a published helper's photo
to anyone with a help desk capability while the photo switch is on.

Publishing needs at least one topic. While published, the topics also appear
as `helpTopics` on the person's #934 public-profile card (`DirectoryEntry`)
for the people who scanned them.

Availability is a set of dated intervals, replaced as a whole (≤30, each
≤24 h, no overlaps). It is a statement of intent only: venue presence comes
from H24 door scans (`time_logs`, latest scan is `in`), and neither creates
the other.

## Knowledge catalogue

`help_topics` is one self-service list shared by profiles and requests, like
the university picker: eligible helpers and catalogue managers can add a topic, and
equivalent names (case, accents, spacing; `name_key`) resolve to the existing
row instead of a duplicate. "Other" is not a row — requests carry `other` —
and its translations are reserved. `helpdesk:manage` renames topics and
merges duplicates (profiles and requests move to the target).

## Browsing (H63)

`GET /api/helpdesk/helpers` lists published, eligible, real (non-fixture)
helpers with topics, stated schedule, `scheduledNow`, `present` and
`availableNow` (actual presence; the stated schedule is advisory). Exposing `present` for published helpers is a
deliberate H63 requirement; nobody else's presence is exposed. Browsing
creates no diary contact and returns nothing beyond the card.

## Requests (H64-H66)

A request is individual or, with `projectId`, for one of the caller's active
projects (`submissions.status = 'active'`); every active member then follows
it, may cancel or resolve it, and receives the claim notice. Opening one
requires event access. At most one request is active (open or claimed) per
team, or per person for individual requests (partial unique indexes plus a
locked check), so double submits cannot open two.

**Routing (H65)** runs once, at creation, inside the creating transaction:

1. The audience is every listed helper currently present at the venue,
   excluding the requesting side. Planned availability intervals do not gate it.
2. Without Other, helpers knowing **any** requested topic are notified
   (`routing: matched`).
3. With Other, or when no audience member matches, the whole audience is
   notified (`fallback`).
   A sponsor who limited themselves to their own challenges
   (`own_challenges_only`) is a candidate only for requests about one of
   those challenges (a sponsor's challenges are those authored by any sponsor
   of the same enterprise, `sponsorChallengeIds` in `queue/reviews.ts`).
   Sponsors of the request's `challenge` match regardless of topic, in
   addition to topic matches.
3b. `preferSponsor` requires a selected challenge. With at least one available
   sponsor from that challenge’s company, only those sponsors are notified (`routing: sponsor`); otherwise routing continues
   as above. A limited sponsor also sees and claims only requests about their
   challenges in the inbox (others answer 404).
4. An empty audience leaves `routing: none`. The request still appears in
   every helper's open inbox; nobody is notified later automatically.

Each notified helper gets a `help_request_recipients` row and one inbox +
push notice (category `helpdesk`, email never). Helpers see every open
request in `GET /api/helpdesk/inbox?scope=open` in first-come, first-served
order (`queued_at`, then id); `viewer.notified` marks the ones routed to them.
Open requests carry `queuedAt` and `queuePosition` (1-based among all open
requests).

**Editing (H64).** The requester or a team member can `PATCH` an open request
(same fields and validation as creation). The row is locked `FOR UPDATE`, so a
simultaneous claim and edit serialize: an edit after a claim answers 409
`help_request_already_claimed`, a claim after an edit takes the edited request.
Editing sets `queued_at = now()` (end of the queue; `created_at` is unchanged),
re-runs routing and notifies only helpers who were not already recipients.
It is audited (`edited`, changed field names only) and broadcast once.

**Lifecycle.**

```text
open ──claim──▶ claimed ──resolve──▶ resolved
  ▲               │
  └───release─────┘
open / claimed ──cancel (requesting side)──▶ cancelled
```

- **Claim** (H66): a published, eligible helper picks `on_my_way` (to the
  requester's stated location) or `meet_at` with a location. The request row
  is locked `FOR UPDATE`, so exactly one concurrent claim wins and the rest
  get 409 `help_request_already_claimed`. A retry by the winner with the same
  meeting returns the claim without another notice; the route also has an
  `Idempotency-Key` guard. Helpers cannot claim their own or their team's
  request. Changing the meeting means release and claim again.
- **Release**: only the claimer; back to `open`, the requesting side is
  told, the original audience is not notified again.
- **Resolve**: only from `claimed`, by the claimer or the requesting side.
- **Cancel**: requesting side, from `open` or `claimed`; a claimer is told.

**Requester profile and presence.** `GET /api/helpdesk/requests/:id` adds
`requesterProfile` (the requester's directory entry) for helpers the request
was routed to, its claimer and `helpdesk:manage`, only while the requester
shares their public profile; the requester's photo and CV routes open for the
same viewers. A resolved request is a presence checkpoint at `resolved_at`
for the claimer and the requester (see the logistics section of
`docs/api-reference.md`): it never creates presence by itself.

Every transition is audited (`help_request` entity) in the same
transaction, and broadcasts `helpdesk.request.changed` `{requestId, status}`
to the personal stream of the requesting side, the routed helpers and the
claimer, plus a payload-free `domain:helpdesk` refresh.

## Coverage (H67)

`GET /api/helpdesk/coverage` counts listed helpers (mentor, sponsor and staff
alike) scheduled in each slot of the range (default: the event window), by
kind and by topic. For the current moment it separates `scheduled`, `present`
(H24) and `available` (actual presence, independent of schedule), per topic too, and lists topics of open
requests that no available helper covers.

## Realtime and notifications

- `domain:helpdesk` (`SSE_TOPICS.HELPDESK`): payload-free refresh for any
  help desk mutation, including `/api/me/helper-profile`; subscribing needs a
  help desk capability. Helper-profile writes also wake `domain:directory`,
  since they change the shared bio and `helpTopics`.
- `helpdesk.request.changed` on `user:<id>`.
- Notification templates `mail.helpdesk.*` / `push.helpdesk.*` in
  `packages/shared/locales/*/email.json` (`request`, `requestOther`,
  `onMyWay`, `meetAt`, `released`, `cancelled`). Payloads carry `kind` and
  `requestId` for deep links.

## Account removal and export (H54)

Anonymization deletes the helper profile (topics and availability cascade)
and routed-audience rows, clears `help_topics.proposed_by`, and detaches the
person from requests: their individual requests lose description and
location and are cancelled if active; team requests keep their text for the
team but lose the requester; a claim they held returns to `open`. The data
export includes `helperProfile` and the requests they opened.
