-- 0723_schedule_activity_i18n.sql — WS-E (logistics). Extends the H50
-- translate-on-demand mechanism (announcements) to schedule items: content is
-- authored in whichever language the organizer is working in
-- (`primary_language`), machine-translated on demand into the other two, and
-- re-translatable at any time. `title`/`description` stay the canonical
-- mirror of `primary_language` (unlike challenges' English-locked mirror,
-- since there's no single fixed authoring language here) so every existing
-- consumer keeps working unchanged. `activities` gets the same columns
-- because createScheduleItem/updateScheduleItem already mirror a schedule
-- item's name/description into its linked activity row (H25/H26 scanner
-- stations) — translations mirror the same way.

-- DELTA(H50): schedule + activity translations, using the challenges (H44)
-- per-field _i18n jsonb column convention rather than announcements' single
-- jsonb blob, so title and description can be redone independently.
ALTER TABLE schedule
  ADD COLUMN primary_language text NOT NULL DEFAULT 'es' CHECK (primary_language IN ('es', 'gl', 'en')),
  ADD COLUMN title_i18n jsonb,
  ADD COLUMN description_i18n jsonb;

ALTER TABLE activities
  ADD COLUMN primary_language text NOT NULL DEFAULT 'es' CHECK (primary_language IN ('es', 'gl', 'en')),
  ADD COLUMN name_i18n jsonb,
  ADD COLUMN description_i18n jsonb;
