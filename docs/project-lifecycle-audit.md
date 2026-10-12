# Project lifecycle audit and implementation plan (H6, H16–H21, H30, H53)

Audit performed against the actual modules, active SQL migrations, participant
pages, import pages, secondary-email routes and queue guard on 2026-10-08.
The local development database contained no repos or planned work groups;
backward compatibility must therefore be verified with legacy fixtures.

## Existing lifecycle

One deployment manages one event (`event_config.id=1`), not multiple event IDs.
Participants create `planned_work_groups`, invite accounts with opt-in membership,
select intended challenges and an early/middle/late judging preference. These
records forecast demand without entering operational queues. Devpost's two CSVs
create `repos`, stage identities in `devpost_participants`, and put recognized
accounts in `submissions`. Here **submissions means membership**, not submission
state. Exact Devpost URLs or an unambiguous complete roster plus challenge set
link a planning group to a repo. Operational queues and judging use repo IDs.
The product calls both stages “projects”; preserve that terminology.

Native staff/legacy participant creation already creates repos and challenge
entries, but has no Submit transition. Participants may belong to any number
of independent planning groups and repos. Invitations do not confer membership.
Identity is users.id; one primary and one secondary email are currently supported.
Secondary addresses require verification and trigger reconciliation after
verification/removal. Primary matching did not check email_verified. Manual
identity decisions survive imports. The importer upserts by exact exported URL;
URL-less exports fall back to title. A later import adds roster/prize rows but
does not remove absent rows. Planning linkage automatically unions accepted
planning members with Devpost members, concealing discrepancies.

Authorization uses capabilities and contextual relationship scopes; participant
writes check membership, event access/policy and editing windows. Operator
corrections bypass participant windows. Metadata/preferences remain editable
until window closure/queue creation; no explicit lock, submission timestamp,
submission snapshot, edit request or unlock decision exists. Audit_log stores
actor, time, reason and before/after in the domain transaction. Notifications
already deliver invites and live queue changes through an outbox.

Judging uses dynamic queues rather than a fixed appointment scheduler. H30
serializes calls by repo and resolved user IDs with advisory transaction locks,
preventing simultaneous called/in-room/presenting states across rooms even for
different projects sharing one member. Per-project timing is a soft initial
ordering preference. Challenges correspond to tracks; imported prize names map
to challenges, while planned intent remains separate. Mandatory challenge
entries currently include all operational repos regardless of submission.

## Gap classification

| Requirement | Existing assessment | Smallest adaptation |
| --- | --- | --- |
| Internal project creation, multiple memberships | Correctly supported | Retain planning and repo IDs |
| Intended tracks and project timing | Correctly supported | Preserve on conversion/linkage |
| Shared-participant collisions | Correctly supported | Feed resolved identities; retain H30 guard |
| Verified email matching | Buggy primary check | Require verified primary as well as secondary |
| Native submission / eligibility | Missing explicit lifecycle | Submit planning record into repo, snapshot and lock |
| Lock / edit request / reopen / resubmit | Missing | Explicit repo state + audited request decisions |
| Short stable project code | Missing | Immutable random code on each existing model |
| Devpost-only projects | Supported | Preserve internal representation and identity claims |
| Internal projects without Devpost | Supported but confusing | Explicit native submission and unsubmitted state |
| Repeated imports | Partial | Preserve URL/manual links; refresh external roster |
| Membership differences | Unsafe union | Retain separate source rosters and require a decision |
| Safe project matching | Partial | Code first; existing links stable; retain conservative matcher |
| Human candidate/claim decisions | Missing | Extend existing Projects/Unmatched administration |
| Team-size rules | Missing configuration | Optional maximum, unique resolved people, explicit exception |
| Deadline finalization | Missing | Use hacking end as existing submission deadline |
| Audit/history | Partial | Reuse audit; add immutable submitted snapshots |
| Admin override / reopen UX | Missing | Decision-oriented reconciliation view |

The current request explicitly extends H18/H19 and supersedes H20's old read-only
participant framing. Normative plan files remain unchanged. No fixed-slot
scheduler, permanent team model, or second operational project model is needed.

