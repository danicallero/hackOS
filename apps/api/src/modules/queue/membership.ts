/** One active native roster drives H30 collision guards and queue projections. */
export const REPO_MEMBER_RELATION_SQL = `
 SELECT s.repo_id,s.user_id FROM submissions s
 JOIN users u ON u.id=s.user_id
 WHERE s.status='active' AND u.account_state='active' AND u.anonymized_at IS NULL`;
