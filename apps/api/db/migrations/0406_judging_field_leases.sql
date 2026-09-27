-- Issue #850: a text answer or private note is edited by exactly one judge
-- at a time. The expiry is intentionally database-owned so abandoned browser
-- sessions cannot leave a field blocked.

CREATE TABLE judging_field_leases (
  queue_entry_id integer NOT NULL REFERENCES queue_entries(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  judge_id integer NOT NULL REFERENCES users(id),
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (queue_entry_id, field_key)
);

CREATE INDEX judging_field_leases_active
  ON judging_field_leases (queue_entry_id, expires_at);

CREATE TRIGGER set_judging_field_leases_updated_at
  BEFORE UPDATE ON judging_field_leases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