## Judging timing extension — current task requirements

The user added and clarified these requirements during implementation:

- Administrators and assigned judges can set a target time per team **on a
  track/challenge**, before judging begins and after judging has started.
- The target belongs to the track, **not to an individual room**. Every room
  serving the same challenge aims for the same target. Parallel rooms share
  the challenge's observations and estimate rather than learning divergent
  targets.
- Presentation ETA must combine the configured target with an intelligent,
  gradual adjustment from actual per-team presentation durations once enough
  observations exist.
- The estimate must also account for entering the room, preparing equipment,
  and getting ready before presentation/judging actually starts. Presentation
  time alone underestimates the throughput cycle.
- Timing edits must remain possible while judging is running. They update
  future estimates and the advisory target without rewriting completed
  evaluations or forcibly ending a presentation.
- All schema changes for this change must ship in **one migration file maximum
  per PR**. The user explicitly permits reconstructing the local development
  database if needed to consolidate migrations. Do not apply that permission
  to staging/production data or rewrite their applied migration history.

### Timing implementation audit

`room_queue_state.desired_minutes_per_team` currently owns the desired pace:
that is per room, so rooms serving one challenge can disagree. This is an
audited defect in the old design, not the required final behavior. The state PATCH
route is gated by `QUEUE_ADMIN`; it does not provide an assigned judge with a
track-specific target control. `challenges.max_presentation_seconds` is a
separate presentation ceiling, not an adaptive cycle estimate. It is editable
as timing configuration even after public challenge fields are frozen.

`queue/reads.ts::roomPace` caps the room's desired presentation time by that
ceiling and squeezes the advisory target when pending teams do not fit before
`queue_settings.schedule_end_at`. It reports insufficient-time warnings and
parallel room count. This is advisory: the server never automatically ends a
presentation or an evaluation when the timer expires. Preserve that behavior.

`challengeProgress` already measures completed presentation time from
`presentation_started_at` to `completed_at`, scoped across a challenge's rooms.
However, this observed average is only reported; it is not consistently consumed
by ETA calculations. There are several independently implemented ETA paths:
`challengeEtaMinutesPerSlot`, the participant `myQueueStatus` set-based query,
project detail's `attachMembersAndPrizes`, and the queue pump's notification ETA.
They predominantly average room targets and divide by active room count.
These paths need one shared cycle-estimate formula so participant project,
queue, notification and operator views do not disagree.

The state machine explicitly separates called → in_room → presenting. This is
useful existing structure. Use bring-in time for preparation where available,
and retain call time as the fallback specified in the later clarification. A dedicated room-entry timestamp (with a safe
history-based backfill when possible) measures in-room preparation through
`presentation_started_at`. Reset/requeue transitions must clear this timestamp;
returning to the room must start a new preparation interval.

### Timing adaptation

Retain the existing queue model and hard participant collision guard. Add a
track target and preparation allowance; keep presentation ceilings separate.
Aggregate observations across serving rooms within the shared judging queue.
For merged challenges judged in one presentation, use the strictest configured
presentation target and the largest setup allowance, rather than scheduling a
second presentation for the same project.

Use a bounded recent sample of clean completed presentations and blend it with
the configured target using a small prior, so one unusually long or short demo
does not dominate. Exclude negative durations, no-shows, and implausibly long
breaks; measure preparation separately. Before observations exist, use the track
target plus its preparation allowance. Once observed data exists, changing an
automatic judge goal must not shorten this cycle estimate. Divide cycle time by the count of active
serving rooms for throughput estimates. Never squeeze setup out of the estimate
merely to display an optimistic finish time. Expose target, estimated cycle,
sample count and observed averages to staff; participant views need only ETA.

Validation must cover shared targets in two rooms, assigned-judge scope,
unauthorized timing edits, edits before/after judging start, no samples,
increasing sample influence, preparation overhead, pause/parallel-room behavior,
outlier exclusion, and consistent ETA projections. Existing ETA tests may need
intentional expectation changes because setup time was previously omitted.

