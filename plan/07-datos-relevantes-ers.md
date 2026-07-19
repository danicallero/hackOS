# Relevant data from ERS

This document summarizes ERS rules to keep as development guardrails.

## 1) Hard invariants

1. A repo has at most one queue entry per challenge.
2. At most one `in_room` or `presenting` entry per room; `called` can have several.
3. Evaluation is 1:1 with its queue entry.
4. Badge identifier is unique while assigned.
5. Each queue action generates exactly one history row and one broadcast.
8. Without a verified primary email, an application cannot advance past `submitted`.
10. One ticket per confirmed user; it is neither consumed nor revoked.
11. Wallet pass exists only if the user has a badge and a staff member with accredit capability issues a virtual badge (wallet/Google API).
12. No room capacity at the logical system level.
13. Role derived from relationships; not stored as permission truth.

## 2) Critical non-functional rules

- Real concurrency in queue with row locking and a single winner per transition.
- Idempotency on all state mutations.
- Transactional auditability: domain history + unified audit.
- Boundary permissions by capabilities (not by role).
- i18n minimum en/es/gl in UI and communications, but open to extensions. When staff manually creates activities/challenges/notifications/announcements, multiple content translations must be supported — both manual and via a local translation/AI service.
- Isolated load: public and participant reads must not degrade operational writes.
- UI controls that trigger network requests must be disabled while the request is in flight.
- Scanner flows tolerate degraded network with idempotent retries.

## 3) Application state machine (reference)

`draft -> submitted -> review -> accepted|rejected`

`accepted -> confirmed|declined|expired`

- Internal decision until batch send.
- Confirmation/decline via 3 paths: link, authenticated web, admin override.
- No functional waitlist.

## 4) Queue state machine (reference)

Key states:
`waiting | called | in_room | presenting | completed | disqualified`

Operational actions:
- `call_next`, `notify_enter`, `bring_in`, `start`, `complete`
- `send_back_to_waiting`, `requeue`, `re_enter`
- `no_show`, `skip`, `disqualify`

Critical notes:
- `no_show` is a human decision.
- Hard guarantee: never call a team with members occupied in another room.
- Pause room reinjects `called` to top of queue; `in_room` or `presenting` stay.
- `in_room` and `presenting` can be reinjected to `called` to remove them from the room, but cannot be reinjected to `waiting` without passing through `called`.
- Arrival order is always maintained on reinjection. Someone coming from `in_room` to `called` goes to top of queue; from reinjection to `waiting`, the one longest in `called` goes to top of `waiting`.
- When manually requeuing a team because they weren't there when called, it flags a project instance visible for potential disqualification if repeated. This can be done from staff or judge UI, and the team's requeue history must be viewable. Staff can also manually send someone to the end on request without incrementing no-show.
- It is possible to manually call a team to the room or waiting room (`called`) regardless of their position in the queue.

## 5) Background processes to plan for

1. Auto-call pump per active room and quota.
2. Spot confirmation expirer.
3. Scheduled visibility publisher (challenges/schedule/announcements).
4. Notification dispatcher with durable outbox and retries.
