-- 0103_event_diary.sql — #935 event diary: an attendee's private list of the
-- people and sponsor stands they met, built on the #934 directory.
--
-- DELTA(#935): plan/schema-boceto.dbml has no contact collection. New table
-- owned by one user; each row points at exactly one person OR one enterprise.
-- Nothing about the saved person is copied: their card is projected from the
-- live #934 directory on every read, so hiding a profile later hides it here
-- too. Only the owner's own choices (favourite, private note) are stored.
--
-- H54: ON DELETE CASCADE on both user references covers deletion; the
-- anonymization scrub (identity/removal.ts) deletes rows on either side
-- explicitly, and the H54 trigger rejects writes for pending/anonymized
-- owners or targets.
CREATE TABLE diary_entries (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id integer REFERENCES users(id) ON DELETE CASCADE,
  enterprise_id integer REFERENCES enterprises(id) ON DELETE CASCADE,
  starred boolean NOT NULL DEFAULT false,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT diary_entries_one_target CHECK ((target_user_id IS NULL) <> (enterprise_id IS NULL)),
  CONSTRAINT diary_entries_not_self CHECK (target_user_id IS DISTINCT FROM owner_id)
);

-- Re-scanning is a no-op: one row per (owner, person) and (owner, enterprise).
CREATE UNIQUE INDEX diary_entries_owner_person
  ON diary_entries (owner_id, target_user_id) WHERE target_user_id IS NOT NULL;
CREATE UNIQUE INDEX diary_entries_owner_enterprise
  ON diary_entries (owner_id, enterprise_id) WHERE enterprise_id IS NOT NULL;
-- H54 scrub of the rows where the removed person is the saved target.
CREATE INDEX diary_entries_target_user ON diary_entries (target_user_id)
  WHERE target_user_id IS NOT NULL;
CREATE INDEX diary_entries_enterprise ON diary_entries (enterprise_id)
  WHERE enterprise_id IS NOT NULL;

CREATE TRIGGER diary_entries_set_updated_at
  BEFORE UPDATE ON diary_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER h54_active_user_owner_id
  BEFORE INSERT OR UPDATE ON diary_entries
  FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference('owner_id');

CREATE TRIGGER h54_active_user_target_user_id
  BEFORE INSERT OR UPDATE ON diary_entries
  FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference('target_user_id');

COMMENT ON TABLE diary_entries IS '#935 private event diary: people and sponsor stands an attendee saved. Cards are projected live; only the owner''s favourite flag and note are stored.';
COMMENT ON COLUMN diary_entries.note IS '#935: private note visible only to owner_id.';