### Later timing clarifications (authoritative for this change)

The judge's **effective time goal** and the **estimated actual cycle time** are
separate values. If the remaining judging window forces the goal downward,
ETAs must still derive from observed average pace. Judges need time to adapt;
pretending they instantly meet the new goal would cause sudden, misleading ETA
changes for participants. The estimated finish may therefore exceed the
scheduled judging close. The judge view must show both timestamps and a clear
visual overrun mark, rather than clipping the finish estimate to the close.
The automatic goal adjustment must never feed back into the learned ETA.

Preparation time is the average interval between calling/bringing a team in
and pressing Start presentation. Use the bring-in timestamp when available,
with the call timestamp as fallback for legacy entries that lack bring-in
history. This clarification supersedes the earlier audit's unconditional
exclusion of call timestamps. The preparation allowance is the initial estimate
until observed intervals become available, then gradually blends with them.


### Clarification checklist for future implementation review

| Decision | Required final behavior |
| --- | --- |
| Target ownership | One track/challenge target, shared by every room serving it; no independently editable per-room presentation targets |
| Who may edit | Administrators and authorized judges of that track |
| When editable | Before judging and while judging is underway |
| Learning scope | Observations across the rooms judging the same track/shared queue |
| Presentation sample | Start presentation → completed presentation |
| Preparation sample | Bring in → Start presentation; fall back to Called → Start when bring-in is unavailable |
| No observed data | Configured target + initial preparation allowance |
| Observed data | Gradual, stable adjustment using average actual presentation and preparation time |
| Deadline pressure | Lower the judge's advisory goal if needed, without lowering the observed ETA to pretend adaptation is immediate |
| Participant ETA | Based on estimated actual cycle/observed pace, even if this implies judging finishes late |
| Judge finish display | Show the same realistic estimated finish, the scheduled judging close, and a visible indication when finish exceeds close |
| Automatic completion | Never end a presentation or evaluation merely because its goal expires |
| Schema delivery | At most one new migration file for this PR; local reconstruction is permitted to consolidate it |

All clarifications above are part of the current user-requested scope. Earlier
implementation details in this audit describe the original system or proposals;
where they conflict with this checklist, the checklist and later clarifications
win. Keep the audit as a reference and update implementation docs as the change
lands; do not silently change the functional plan files.


## Implementation and verification record

The implementation retains the planning → repo boundary and adds a single
`0304_project_submission_lifecycle.sql` migration. Native submission converts
planning into an operational project transactionally; immutable submitted
snapshots and edit-request decisions reuse audit_log for attribution. Organizer
reopening is a scoped editing/resubmission exception, with previous versions
retained. Identity and membership sources stay separate; verified aliases count
as one user and unknown/potential duplicate identities remain explicit issues.
Confirmed project links use an immutable import identity even when title or
shown URL changes. Linking imported records into native projects retains the
old ID as an ineligible reconciled record. The existing Unmatched tooling
continues to resolve exact imported identities; the new reconciliation view is
part of the existing Projects area.

Track targets and preparation allowances share the same migration. The common
learned cycle is consumed by the project, participant queue, pump and operator
ETA paths. Per-room legacy setters now update served track targets instead of
creating independent room goals. Multi-track rooms can request pacing for the
selected served challenge so unrelated tracks do not inflate its pending count.
The judge goal can be shortened under deadline pressure; estimated finish and
participant ETA remain based on actual learned cycles, including setup.

Validation includes real Postgres/Valkey API suites, native recovery and
reconciliation integration tests, shared-track/learned-preparation timing tests,
web type checks/unit tests, builds/lint, and real Chromium desktop/narrow review.
Screenshots are kept outside the source tree. Exact final results are reported
with the delivered change; this audit does not stand in for running checks.

Deliberately preserved constraints: one event per deployment, one secondary
address per account, early/middle/late project preferences, dynamic judging
queues, and title-based identity only when the export has no project URL. A
URL-less renamed export has insufficient evidence for reliable deduplication;
organizers should use stable Devpost project URLs/codes. No account merging or
fixed-slot appointment scheduler was introduced.

