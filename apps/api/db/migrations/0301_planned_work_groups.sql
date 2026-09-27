-- DELTA(#852): pre-event planning is deliberately separate from operational repos/queues.
CREATE TABLE planned_work_groups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (btrim(name) <> ''),
  created_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  devpost_url text,
  presentation_timing_preference text NOT NULL DEFAULT 'no_preference'
    CHECK (presentation_timing_preference IN ('no_preference', 'early', 'middle', 'late')),
  linked_repo_id integer UNIQUE REFERENCES repos(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER planned_work_groups_set_updated_at BEFORE UPDATE ON planned_work_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE planned_work_group_members (
  group_id bigint NOT NULL REFERENCES planned_work_groups(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('active', 'invited', 'declined')),
  invited_by integer REFERENCES users(id) ON DELETE SET NULL,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX planned_work_group_members_user_status ON planned_work_group_members (user_id, status);

CREATE TABLE planned_work_group_challenges (
  group_id bigint NOT NULL REFERENCES planned_work_groups(id) ON DELETE CASCADE,
  challenge_id integer NOT NULL REFERENCES challenges(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, challenge_id)
);
CREATE INDEX planned_work_group_challenges_challenge ON planned_work_group_challenges (challenge_id);

COMMENT ON TABLE planned_work_groups IS 'Issue #852 planning only. linked_repo_id and presentation_timing_preference are contracts for #854 and #853; no conversion or queue behavior exists here.';
