# Catering and activity RSVPs

Per-activity RSVPs generalise the sponsor meal plans (#933): an organizer asks
selected publicly visible roles to answer yes / no / not sure for an activity, and
logistics reads truthful headcounts.
Code: `apps/api/src/modules/rsvps/` (service, settings, summary, routes); the
meal-plan routes are facades over it (`identity/meal-plan.ts`,
`logistics/meal-plans.ts`). Web: `apps/web/src/components/onboarding/catering-rsvp.tsx`
(attendee editor) and `catering-settings.tsx` (organizer panel).

## Data

- `activity_rsvp_settings` — PK `(activity_id, event_key)`: `enabled`,
  `role_ids` (the roles asked), legacy `kinds`, name/description overrides,
  `rsvp_date`, `closes_at`.
- `activity_rsvps` — PK `(user_id, activity_id, event_key)`. `attending` is
  `true` (yes), `false` (no) or `NULL` (**unsure, an explicit answer**); no row
  means unanswered.

The old `options` / `option_key` columns stay in the schema (applied
migrations are immutable) but the product no longer reads or writes them.

Both tables are keyed by the event key, so an earlier edition's configuration
and answers stay as history and never leak into the current edition. Changing
the key starts with nothing offered, nothing answered and nothing counted.

## Who is asked

An activity is offered to a person when its settings are enabled for the current
event key, it is asked to at least one role (`role_ids` non-empty) or legacy kind (`kinds`), its schedule
entry is `shown` and not ended, and the person has a **derived attendance kind**
(`attendanceKind`, participant-first) that is in `kinds` or they hold at least one
of the roles in `role_ids` or the schedule entry’s explicit `role:<id>`
audiences. The same offer query drives web onboarding and next-entry mobile
tasks. The editor picks `role_ids` from the publicly visible
roles (the same dropdown as the schedule audience; the API refuses others with
`400 rsvp_role_invalid`). Migration 0805 moved existing `kinds` to the seeded roles
they stood for (Participant, Mentor, Sponsor, and the seeded roles with event
access for staff).

- A registered participant is never offered a meal, even sponsors, mentors or
  capability holders who are also registered participants, and even if the
  settings (hand-edited) list `participant`. The settings API refuses it
  (`400 rsvp_participants_excluded`) and a participant's answer for a meal is
  `403 rsvp_participants_excluded`.
- No classification (no event access) means nothing is offered; an answer is
  `400 rsvp_not_offered`.
- Non-meal activities may ask participants.

Summaries use the same rule as the offer (see below), so counts never include
someone who could not have answered.

## Answers

`PUT /api/me/rsvps` takes `{ answers: [{ activityId, answer }] }`.

- Every answer is optional: any open item may be skipped, answered yes/no, or
  answered "not sure". There is no required flag and no incomplete-answer error.
- Closing: `closes_at`, by default `event_config.meal_plan_cutoff_hours` before
  the start. Changing a locked answer is `409 rsvp_locked`; echoing it unchanged
  is accepted. Items that ended, were hidden or switched off since the list
  loaded are ignored; others not offered are `400 rsvp_not_offered`.
- Submissions are serialized per user (user row `FOR UPDATE`), accept
  `Idempotency-Key`, and broadcast `logistics.rsvp.updated` with the ids whose
  answer changed (plus `logistics.meal_plan.updated` for meals).
- Staff corrections (`PUT /api/users/:id/rsvps`, `meal-plans:manage`) are
  partial and write one `rsvp.updated` audit row with attending ids only.

## Counts

`GET /api/logistics/rsvps` (`logistics:stats`) and `GET /api/schedule/:id/rsvp`
(`schedule:manage`, field `counts`) return per activity `attending`,
`notAttending`, `unsure`, `unanswered`, `eligible`, `byKind`, `intolerances` and `withNotes`. Counted people are active, non-anonymized,
eligible by the rule above, and on the reader's side of the review-fixture
boundary. The per-person CSV (`/api/logistics/meal-plans/:id/export.csv`,
`meal-plans:export`) lists eligible people attending, with kind, enterprise,
intolerances and dietary notes.

## Meal-plan facade

`GET`/`PUT /api/me/meal-plan` and `/api/users/:id/meal-plan` keep their yes/no
shape over the meal RSVPs. `not_sponsor` became `meal_plan_not_eligible` (403:
participants and unclassified accounts). "Unsure" reads as unanswered.
`meal_plan_incomplete`, `meal_plan_locked` and `meal_not_offered` are unchanged.
The facade still requires every open meal in a self submission.

## Web integration points

- `CateringRsvpSection` (`{ userId, onDirtyChange?, onSaved?, footer? }`) shows
  an empty state without offered RSVPs. `CateringRsvpForm` is the controlled variant
  (`items`, `save`, `formId`) for a host such as the onboarding flow.
- `CateringSettingsPanel` (`{ scheduleId, onDirtyChange? }`) owns its Save; it
  must not live inside the schedule entry's `<form>`. The create form sends
  `rsvp: { enabled, kinds, roleIds }` with `POST /api/schedule`, so a new activity can be
  marked as asked without a second request; the same panel edits it later.
- Locale strings live in `packages/shared/locales/{es,gl,en}/web.json` and
  `mobile.json`.

## Organizer overview and dietary view

- **RSVP** (Logistics › RSVP, `/logistics/rsvps`; `logistics:stats` or
  `meal-plans:export`): only schedule entries asked to at least one kind, in
  time order, with the live Sí / No / No lo sé / Sin respuesta counts and,
  expanded, who answered what (`GET /api/logistics/rsvps/:activityId/people`:
  name, kind, enterprise, answer, unanswered included; no dietary data). The
  view is read-only: it never asks, edits or requires anything. An activity
  that is not asking anyone is marked in Manage Schedule (or while creating
  it) and only then appears here.
- **Alimentación** tab (`meal-plans:export`): `GET /api/logistics/dietary` lists
  every current attendee with intolerances or notes, the per-intolerance counts
  and totals; the web filters by intolerance and searches names, companies and
  notes. Every read writes an audit row without content.
- Attendees change their answers in the onboarding RSVP step (listed only
  while they still have an open item to answer) and in My profile › RSVP
  (always available with event access). Mobile Account uses the same
  yes/no/unsure API and shows open activities and closed answers; next-entry
  profile tasks include pending activity RSVPs for every eligible attendee.
  Unchanged or unanswered items are never submitted as implicit No answers.