The multi-track pace review also found that the old room projection used only the lowest challenge ID's presentation ceiling in a merged queue. The final projection uses the strictest ceiling across the shared group, independently of which track is selected. Event-wide team-size rule edits require both project-edit and event-management capabilities; per-project exceptions stay under project-edit scope.

The runtime review caught a stale documentation claim that challenges had a draft/published `status` column. Actual publication uses `visibility` and scheduled `available_from`; the module documentation now reflects the existing schema.

Administrators can correct mistaken Devpost relationships with an audited unlink reason. Planning links detach without deleting either record. Native hybrids separate into the retained external record (or a new external representation), preserving the native submitted version and lock. Subsequent imports keep that external identity; heuristic/code auto-linking is disabled for an explicitly unlinked internal record until an organizer confirms a new relationship. Unlinking is blocked once either record has participated in judging. When a code initially linked directly into native metadata, the separated record starts with that internal name; a subsequent export updates the external description/title.

Existing room timing goals are backfilled into track targets in the consolidated migration. If serving rooms previously disagreed, the strictest goal becomes their common track target; unserved tracks retain the eight-minute initial prior. This preserves configured pacing while ending independent room ownership. Candidate controls distinguish planning IDs from operational IDs so independent projects with coinciding numeric IDs remain separate.

### Regression coverage map

| Scenarios | Coverage |
| --- | --- |
| Internal planning, multiple projects, immutable codes, native submit/lock/reopen/resubmit, concurrent submission, unauthorized actions | `test/projects/lifecycle.test.ts`, existing participant/work-group suites |
| Code import, Devpost-only claim, linking planning/native records, retained IDs, repeated imports, renamed/display-URL edits, confirmed links, shared-email ambiguity, administrative unlink recovery | `test/projects/lifecycle.test.ts`, existing import/linkage suites |
| Verified aliases, unverified primary/secondary identities, reconciliation after verification/revocation, duplicate unique-person counts | lifecycle suite plus `test/identity/secondary-email.test.ts` and reconciliation suites |
| Participant discrepancies, possible versus confirmed size issues, explicit source/size/eligibility decisions and audit, deadline unsubmitted versus native/external eligibility | lifecycle suite and existing project correction/read suites |
| Independent projects sharing participants, hard queue collision guards after identity resolution | `test/queue/timing.test.ts`, transitions/membership/secondary identity suites |
| Shared track targets, authorized judge edits before/during judging, preparation observations, blended averages, realistic ETA despite a shortened goal, strict merged-track ceiling | timing suite and `test/queue/room-queue-groups.test.ts` |
| Participant/admin desktop and narrow states, native recovery, track editing, visible close/overrun, candidate links and unlink decisions | real Chromium browser review and screenshots |
| Trilingual reconciliation codes, close timestamps and cycle interpolation | `apps/web/src/lib/i18n.test.tsx` |

Runtime candidate review exposed a query using import/archive columns added after the reconciliation view was defined. Candidate lookup now joins the original repo row for those fields, and authorization plus planning/native candidate visibility have a dedicated integration regression test.

The operator finish projection includes remaining preparation/presentation for teams already in a room, including the last team when no projects remain waiting. Parallel throughput cannot predict completion before the longest active presentation's expected end. Remaining-window goals reserve that active work and learned preparation; they still do not change the learned ETA.

The final admin copy distinguishes organizer identity decisions from participant email verification. Ordinary pre-deadline drafts appear under Show all projects; the default issue view surfaces unsubmitted planning records only after the deadline.

Linking an imported record into a native project cancels its old waiting entries with one history row, one audit entry and one post-commit queue event per entry; participant queue invalidation follows the same existing notification path. This avoids stale operational queues after reconciliation.

### Final validation result (2026-10-08)

