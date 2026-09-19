-- 0822_role_event_access_projection.sql — DELTA(H8): make the event-access
-- projection enforce the complete runtime contract in one place.
--
-- The view is retained as the canonical read projection until the clean
-- production baseline in #712 removes compatibility-only schema. Every
-- consumer must use this projection rather than deriving access from
-- applications, tickets, capabilities, invitations, or account relationships.
CREATE OR REPLACE VIEW user_event_access AS
SELECT DISTINCT ur.user_id
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  JOIN users u ON u.id = ur.user_id
 WHERE u.account_state = 'active'
   AND u.anonymized_at IS NULL
   AND r.event_access = true
   AND r.deleted_at IS NULL;

COMMENT ON VIEW user_event_access IS
  'H8: canonical event-access projection. A user is admitted only when active, non-anonymized, and assigned at least one non-deleted role with event_access=true. Access is an OR across qualifying roles and is independent of visibility/capabilities.';
