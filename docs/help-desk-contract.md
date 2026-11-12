# Help desk API contract (H61-H67)

Contract between the API (`apps/api/src/modules/helpdesk/`) and the web and
mobile clients. Shapes here are normative for the clients; the route schemas'
`description` fields in `/documentation` carry the same rules. Lifecycle,
routing and privacy decisions are explained in [`help-desk.md`](./help-desk.md).

All routes are under `/api`, need a session, and answer JSON. Timestamps are
ISO 8601 strings in UTC. Mutations take an `Idempotency-Key` header (same
key + same body = same response, no second write or delivery).

## Capabilities (`@hackos/shared/capabilities`)

| Constant | String | Grants | Seeded on |
| --- | --- | --- | --- |
| `HELPDESK_OFFER` | `helpdesk:offer` | Own helper profile and availability; helper inbox; claim/release/resolve | Mentor, Sponsor, Organizer, Day Staff, Event Director |
| `HELPDESK_REQUEST` | `helpdesk:request` | Browse helpers; create, follow and cancel own/team requests | Participant, Event Director |
| `HELPDESK_COVERAGE` | `helpdesk:coverage` | Coverage view (H67) | Organizer, Event Director |
| `HELPDESK_MANAGE` | `helpdesk:manage` | Rename and merge knowledge topics; set the opening hours | Event Director |

`*` passes every check. **Browsing** helpers needs any of `helpdesk:request`, `helpdesk:offer`,
`helpdesk:coverage`. The topic catalogue (`GET /api/helpdesk/topics`)
also accepts eligible helpers without a capability (accepted mentors); adding a
topic (`POST`) needs eligibility or `helpdesk:manage`.

**Helper eligibility** (`eligible` in `GET /api/me/helper-profile`): the
caller holds `helpdesk:offer`, **or** has an accepted/confirmed application
response to a form whose granted role carries `helpdesk:offer` (an accepted
mentor gets the Mentor role only on confirmation, H61 lets them prepare
before). Ineligible helpers' profiles are never listed, routed or allowed to
claim, even if previously published.

## Realtime (`@hackos/shared/events`)

| Name | Where | Payload | Meaning |
| --- | --- | --- | --- |
| `EVENTS.HELPDESK_REQUEST_CHANGED` = `helpdesk.request.changed` | personal stream (`user:<id>`) of the requester, every team member, every routed helper and the claimer | `{ requestId: number, status: HelpRequestStatus }` | Refetch that request / your lists |
| `EVENTS.DOMAIN_CHANGED` | `domain:helpdesk` (`SSE_TOPICS.HELPDESK` = `"helpdesk"`) | none | Helper directory, open-request inbox or coverage changed; refetch. Subscribing needs any help desk capability. |

Notifications (H51 inbox + push, category `helpdesk`; email never):

- to routed helpers on creation: `{ kind: "request_created", requestId }`
- to requester + team on claim: `{ kind: "request_claimed", requestId, mode, meetingLocation, helperName }`
- to requester + team on release: `{ kind: "request_released", requestId }`
- to the claimer when the requesting side cancels: `{ kind: "request_cancelled", requestId }`

Inbox rows render server-side titles/bodies in the recipient's language
(es/gl/en); clients only deep-link `requestId` to the request screen.

## Types

