# Synthetic reviewer fixtures

This runbook describes the synthetic accounts that can be regenerated inside
the same deployed hackOS instance. It is intentionally separate from
the participant Privacy Policy and Terms: those legal documents describe the
GPUL-operated hackOS service and do not mention a particular review channel.

## Scope and safety boundary

An administrator with `ADMIN_ALL` can use **Users → Regenerate review accounts**.
The API resets the four marked synthetic accounts to their default scenarios,
revoking their sessions and replacing their credentials while keeping each
login email address unchanged. The reset also removes push tokens, scanner
data, project graph, queue graph and synthetic anonymous rows. The generation
counter advances for fixture data and operational handoffs, but it is not part
of a login address. The registry and fixture graph update is transactional and
audited; Better Auth signup calls commit on their own connection, so a failed
first provisioning attempt triggers best-effort cleanup of only the accounts
created by that attempt.

The feature uses the same API deployment and primary PostgreSQL database as
the event. Set these API-only variables only when the deployment owner wants
the synthetic fixture workspace enabled, and distribute the resulting
credentials out of band:

- `REVIEW_FIXTURE_PASSWORD` — password assigned to every generated account.
- `REVIEW_FIXTURE_DELETION_PIN` — six-digit PIN accepted only by marked
  synthetic accounts.

The API never returns either secret. A verified real account still receives a
one-time PIN by email for a destructive self-service action; there is no
universal static bypass for real participants. The fixture PIN is scoped to
synthetic accounts so a leaked review credential cannot delete or anonymize a
real attendee.

Synthetic rows are isolated by an explicit marker and a dedicated fixture
registry; normal admin/staff read paths, statistics, exports and audit
retention paths exclude them. A second database/container is deliberately not
used here: Better Auth sessions, permission capabilities, event configuration
and the operational foreign-key graph are single-database concerns. Splitting
fixtures into another database would require a new cross-database auth and
routing model, which would be a larger security boundary than this feature
needs. Enabling the fixture variables on a live event therefore still requires
explicit release/security approval for the reset operation.

## Generated scenarios

| Fixture key | Account kind | Prepared state |
| --- | --- | --- |
| `participant-delete` | Participant | Accepted role-derived event-access path, no canonical accreditation; exercises full deletion. |
| `participant-anonymize-outside` | Participant | Canonically accredited, with a closed door interval; exercises irreversible anonymization outside the venue. It owns the synthetic participant-facing judging queue. |
| `participant-anonymize-inside` | Participant | Canonically accredited, with an open door interval; exercises accepted anonymization with a pending exit. |
| `staff-exit-operator` | Staff | Synthetic operator with accreditation, presence and activity scan capabilities; can act only on marked synthetic subjects. |

All four generated accounts hold an event-bearing role and receive a durable
entrance ticket. This includes `staff-exit-operator`: its scan capabilities
still restrict what it can do operationally, but it also retains the
participant-facing app entry point and ticket flow used by the published mobile
build. The review-fixture regression checks `/api/me.hasEventAccess` and
`/api/me/ticket` for every account.

The queue fixture is deliberately marked on its challenge and repository. It
is visible to the corresponding synthetic participant through the participant
queue endpoint. The generated `staff-exit-operator` currently has only
accreditation, presence and activity capabilities, so it cannot call queue
APIs. If queue capabilities are added to a synthetic role later, every queue
read and write must enforce this same marker boundary. Ordinary admin/staff
project, challenge, queue, roster, scanner, presence, sponsor-enterprise,
statistics, application-file exports and data-subject request views exclude the
marked fixture. Sponsor enterprise/member/judge administration and candidate
lists use the same marker boundary, while the public sponsor reveal excludes
synthetic enterprises. A guessed private-upload key or personal export bundle
cannot cross that boundary. Synthetic rows are excluded from statistics and
exports and are not permanent anonymous audit data.

## App Store review notes

