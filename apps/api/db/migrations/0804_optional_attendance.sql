-- Attendance questions are informational: every answer is optional, so a
-- settings-level "required" flag no longer exists. Dropping the column also
-- removes its CHECK (NOT required OR enabled).
ALTER TABLE public.activity_rsvp_settings DROP COLUMN required;