```ts
type HelpTopic = { id: number; name: string };

type HelperKind = "mentor" | "sponsor" | "staff";

type AvailabilityInterval = { startsAt: string; endsAt: string }; // endsAt > startsAt

type HelperCard = {
  userId: number;
  displayName: string;          // same rule as the public profile (surname initial unless showSurname)
  photoUrl: string | null;      // only when the public profile's showPhoto is on
  headline: string | null;      // shared public-profile headline
  bio: string | null;           // shared public-profile bio (single source)
  kind: HelperKind;             // routing/coverage category, not the role label
  visibleRoleName: string | null; // highest assigned visible role (H8), as on badges
  affiliation: string | null;
  affiliationLogoUrl: string | null;   // enterprise name for sponsors
  topics: HelpTopic[];          // sorted by name
  availability: AvailabilityInterval[]; // ascending, includes past intervals
  scheduledNow: boolean;        // now inside one of the intervals
  present: boolean;             // H24: latest door scan is "in"
  availableNow: boolean;        // present (schedule is advisory; H65 routing uses actual presence)
};

// GET /api/helpdesk/helpers/:userId only (the list returns bare HelperCard).
// Shared client type: HelperDetail<P> in @hackos/shared/help-desk.
type HelperDetail = HelperCard & {
  challenges: { id: number; name: string }[]; // challenges the helper limited alerts to, [] = every request
  profile: DirectoryEntry;      // exactly GET /api/directory/:userId: displayName, photoUrl, headline,
                                // bio, locationNote, socials, cvUrl, projects, project, challenges,
                                // helpTopics; honours the person's own public-profile switches
};

type MyHelperProfile = {
  eligible: boolean;
  published: boolean;
  publishedAt: string | null;
  bio: string | null;           // same value as GET /api/me/public-profile bio
  topics: HelpTopic[];
  availability: AvailabilityInterval[];
  preview: HelperCard & { profile: DirectoryEntry }; // exactly what others get from GET /api/helpdesk/helpers/:userId, even unpublished (cvUrl is the owner route)
};

type HelpRequestStatus = "open" | "claimed" | "resolved" | "cancelled";
type MeetingMode = "on_my_way" | "meet_at";
type RoutingOutcome = "matched" | "fallback" | "sponsor" | "none";

type HelpRequest = {
  id: number;
  status: HelpRequestStatus;
  description: string;
  location: string;
  topics: HelpTopic[];
  other: boolean;
  challenge: { id: number; name: string } | null; // optional target challenge
  preferSponsor: boolean;       // requester prefers a sponsor to come
  project: { id: number; name: string } | null; // team request when set
  requester: { userId: number; displayName: string } | null; // null after the requester's account removal
  routing: RoutingOutcome;      // sponsor: preferSponsor applied; matched: knowledge match; fallback: Other / no match → all available helpers; none: nobody available
  notifiedCount: number;
  claim: null | {
    helper: { userId: number; displayName: string; photoUrl: string | null; kind: HelperKind; visibleRoleName: string | null; affiliation: string | null } | null;
    mode: MeetingMode;
    meetingLocation: string | null; // set when mode = "meet_at"
    claimedAt: string;
  };
  createdAt: string;
  queuedAt: string;             // FCFS key; an edit moves the request to the end
  queuePosition: number | null; // 1-based among all open requests; null otherwise
  resolvedAt: string | null;
  cancelledAt: string | null;
  viewer: {                     // what the caller may do now
    canCancel: boolean;
    canEdit: boolean;           // open and caller on the requesting side
    canClaim: boolean;
    canRelease: boolean;
    canResolve: boolean;
    notified: boolean;          // caller was in the routed audience
  };
};

type CoverageReport = {
  from: string; to: string; stepMinutes: number;
  totals: { publishedHelpers: number; byKind: Record<HelperKind, number> };
  slots: {
    startsAt: string; endsAt: string;
    scheduled: number;          // published eligible helpers with an interval overlapping the slot
    byKind: Record<HelperKind, number>;
    topics: { id: number; name: string; scheduled: number }[]; // only topics with >0, desc
  }[];
  now: {
    at: string;
    scheduled: number;          // scheduledNow
    present: number;            // inside the venue (H24), scheduled or not
    available: number;          // present, whether scheduled or not
    topics: { id: number; name: string; scheduled: number; available: number }[];
  };
  uncoveredTopics: HelpTopic[]; // topics on open requests with no available helper now
};
```

## Endpoints

### Opening hours (H64)

`HelpdeskSchedule` lives in `packages/shared/src/help-desk.ts`. No windows
means always open. Only creating requests is gated.

| Method & path | Guard | Body | Response |
| --- | --- | --- | --- |
| `GET /api/helpdesk/schedule` | authenticated (no event access needed) | - | `HelpdeskSchedule`: `configured`, `open` (server clock; true when not configured), `windows` (ascending), `nextChangeAt` (next start when closed, end of the current continuous opening when open, else null), `suggestedInterval` |
| `PUT /api/helpdesk/schedule` | `helpdesk:manage` | `{ windows: { startsAt, endsAt }[] }` (0-30, each end after start, no overlaps; replaces the set, `[]` clears it) | `HelpdeskSchedule`; 400 on invalid windows. Audited; idempotent. |

### Knowledge catalogue (H61)