Text for the **Notes for Review** field, based on the submitted notes and
corrected for features added since. Passwords, the deletion code and the
deployment URL go in the private handoff, never in this repository.

> **What is this app?** hackOS is the official mobile app for HackUDC, a public
> student hackathon organised by GPUL in A Coruña, Spain. Anyone eligible can
> apply through the public event website; accepted attendees receive mobile
> access. No paid content, subscriptions or in-app purchases.
>
> **Core features.** Attendees view the schedule and set activity reminders,
> open wallet passes, receive announcements and notifications, follow their
> presentation queue position and estimated time, create and edit their team's
> project (including linking its GitHub repository through the GitHub App and
> submitting it), browse the project gallery once it opens, and edit an optional
> networking profile. Staff scan entrance tickets and badges and record
> presence, meals and activities.
>
> **Review access.** Enable Development Mode by tapping the app version seven
> times on Sign In or in Account; a red DEV badge appears. Sign in with
> `app-review-<scenario>@hackos.test` and the shared password from the private
> handoff. Accounts: `participant-anonymize-outside` (primary participant),
> `participant-delete` (full deletion), `participant-anonymize-inside`
> (anonymisation with a pending exit) and `staff-exit-operator`. All are
> synthetic, hold an event ticket and see only fixture data.
>
> **Account deletion and anonymisation.** Account → Delete account, confirmation
> code in the handoff. Full deletion: `participant-delete`. Anonymisation
> outside the venue: the primary participant. Checked-in attendees may keep
> anonymous audit data for public-funding audits; an attendee inside the venue
> is retained until an exit operator records their departure or 12 hours pass,
> for venue insurance headcounts.
>
> **Privacy and permissions.** Camera: scanning QR codes only; the app does not
> take photos. Photo library: attendees may pick a profile photo and project
> images to upload. NFC: staff read badge serial numbers, and attendees can tap
> company tags. Notifications: event announcements and queue updates. The app
> does not sell personal data. Privacy Policy and Terms: `/privacy`, `/terms`
> on the event site.

Before sending, these statements in the previous notes no longer hold and need
a decision rather than a rewording:

- "No user-generated content visible to other users" is wrong once the gallery
  exists: project names, descriptions, images and (with consent) member names
  and photos, plus networking profiles, are visible to other attendees. Apple's
  guideline 1.2 expects filtering, a way to report content and block users, and
  contact details; the code has no report or block control, so either add one
  or describe the organiser moderation path accurately.
- "Does not take, store or upload photos" is wrong: the photo picker uploads
  profile photos and project images, and a project's files are stored.
- NFC and the GitHub App browser sign-in were not mentioned.

What each account can and cannot show a reviewer today:

- The **Gallery** lists only fixture projects. The generated graph has one
  project and it is a draft, so the Gallery is empty for these accounts unless
  the event's draft visibility makes drafts visible. Gallery, GitHub linking,
  shared queues and every queue stage other than "waiting" are not
  demonstrable with the current fixtures.
- The staff account has no queue, judging, project or schedule management
  capability, so the queue manager, judging screens and organiser tools are not
  reachable by review accounts.
- Anything that needs real event data (directory, sponsors, statistics,
  exports) is intentionally excluded from the fixture scope.

Gaps to close before a review that must cover those screens, each needing its
own marked graph and cleanup pointers (the registry holds one project,
challenge and entry per fixture key, so multi-project data needs a schema
change):

1. A project-owning participant with a submitted project, a draft, a shared
   queue challenge, an entry in each queue stage and a linked repository row.
2. A queue/judge operator limited to fixture rooms and projects.
3. Fixture gallery projects so the Gallery is not empty.
4. Optionally a scoped organiser and a sponsor representative.

## Checking whether credentials were used

