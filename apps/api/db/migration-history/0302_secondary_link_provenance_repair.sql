-- DELTA(H6,H16,H17): the former operator-assisted secondary-email flow stored
-- verified-identity matches as permanent manual links. Repair rows whose
-- imported address is the account's current verified secondary identity so
-- later replacement/removal correctly revokes them through reconciliation.
UPDATE devpost_participants dp
   SET merge_status = 'auto_matched', linked_by = NULL, linked_at = NULL
  FROM users u
 WHERE dp.user_id = u.id
   AND dp.merge_status = 'manually_linked'
   AND u.secondary_email_verified_at IS NOT NULL
   AND lower(dp.email) = lower(u.secondary_email);