| Method & path | Guard | Body / query | Response |
| --- | --- | --- | --- |
| `GET /api/helpdesk/topics` | browse or eligible helper | `?q=<text>&limit=1..50&available=1` (default 20; `q` matches anywhere, case/accent-insensitive; `available=1` limits results to topics offered by published helpers currently at the venue) | `{ topics: HelpTopic[] }` |
| `POST /api/helpdesk/topics` | eligible helper or `helpdesk:manage` (else 403 `helper_not_eligible`) | `{ name: string }` (1-60 chars, trimmed, inner spaces collapsed) | `201 { topic, created: true }` or `200 { topic, created: false }` when an equivalent name exists. Rate-limited (20/hour/user). |
| `PATCH /api/helpdesk/topics/:id` | `helpdesk:manage` | `{ name }` | `HelpTopic`; 409 `topic_name_taken` |
| `POST /api/helpdesk/topics/:id/merge` | `helpdesk:manage` | `{ targetId }` | `HelpTopic` (target); moves profiles and requests, deletes source |

"Other" is not a topic: requests carry `other: boolean`.

### My helper profile (H61, H62)

| Method & path | Guard | Body | Response |
| --- | --- | --- | --- |
| `GET /api/me/helper-profile` | authenticated | — | `MyHelperProfile` (works before event access; `eligible:false` when not a helper). Also `challengeIds: number[]` (empty = every request), `challenges: {id, name}[]` (selected) and `challengeOptions: {id, name}[]` (visible challenges to pick from), and `suggestedInterval: {startsAt, endsAt} \| null` (event_config hacking window, else event window, else null; clients prefill new availability with it). |
| `PUT /api/me/helper-profile` | eligible (403 otherwise) | `{ published: boolean, topicIds: number[] (0-20, existing), challengeIds?: number[] (≤50 visible challenges, else 400; omitted keeps the stored set, [] clears it) }` (strict: any other field, `bio` included, is 400) | `MyHelperProfile`. Publishing needs no topic (a helper with none is a generalist). The bio and every other profile field are edited only through `PUT /api/me/public-profile`. Turning publication on (unpublished → published) also sets the public profile's `directory_visible` (and `consented_at`) in the same transaction, audited as changed field `directoryVisible`; unpublishing never unshares. Help desk readers get `profile.cvUrl` when the helper shares their CV and download it from `GET /api/directory/:userId/cv`, as a badge scanner would. |
| `PUT /api/me/helper-profile/availability` | eligible | `{ intervals: AvailabilityInterval[] }` (0-30, each ≤24 h, no overlaps, none starting before `suggestedInterval.startsAt` or ending after midnight following its final day in the event timezone; replaces the set) | `MyHelperProfile`; 400 `availability_overlap` / `availability_invalid` / `availability_before_window` |

### Browse helpers (H63)

| Method & path | Guard | Query | Response |
| --- | --- | --- | --- |
| `GET /api/helpdesk/helpers` | browse | `?topicId=<id>&q=<name/topic text>&availableNow=true` | `{ helpers: HelperCard[] }`, available now first, then name |
| `GET /api/helpdesk/helpers/:userId` | browse | — | `HelperDetail` (card + `profile`); 404 when not published/eligible. Publication is the consent: no badge scan, `directory_visible` or diary row involved, and none is created. `profile.cvUrl` and `profile.photoUrl` resolve for help desk readers while the person's `share_cv` / `show_photo` switches are on. |

Browsing creates no diary contact. `photoUrl` from a helper card is
readable by browsers through the existing photo route.

### Requests — participant side (H64)

| Method & path | Guard | Body | Response |
| --- | --- | --- | --- |
| `GET /api/helpdesk/projects` | `helpdesk:request` | — | `{ projects: {id, name}[] }` active projects the caller can select as the requesting team |
| `GET /api/helpdesk/challenges` | `helpdesk:request` | — | `{ challenges: {id, name, mine}[] }` visible non-test challenges, the caller's own project challenges first (`mine: true`) |
| `POST /api/helpdesk/requests` | `helpdesk:request` + event access | `{ description (1-500), location (1-120), topicIds: number[] (0-5), other: boolean, projectId?: positive integer or null (active team membership required), challengeId?: visible challenge id or null, preferSponsor?: boolean (default false) }` — needs ≥1 topic or `other` | `201 HelpRequest`. 409 `help_request_active` when the caller (individual) or the team (project) already has an open/claimed request; 409 `helpdesk_closed` outside the configured opening hours; 403 without event access or active membership in `projectId`. |
| `GET /api/helpdesk/requests/mine` | `helpdesk:request` | — | `{ requests: HelpRequest[] }` own + teams', newest first |
| `GET /api/helpdesk/requests/:id` | requester, team member, helper (`helpdesk:offer` eligible), coverage, `helpdesk:manage` | — | `HelpRequest & { requesterProfile: DirectoryEntry \| null }` — the profile only for a routed helper, the claimer or `helpdesk:manage`, and only while the requester shares their public profile; 404 otherwise |
| `PATCH /api/helpdesk/requests/:id` | requester or team member | `{ description, location, topicIds, other, challengeId?, preferSponsor? }` (creation rules) | `HelpRequest`, moved to the end of the queue and re-routed (only new matches are notified); 409 `help_request_already_claimed` when claimed, `help_request_closed` when resolved/cancelled |
| `POST /api/helpdesk/requests/:id/cancel` | requester or team member | — | `HelpRequest` (`cancelled`, retained in history); 409 `help_request_closed` when resolved/cancelled |

