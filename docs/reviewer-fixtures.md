# Synthetic reviewer fixtures

This runbook describes the synthetic accounts that can be regenerated for an
isolated QA or external-review environment. It is intentionally separate from
the participant Privacy Policy and Terms: those legal documents describe the
GPUL-operated hackOS service and do not mention a particular review channel.

## Scope and safety boundary

An administrator with `ADMIN_ALL` can use **Users → Regenerate review accounts**.
The API creates a new generation of four marked synthetic accounts and removes
the previous generation, including its sessions, credentials, push tokens,
scanner data, project graph, queue graph and synthetic anonymous rows. The
operation is transactional and audited; failed provisioning attempts clean up
the exact accounts created by that attempt.

The feature is for an isolated deployment. Set these variables only in a
deployment that is safe to reset and whose credentials are distributed out of
band:

- `REVIEW_FIXTURE_PASSWORD` — password assigned to every generated account.
- `REVIEW_FIXTURE_DELETION_PIN` — six-digit PIN accepted only by marked
  synthetic accounts.

The API never returns either secret. A verified real account still receives a
one-time PIN by email for a destructive self-service action; there is no
universal static bypass for real participants. The fixture PIN is scoped to
synthetic accounts so a leaked review credential cannot delete or anonymize a
real attendee.

Do not enable these variables on a deployment containing real event data
unless the product and security owners have explicitly approved the reset and
isolation boundary.

## Generated scenarios

| Fixture key | Account kind | Prepared state |
| --- | --- | --- |
| `participant-delete` | Participant | Accepted mobile-access path, no canonical accreditation; exercises full deletion. |
| `participant-anonymize-outside` | Participant | Canonically accredited, with a closed door interval; exercises irreversible anonymization outside the venue. It owns the synthetic participant-facing judging queue. |
| `participant-anonymize-inside` | Participant | Canonically accredited, with an open door interval; exercises accepted anonymization with a pending exit. |
| `staff-exit-operator` | Staff | Synthetic operator with accreditation, presence and activity scan capabilities; can act only on marked synthetic subjects. |

The queue fixture is deliberately marked on its challenge and repository. It
is visible to the corresponding synthetic participant through the participant
queue endpoint. Ordinary admin/staff project, challenge, queue, roster,
scanner, presence and statistics reads exclude it. A synthetic operator sees
only marked subjects and marked queue resources; a guessed real or synthetic
resource outside that boundary is rejected. Synthetic rows are excluded from
statistics and exports and are not permanent anonymous audit data.

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
  test fixtures. They must not affect day-to-day participant/staff operations,
  statistics, exports, grant/audit records or the permanent anonymous dataset.
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
  ticket value; legitimate physical badge reuse still needs a separate
  assignment-binding/product decision before production.

