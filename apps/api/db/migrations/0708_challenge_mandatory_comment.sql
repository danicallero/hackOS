-- DELTA(#1005): describe mandatory enrollment in the native project model.
COMMENT ON COLUMN challenges.mandatory IS
  'When true, every project is enrolled regardless of manual challenge selection (issue #851).';
