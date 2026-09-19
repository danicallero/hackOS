-- 0719_schedule_owner_free_text.sql — WS-C (schedule/activities, extends H59).
-- "Who's responsible" (schedule_owners) only ever pointed at a real hackOS
-- account. Staff often needs to note a name that isn't one — an external
-- vendor, a volunteer without a login — so user_id becomes optional and a
-- free_text_name column carries the alternative. Exactly one of the two is
-- set per row; a free-text row has no assigned_by/account identity to key
-- uniqueness on, so the UNIQUE(schedule_id, user_id) constraint (which
-- already ignores NULLs under standard SQL semantics) is left as-is — it
-- still dedupes real-account owners, and duplicate free-text names for one
-- item are a harmless no-op, not worth a case-insensitive uniqueness rule.
ALTER TABLE schedule_owners
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN free_text_name text;

ALTER TABLE schedule_owners
  ADD CONSTRAINT schedule_owners_exactly_one_identity CHECK (
    (user_id IS NOT NULL AND free_text_name IS NULL)
    OR (user_id IS NULL AND free_text_name IS NOT NULL)
  );
