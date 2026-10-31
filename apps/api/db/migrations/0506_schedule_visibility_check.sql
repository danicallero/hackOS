-- DELTA(#1187) vs plan/schema-boceto.dbml: schedule.visibility was free text, so a row with
-- an unknown value (e.g. 'public') was accepted by the database but made the public schedule
-- responses fail serialization (HTTP 500 for the whole list). The API only knows these two.
ALTER TABLE schedule
  ADD CONSTRAINT schedule_visibility_check CHECK (visibility IN ('shown', 'hidden'));
