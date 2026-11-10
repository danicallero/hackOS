# HackUDC 2027 onboarding

The current edition is `event_config.event_key`. `PUT /api/event` changes it under
`event:manage`; the first change from the reserved `default` key adopts the
legacy applications and role evidence into the named edition. Later changes
leave old applications, role evidence, RSVP answers, mentor publication and
onboarding decisions under their original key. New application forms record
the current key. The `default` key cannot be reused after adoption.

`GET /api/me/onboarding` resolves the fixed sequence: welcome, profile,
dietary, networking, mentor profile, RSVP, notifications, share and completion.
The organizer edits step enablement, requirement, applicable attendance kinds,
revision policy, trilingual welcome text, a logo/accent brand pair and a fixed list of profile fields through
`GET/PUT /api/event/onboarding`. It is a single settings save and audit event.
A change to enablement, requirement or applicable kinds increments the revision.
The networking step is always optional; configuration cannot require consent.
`PUT /api/me/onboarding/:step` persists a completed, skipped, deferred or
declined decision with an idempotency key, row lock and audit entry. Deferred
decisions become pending at their chosen future time. Completed steps re-open
when their underlying fact becomes false, and skipped steps re-open on a later
configuration revision. Welcome, share and completion are persisted milestones.

Attendance is derived in `event_attendance_kinds` and read through
`identity/attendance.ts`. Confirmed participant application evidence wins over
mentor, sponsor and staff. Seeded Participant/Mentor role assignments are
recorded in `user_role_event_evidence` for the edition, including repeated
assignment attempts after an edition changes. This table holds role evidence,
not a mutable kind override. Without current-edition evidence, attendance kind
is unknown; meal RSVP offers fail closed for that account. `helpdesk:offer`
(including the `*` wildcard) alone gates the mentor profile step and editing.
Losing that capability hides the profile from publication and onboarding but
retains its row for a later grant.

RSVP settings and answers use `(activity_id,event_key)` and
`(user_id,activity_id,event_key)` respectively. An answer row with `attending`
`NULL` means explicitly unsure; no row means unanswered. Historical meal-plan
answers were copied to the current edition, and settings were created for all
currently offered sponsor meals plus meals with historical answers. A
participant is never offered a meal RSVP, whatever the settings say.

Networking completion does not create consent. Only the public-profile editor
can opt a person in. Declining networking clears `directory_visible` and
`consented_at` in the same transaction as the onboarding decision; deferring
does not opt in. Mentor publication is independent of directory consent and
exposes only the intended public mentor fields.

Account removal deletes RSVP answers, onboarding decisions and mentor profiles
(including expertise through cascade) before anonymizing a retained user row.
Final user deletion also cascades these tables.
