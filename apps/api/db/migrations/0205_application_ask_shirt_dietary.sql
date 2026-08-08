-- DELTA(H12): shirt size / dietary restrictions were only ever asked on
-- forms whose type was hardcoded into SHIRT_TYPES ("participant","mentor").
-- Admins can now toggle each independently per application (form), so a
-- sponsor or volunteer form can opt in, or a mentor form opt out. Backfill
-- preserves current behavior: both flags on for participant/mentor, off
-- elsewhere.

ALTER TABLE applications
  ADD COLUMN ask_shirt_size boolean NOT NULL DEFAULT false,
  ADD COLUMN ask_food_intolerances boolean NOT NULL DEFAULT false;

UPDATE applications
SET ask_shirt_size = true,
    ask_food_intolerances = true
WHERE type IN ('participant', 'mentor');