### Requests — helper side (H65, H66)

| Method & path | Guard | Body / query | Response |
| --- | --- | --- | --- |
| `GET /api/helpdesk/inbox` | eligible helper | `?scope=open\|mine` (default `open`) | `{ requests: HelpRequest[] }` — `open`: every open request in first-come, first-served order (`queuedAt`, id); `mine`: claimed by me (claimed, then resolved) |
| `POST /api/helpdesk/requests/:id/claim` | eligible + published helper | `{ mode: "on_my_way" } \| { mode: "meet_at", meetingLocation: string (1-120) }` | `HelpRequest` (`claimed`). Exactly one concurrent claim wins; others get 409 `help_request_already_claimed`. A retry by the winner returns the same claim without a second notification. |
| `POST /api/helpdesk/requests/:id/release` | the claimer | — | `HelpRequest` back to `open` (claim cleared, requester notified; audience not re-notified); 409 `help_request_not_claimer` |
| `POST /api/helpdesk/requests/:id/resolve` | the claimer, requester or team member | — | `HelpRequest` (`resolved`); 409 `help_request_not_claimed` while open, `help_request_closed` once closed |

### Coverage (H67)

| Method & path | Guard | Query | Response |
| --- | --- | --- | --- |
| `GET /api/helpdesk/coverage` | `helpdesk:coverage` | `?from&to&stepMinutes=15..240` (default: event window, else span of all intervals; a default `from` is floored and `to` ceiled to `stepMinutes` boundaries in UTC, e.g. whole hours, so slots read 17:00–18:00; explicit values are kept as given; 60 min; ≤500 slots) | `CoverageReport` |

## Public profile additions

`DirectoryEntry` (`GET /api/directory/:userId`, and `preview` in
`GET /api/me/public-profile`) gains `helpTopics: HelpTopic[]`: the person's
knowledge while their helper profile is published, `[]` otherwise.

## Error codes (`details.code`, `ERROR_REASONS` in `@hackos/shared/error-reasons`)

Localized text: `apiError_<code>` in `packages/shared/locales/*/common.json`.

| Code | Status |
| --- | --- |
| `helper_not_eligible` | 403 |
| `help_request_active` | 409 (`details.requestId` when known) |
| `helpdesk_closed` | 409 (`details.nextChangeAt`: next opening, or null) |
| `help_request_already_claimed` | 409 |
| `help_request_closed` | 409 |
| `help_request_not_claimable` | 409 (own or team request) |
| `help_request_not_claimer` | 409 |
| `help_request_not_claimed` | 409 |
| `topic_name_taken` | 409 |
| `topic_reserved` | 400 ("Other" and its translations) |
| `topic_unknown` | 400 |
| `availability_overlap` | 400 |
| `availability_invalid` | 400 |


Resolution queues `helpdesk.resolved` through the existing in-app and push
channels for the requester/team and claimer, excluding the actor. The payload
contains `kind: "request_resolved"`, `requestId` and the actor name; a repeated
transition returns 409 and does not enqueue another notification. Claims retain
`helpdesk.onMyWay` and `helpdesk.meetAt`, including the support person's name and
the destination.

Sponsor preference requires `challengeId` on both creation and edit (400 without
it). Preferred recipients are the available representatives of that challenge's
company, using the existing challenge-sponsor relation; an unrelated sponsor
matching a topic does not qualify for preference. If no preferred representative
is inside, ordinary topic/Other fallback applies. Planned intervals never gate
current availability or notifications.
