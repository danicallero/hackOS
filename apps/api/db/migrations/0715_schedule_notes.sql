-- 0715_schedule_notes.sql — WS-C (schedule/activities, extends H59).
-- Staff-only free-form operational notes on a schedule item — the escaleta's
-- "Observaciones" column (e.g. "call Alicia", "bring the mic stand") that
-- doesn't fit the prep checklist (not a todo) or contact_note (not "who to
-- ask"). Same visibility rule as checklist: staff-only, never sent to the
-- public/sponsor slice of the audience-aware feed.
ALTER TABLE schedule ADD COLUMN notes text;
