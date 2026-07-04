-- 0700_challenge_editing.sql — WS-G (sponsors/content, H44). Challenge editing
-- by the owning sponsor (or an org admin), including the judging panel builder.
-- The challenges table itself (title, description, criteria,
-- judging_panel_criteria, prizes, ...) already exists from 0001_initial.sql.

-- DELTA(H44): "cada cambio guarda una versión, para poder saber qué decía el
-- reto en cualquier momento." One immutable snapshot row per edit of a
-- challenge's editable fields. Operational history; distinct from audit_log.
CREATE TABLE challenge_versions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  challenge_id integer NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  editor_id integer REFERENCES users(id),
  -- full snapshot of the editable surface at save time
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX challenge_versions_challenge ON challenge_versions (challenge_id, created_at);