The admin dialog reads `GET /api/admin/review-fixtures` and displays the
generation, current synthetic email, availability and the timestamp plus
trusted IP origin of the most recent successful email sign-in for each
scenario. This is an operational signal, not an audit identity bridge. The
registry stores no password, PIN, user-agent, sign-in response or participant
answer, and it keeps only that one bounded timestamp/IP pair. Regeneration
resets the signal.

The timestamp and IP origin record only successful Better Auth email sign-ins
observed by the API. The origin is Fastify's trust-proxy-aware `request.ip`,
not a client-provided field. The API additionally emits one structured server
log for every API response made with a current reviewer session and for every
email sign-in attempt to a current reviewer address. These entries use
`kind: "DEBUG"` at the normal INFO transport level, even in production, and
include the fixture key, route, method, status, user id, email and the same
trusted IP (also exposed as `originatingIp`). Query strings, request bodies,
cookies, passwords and PINs are never logged. Server-log retention is
controlled by the deployment.

## Operational rules

- Keep the four credentials and the deployment URL together in the private
  review/QA handoff, never in the repository or a public API response.
- Regeneration revokes previous sessions and resets all synthetic state. Login
  email addresses remain stable; the shared deployment password and reviewer
  PIN remain the sources of truth in the private handoff.
- A synthetic participant requesting in-venue anonymization enters the same
  pending-exit flow as a real participant. The synthetic staff account records
  the exit; the participant cannot self-record it. The static PIN does not
  change the lifecycle or bypass the exit requirement.
- During pending exit, meal, activity, accreditation and judging writes are
  blocked. Only recovery/status/cancel and the validated exit transition may
  use the temporary identity.
- A stale offline scanner may carry the old synthetic identity until it
  reconnects, but central tombstones and account-state checks reject replay and
  the next snapshot omits the removed account. An unreachable device remains
  an operational residual until it is retired or wiped.

## Assumptions recorded for this feature

These are implementation assumptions, not legal conclusions:

- GPUL is the responsible organisation/data controller for the GPUL-operated
  hackOS instance; “HackUDC” names the event, not the operator.
- Synthetic accounts, marked projects/challenges and their queues are isolated
  test fixtures within the same deployment/database. They must not affect
  day-to-day participant/staff operations, statistics, exports, grant/audit
  records or the permanent anonymous dataset.
- The API selects the fixture boundary from the persisted synthetic marker and
  fixture pointers, not from an email suffix, role, deployment name or a
  client-provided flag. A future separate fixture database would require an
  explicit architecture/security decision and is not implied by this marker.
- A synthetic operator is constrained by the same capability checks as normal
  staff and has an additional marked-subject boundary. A normal administrator
  cannot use an ID change to discover or mutate a synthetic subject through
  ordinary participant endpoints.
- The current generated queue is intentionally small and participant-facing;
  future synthetic workflows need their own marked graph and cleanup pointers
  rather than reusing real event rows.
- The last-authenticated timestamp and trusted IP are sufficient for the
  dashboard question “was this current fixture credential used, and where did
  the latest successful sign-in originate?”; detailed reviewer request traces
  live only in deployment server logs and contain no participant response
  data.
- The static deletion PIN remains synthetic-only. If a product owner requests
  a universal real-user PIN, security review must explicitly replace this
  boundary rather than silently broadening it.
- The consolidated baseline contains the account-removal and fixture-marker
  schema. The active migration runner validates each ledger entry against the
  deployed files and checks immutable checksums; it does not recognize retired
  compatibility chains or perform a populated-database account-removal upgrade.
- Fresh fixture databases use the current schema bootstrap (`pnpm migrate`)
  from `0001_hackos_baseline.sql` plus the active migrations. Reviewer access is
  represented only by `user_roles` and `roles.event_access`, never by legacy
  application type or manual-attendee compatibility state.
- The current credential-retirement implementation stores a stable keyed HMAC
  digest in an unlinked global denylist. It does not retain the raw badge or
  ticket value; legitimate physical badge reuse is bounded by the server-side
  current-assignment timestamp, which rejects stale pre-replacement events.
