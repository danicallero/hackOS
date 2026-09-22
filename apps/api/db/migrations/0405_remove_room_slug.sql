-- DELTA(H29, H46): a room's human-facing identity is its name; the numeric
-- primary key remains the stable internal identifier, so the unused slug is
-- removed from the room contract and schema.

ALTER TABLE rooms
  DROP CONSTRAINT IF EXISTS rooms_slug_key,
  DROP COLUMN IF EXISTS slug;
