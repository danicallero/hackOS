/**
 * Queue membership must match the project roster and notification read models
 * (H20, H29-H30). Imported Devpost participants can be linked directly, while
 * legacy rows may still need to be resolved through a primary or verified
 * secondary email until reconciliation repairs their submission row.
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
     AND u.anonymized_at IS NULL
  UNION
  SELECT dp.repo_id, dp.user_id
    FROM devpost_participants dp
    JOIN users u ON u.id = dp.user_id
   WHERE dp.user_id IS NOT NULL
     AND u.account_state = 'active'
     AND u.anonymized_at IS NULL
  UNION
  SELECT dp.repo_id, u.id AS user_id
    FROM devpost_participants dp
    JOIN users u
      ON lower(dp.email) = lower(u.email)
      OR (u.secondary_email_verified_at IS NOT NULL
          AND lower(dp.email) = lower(u.secondary_email))
   WHERE u.account_state = 'active'
     AND u.anonymized_at IS NULL`;
