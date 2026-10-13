/**
 * Queue membership must match the project roster and notification read models
 * (H20, H29-H30): the active `submissions` rows of active accounts (#1006).
 *
 * This is a SQL fragment rather than a query because the H30 guard, its
 * read-only projection, and manual search all need to join the same relation.
 */
export const REPO_MEMBER_RELATION_SQL = `
  SELECT s.repo_id, s.user_id
    FROM submissions s
    JOIN users u ON u.id = s.user_id
   WHERE s.status = 'active'
     AND u.account_state = 'active'
     AND u.anonymized_at IS NULL`;
