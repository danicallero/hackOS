# Synthetic reviewer fixtures

This runbook describes the synthetic accounts that can be regenerated inside
the same deployed hackOS instance. It is intentionally separate from
the participant Privacy Policy and Terms: those legal documents describe the
GPUL-operated hackOS service and do not mention a particular review channel.

## Scope and safety boundary

An administrator with `ADMIN_ALL` can use **Users → Regenerate review accounts**.
The API creates a new generation of four marked synthetic accounts and removes
the previous generation, including its sessions, credentials, push tokens,
scanner data, project graph, queue graph and synthetic anonymous rows. The
registry and fixture graph update is transactional and audited; Better Auth
signup calls commit on their own connection, so a failed provisioning attempt
triggers best-effort cleanup of only the accounts created by that attempt.

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
| `participant-delete` | Participant | Accepted mobile-access path, no canonical accreditation; exercises full deletion. |
| `participant-anonymize-outside` | Participant | Canonically accredited, with a closed door interval; exercises irreversible anonymization outside the venue. It owns the synthetic participant-facing judging queue. |
| `participant-anonymize-inside` | Participant | Canonically accredited, with an open door interval; exercises accepted anonymization with a pending exit. |
| `staff-exit-operator` | Staff | Synthetic operator with accreditation, presence and activity scan capabilities; can act only on marked synthetic subjects. |

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

## Checking whether credentials were used

The admin dialog reads `GET /api/admin/review-fixtures` and displays the
generation, current synthetic email and the timestamp of the last successful
email sign-in for each scenario. This is an operational signal, not an audit
identity bridge. The registry stores no password, PIN, IP address, user-agent,
sign-in response or participant answer. Regeneration resets the signal.

The timestamp records only successful Better Auth email sign-ins observed by
the API. It does not prove that a particular person completed a scenario, and
it does not capture failed attempts. This is intentional data minimization.

## Operational rules

- Keep the four credentials and the deployment URL together in the private
  review/QA handoff, never in the repository or a public API response.
- Regeneration invalidates the previous accounts. Update any handoff that
  references an older generation after regenerating.
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
- The last-authenticated timestamp is sufficient for the operational question
  “was this current fixture credential used?”; stronger reviewer telemetry is
  optional hardening and must not store new participant identity data.
- The static deletion PIN remains synthetic-only. If a product owner requests
  a universal real-user PIN, security review must explicitly replace this
  boundary rather than silently broadening it.
- The migration is validated from a fresh schema in this development branch;
  no production database is in scope. Once deployed, migration checksums are
  immutable and later corrections use a new migration.
- The current credential-retirement implementation stores a stable keyed HMAC
  digest in an unlinked global denylist. It does not retain the raw badge or
  ticket value; legitimate physical badge reuse is bounded by the server-side
  current-assignment timestamp, which rejects stale pre-replacement events.
