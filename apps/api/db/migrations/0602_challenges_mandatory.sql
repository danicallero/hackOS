-- DELTA(#851): a mandatory challenge enrolls every project in its judging queue.
ALTER TABLE challenges ADD COLUMN mandatory boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN challenges.mandatory IS
  'When true, every project is enrolled regardless of Devpost tags or manual selection (issue #851).';
