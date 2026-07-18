-- Stop wiping dietary data on decline/expiry (DELTA vs H12/plan/07 §5.2): a
-- revoked/declined/expired spot can be re-accepted, and wiping the data made
-- that re-accept lose it permanently. Dietary data is now kept on the user
-- row for as long as the account exists; the 'removed_after_decline' state
-- is retired.
UPDATE users
   SET dietary_data_state = 'not_provided'
 WHERE dietary_data_state = 'removed_after_decline';

ALTER TABLE users DROP CONSTRAINT users_dietary_data_state_check;
ALTER TABLE users
  ADD CONSTRAINT users_dietary_data_state_check
  CHECK (dietary_data_state IN ('not_provided', 'present'));
