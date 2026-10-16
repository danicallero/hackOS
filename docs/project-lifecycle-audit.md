# Judging timing: targets, allowances and clarifications (H30, H33–H37)

The project lifecycle itself (drafts, submission, gallery, phases) is documented
in [projects.md](./projects.md). This file keeps the judging-timing requirements
and clarifications that apply to native projects. The filename is historical.

## Requirements

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

Before this change a per-room target owned the desired pace, so rooms serving
one challenge could disagree. This was an audited defect in the old design, not
the required final behavior; the room target was retired in #997. The state PATCH
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
queue, notification and operator views do not disagree. Resolved in #997: all
of them read `queue_group_pace()`.

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


