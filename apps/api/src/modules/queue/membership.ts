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
  SELECT g.linked_repo_id AS repo_id,m.user_id FROM planned_work_groups g
    JOIN planned_work_group_members m ON m.group_id=g.id AND m.status='active'
    JOIN repos r ON r.id=g.linked_repo_id AND r.membership_resolution IS DISTINCT FROM 'devpost'
    JOIN users u ON u.id=m.user_id AND u.account_state='active' AND u.anonymized_at IS NULL
  UNION

  SELECT s.repo_id, s.user_id
    FROM submissions s
    JOIN repos r ON r.id=s.repo_id
    JOIN users u ON u.id = s.user_id
   WHERE s.status = 'active'
     AND (r.membership_resolution IS DISTINCT FROM 'devpost' OR s.imported_from='devpost')
     AND (r.membership_resolution IS DISTINCT FROM 'internal' OR s.imported_from<>'devpost')
     AND u.account_state = 'active'
     AND u.anonymized_at IS NULL
  UNION
  SELECT dp.repo_id, dp.user_id
    FROM devpost_participants dp
    JOIN repos r ON r.id=dp.repo_id AND r.membership_resolution IS DISTINCT FROM 'internal'
    JOIN users u ON u.id = dp.user_id
   WHERE dp.user_id IS NOT NULL
     AND u.account_state = 'active'
     AND u.anonymized_at IS NULL
  UNION
  SELECT dp.repo_id, u.id AS user_id
    FROM devpost_participants dp
    JOIN repos r ON r.id=dp.repo_id AND r.membership_resolution IS DISTINCT FROM 'internal'
    JOIN users u
      ON (u.email_verified AND lower(dp.email) = lower(u.email))
      OR (u.secondary_email_verified_at IS NOT NULL
          AND lower(dp.email) = lower(u.secondary_email))
   WHERE u.account_state = 'active'
     AND u.anonymized_at IS NULL`;