- Full API integration run: 107 files, 1,174 passing tests across the four isolated database shards. New lifecycle/timing suites cover 25 integration cases; existing authorization, email reconciliation, queue collision and importer coverage remains passing.
- Web unit run: 70 files, 451 passing tests, including three new trilingual interpolation checks.
- API/web type checks and production builds passed; repository lint, copy, page-size and retired-authorization checks passed. The page checker retains pre-existing soft size notices.
- Real Chromium desktop and 390-pixel review passed native submit/request/reopen/resubmit, team/track display, discrepancy views, track edits, overrun/close display, administrator unlink and manual candidate linking without page errors. Final screenshots remain outside the source tree.
- The single consolidated migration applies locally and a second migration run reports Already up to date. Local verification records and temporary accounts were removed; development servers started for verification were stopped. No commit or PR was created.

Existing prize/tag enrollments and organizer queue corrections retain the application's established additive import/correction policy; this change does not silently withdraw existing judging participation on a later export. Organizer corrections remain available through existing project/queue controls.

## UX correction after participant/organizer review

The first screens passed functional checks but failed the established visual standard: reconciliation repeated full project details and too many inline actions, had no canonical search/filter controls, and submission/timing triggers floated outside their relevant sections. This review supersedes the earlier visual-quality assessment.

Reconciliation now follows the maintained Users and application Responses composition: shared ListToolbar/FilterMenu, result feedback, sortable/paginated DataTable, compact mobile rows, and per-project review. Rare administrative actions stay in overflow; participant source decisions and edit requests remain direct. Planning, native and imported records share one filtered list. Submission and edit-request actions use SectionCard's header action slot; claims open a controlled review panel. Track timing belongs beside the pacing target or in the challenge header, with shared label/control tracks in its form. No backend state transition or migration was changed for this correction.

The desktop/narrow comparison also caught clipped actions at the bottom of a long mobile review. Administrative utilities now use the shared modal footer, outside its scrolling content, with a browser geometry regression check.

Correction validation: 455 web unit tests passed, including four reconciliation filtering cases; eight Chromium browser cases passed across desktop and mobile, plus three existing Users/Responses/judging reference cases. Repository lint, web type checking and production build passed. Browser cases use deterministic API fixtures to exercise long Spanish labels, participant discrepancies, filter interaction, audited decisions, focus restoration and timing alignment. Desktop/mobile screenshots were reviewed against the actual Users and Responses screens; the fixture checks supplement the prior real-API lifecycle validation.

### Participant hierarchy and ordinary event rules correction

The gallery review exposed a second issue missed by the earlier list-focused correction: mobile project edit/overflow controls fell below the title, and open sections presented delivery/Devpost before the participant could understand team and challenges. Planning and reconciled project pages now use the inline Users header composition, compact accessible edit controls, and separate shared section surfaces for project details, team, challenges with project judging preference, and a final submission section. That section presents Devpost (code plus link status) as the primary path and, below an "or" divider, a secondary "Submit without Devpost" action with its lock consequence. Either path leaves later reconciliation open: a code can still be added on Devpost, administrators can link a late import, and a code-less import can be relinked to a project that was not linked initially. Names and tracks remain plain rows rather than nested cards. The Add challenge interaction is now the same header editor on both lifecycle pages.

The mandatory justification on maximum team size was an inappropriate extension of exception handling to ordinary event configuration. It has been removed from the form and API requirement. Saving or clearing the rule still transactionally audits actor, timestamp and before/after values; project-specific exceptions and unlock decisions retain their requested reasons. No schema or migration changes are needed.

Correction validation: 107 API files / 1,177 tests and 71 web files / 455 tests passed; 12 Chromium cases passed across desktop/mobile, including 320-pixel header geometry, planning and reconciled detail-page section order, challenge editor interaction, keyboard focus, and saving the event maximum with no reason. Repository lint, API/web type checks and the web production build passed. The new API cases verify both capabilities, invalid-limit rejection, clearing the limit and automatic audit attribution. Representative Spanish desktop/mobile screenshots were inspected with selected challenges and two participants. Screenshot API fixtures do not modify the local event or participant records.

Mobile project edit triggers now use the shared square icon-button dimensions, yielding circular controls instead of short pill-shaped buttons. Desktop retains the icon and edit label. Both planning and native-only editors are checked with browser geometry.
