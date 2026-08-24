-- 0406_drop_room_judges.sql
-- DELTA(Hxx): superseded by `enterprise_judges` (0405). A judge is no longer
-- bound to a concrete room; room access is derived from the enterprise that
-- owns the room's challenge. Runs after the 0405 backfill and after every
-- consumer was cut over in the same change.
DROP TABLE room_judges;
