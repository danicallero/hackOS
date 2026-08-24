-- Privacy-safe provenance for dietary data (H12/H27).
-- The state records only lifecycle provenance; removed values remain erased.
ALTER TABLE users
  ADD COLUMN dietary_data_state text NOT NULL DEFAULT 'not_provided'
  CHECK (dietary_data_state IN ('not_provided', 'present', 'removed_after_decline'));

UPDATE users
   SET dietary_data_state = 'present'
 WHERE cardinality(food_intolerances) > 0
    OR NULLIF(BTRIM(food_intolerance_notes), '') IS NOT NULL;
