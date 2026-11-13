-- 0902_help_request_single_requester.sql — H64: a help request always belongs
-- to one person, the requester. Team requests are retired.
--
-- DELTA(H64): drops help_requests.repo_id (0901) with its two indexes and
-- replaces the per-team / per-individual active uniqueness with one active
-- (open or claimed) request per requester. Former team requests stay with the
-- person who opened them; teammates no longer see or act on them.

-- A person may hold an individual and a team request at once under the old
-- rules. Keep the newest active one and withdraw the rest, so the new unique
-- index can be built. User triggers are off for this statement only: the H54
-- guard would reject touching a row whose requester is pending removal.
ALTER TABLE help_requests DISABLE TRIGGER USER;
UPDATE help_requests hr
   SET status = 'cancelled', cancelled_at = now(), updated_at = now()
 WHERE hr.status IN ('open', 'claimed')
   AND hr.requester_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM help_requests newer
      WHERE newer.requester_id = hr.requester_id
        AND newer.status IN ('open', 'claimed')
        AND (newer.created_at, newer.id) > (hr.created_at, hr.id)
   );
ALTER TABLE help_requests ENABLE TRIGGER USER;

DROP INDEX help_requests_active_team;
DROP INDEX help_requests_active_individual;
DROP INDEX help_requests_repo;
ALTER TABLE help_requests DROP COLUMN repo_id;

CREATE UNIQUE INDEX help_requests_active_requester
  ON help_requests (requester_id)
  WHERE status IN ('open', 'claimed') AND requester_id IS NOT NULL;

COMMENT ON TABLE help_requests IS 'H64-H66 help requests, each from one requester, and their single claim.';
