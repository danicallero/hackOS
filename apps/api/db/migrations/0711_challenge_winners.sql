-- DELTA(H46): internal winner ranking per challenge. Open-ended placements
-- (rank is a free integer, not a fixed top-3) so a sponsor can record as many
-- or as few winners as they want, including extraordinary/special mentions.
-- Visible only to platform admins and the challenge's owning sponsor rep —
-- never public, never other sponsors.
CREATE TABLE challenge_winners (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  challenge_id integer NOT NULL REFERENCES challenges(id),
  rank smallint NOT NULL CHECK (rank >= 1),
  repo_id integer NOT NULL REFERENCES repos(id),
  set_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, rank),
  UNIQUE (challenge_id, repo_id)
);

CREATE TRIGGER challenge_winners_updated_at
  BEFORE UPDATE ON challenge_winners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
