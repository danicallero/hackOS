-- 0403_tv_slots.sql — queue/judging band (the queue module owns TV state).
--
-- DELTA(H42): the venue broadcasts one view to every screen, and which view
-- that should be follows the event's own timetable (the combined "live"
-- screen most of the day, the judging rooms grid while judging runs). Until
-- now the only way to change it was a human at /tv/control, which nobody is
-- at 04:00. A slot is an absolute time window plus what to show in it.
--
-- `items` is the ordered list of what the slot shows:
--   [{ "mode": "live", "payload": {...}, "seconds": 60 }, ...]
-- One entry = a plain slot. Several = the display rotates through them on
-- each entry's `seconds` dwell, client-side. Modes are validated in Zod
-- (src/modules/queue/schemas.ts) rather than by a CHECK, so adding a mode
-- doesn't need a migration.
--
-- Slots may overlap; resolution picks the covering slot with the latest
-- starts_at (see resolveTvState in src/modules/queue/tv.ts), which makes a
-- short "opening ceremony" window naturally win over an all-day one.
CREATE TABLE tv_slots (
  id bigserial PRIMARY KEY,
  label text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  items jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tv_slots_window_ordered CHECK (ends_at > starts_at),
  CONSTRAINT tv_slots_items_not_empty CHECK (jsonb_array_length(items) > 0)
);

-- Resolution reads "covering slots, latest start first" on every scheduler
-- tick (every 5s), so the ordering is worth an index.
CREATE INDEX tv_slots_starts_at_desc_idx ON tv_slots (starts_at DESC);

CREATE TRIGGER tv_slots_set_updated_at BEFORE UPDATE ON tv_slots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
