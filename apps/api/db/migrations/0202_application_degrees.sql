-- DELTA(H11,H12): curated degree catalogue for application-form autocomplete.
CREATE TABLE university_degrees (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  proposed_by integer REFERENCES users(id),
  suggested_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX university_degrees_one_suggestion_per_user
  ON university_degrees (suggested_by) WHERE suggested_by IS NOT NULL;

CREATE TRIGGER h54_active_user_proposed_by
  BEFORE INSERT OR UPDATE ON university_degrees
  FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference('proposed_by');
