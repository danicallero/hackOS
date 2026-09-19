-- 0602_announcements_delivery_and_tv_modes.sql — notifications band.
--
-- DELTA(H50): announcements no longer carry a role-derived audience. An
-- organiser explicitly chooses whether to notify everyone through each
-- recipient's enabled channels, and independently chooses their TV treatment.
-- `expires_at` remains the single visibility/duration window: NULL means the
-- announcement stays present until an organiser removes it.

ALTER TABLE announcements
  DROP COLUMN target_role,
  ADD COLUMN notify_users boolean NOT NULL DEFAULT false,
  ADD COLUMN screen_placement text NOT NULL DEFAULT 'none',
  ADD COLUMN translations jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT announcements_screen_placement_check
    CHECK (screen_placement IN ('none', 'embedded', 'fullscreen')),
  ADD CONSTRAINT announcements_translations_object_check
    CHECK (jsonb_typeof(translations) = 'object'),
  ADD CONSTRAINT announcements_visibility_window_check
    CHECK (expires_at IS NULL OR publish_at IS NULL OR expires_at > publish_at) NOT VALID;

-- DELTA(H42): a message is now an announcement property, not a standalone TV
-- mode. Existing timetable JSON is normalised before the Zod enum stops
-- accepting the legacy values: `timer` becomes the safe live fallback;
-- `announcement` entries are removed. A legacy slot containing only
-- announcements falls back to one live item so it continues to satisfy the
-- non-empty-items invariant and never blanks the venue wall.
UPDATE tv_slots AS slot
SET items = COALESCE(
  (
    SELECT jsonb_agg(
      CASE
        WHEN item->>'mode' = 'timer' THEN jsonb_set(item, '{mode}', '"live"'::jsonb)
        ELSE item
      END
      ORDER BY ordinality
    )
    FROM jsonb_array_elements(slot.items) WITH ORDINALITY AS entries(item, ordinality)
    WHERE item->>'mode' <> 'announcement'
  ),
  '[{"mode":"live","payload":null,"seconds":null}]'::jsonb
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(slot.items) AS entries(item)
  WHERE item->>'mode' IN ('announcement', 'timer')
);
