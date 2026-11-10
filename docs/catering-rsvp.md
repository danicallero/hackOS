# Catering and activity RSVPs

Per-activity RSVPs generalise the sponsor meal plans (#933): an organizer asks
selected attendance kinds to answer yes / no / not sure for an activity, and
logistics reads truthful headcounts.
Code: `apps/api/src/modules/rsvps/` (service, settings, summary, routes); the
meal-plan routes are facades over it (`identity/meal-plan.ts`,
`logistics/meal-plans.ts`). Web: `apps/web/src/components/onboarding/catering-rsvp.tsx`
(attendee editor) and `catering-settings.tsx` (organizer panel).

## Data

- `activity_rsvp_settings` — PK `(activity_id, event_key)`: `enabled`,
  `required`, `kinds`, name/description overrides, `rsvp_date`, `closes_at`.
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
event key, its schedule entry is `shown` and not ended, and the person's
**derived attendance kind** (`attendanceKind`, participant-first) is in `kinds`.

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

- **Required** items must be answered with yes or no (`400 rsvp_incomplete`
  when missing; `400 rsvp_unsure_not_allowed`). Optional items can be skipped
  or answered "not sure".
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

- `CateringRsvpSection` (`{ userId, onDirtyChange?, onSaved?, footer? }`) renders
  nothing without open RSVPs. `CateringRsvpForm` is the controlled variant
  (`items`, `save`, `formId`) for a host such as the onboarding flow.
- `CateringSettingsPanel` (`{ scheduleId, onDirtyChange? }`) owns its Save; it
  must not live inside the schedule entry's `<form>`.
- Locale strings live in `web.json`; their source fragments and a merge script are in
  `apps/web/locale-fragments/`.
