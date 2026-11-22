-- DELTA(H13,H54): a duplicate pair where one application is already accepted
-- cannot be merged (a decision belongs to one account). The reviewer can
-- instead ask the applicant whether to delete the account of the application
-- that was not accepted. The proposal is emailed like a merge; the applicant
-- confirms the removal or says the two are different people.
--
-- kind: merge (0212) or remove. A removal proposal stores no merged answers:
-- kept_response_id is the accepted response, set when it is proposed. It is
-- not required by the check: deleting that response (account removal) sets
-- it to NULL while the case is still pending, and the link then refuses.
-- status removed: the applicant confirmed and the other account was deleted.
ALTER TABLE application_duplicate_cases
  ADD COLUMN kind text NOT NULL DEFAULT 'merge' CHECK (kind IN ('merge', 'remove'));

ALTER TABLE application_duplicate_cases
  DROP CONSTRAINT application_duplicate_cases_status_check,
  ADD CONSTRAINT application_duplicate_cases_status_check CHECK (
    status IN ('dismissed', 'pending', 'merged', 'removed', 'kept_separate', 'cancelled')
  ),
  DROP CONSTRAINT application_duplicate_cases_proposal_check,
  ADD CONSTRAINT application_duplicate_cases_proposal_check CHECK (
    status <> 'pending' OR (
      source_fingerprints IS NOT NULL AND first_token_hash IS NOT NULL
      AND second_token_hash IS NOT NULL AND expires_at IS NOT NULL
      AND (kind <> 'merge' OR (
        merged_responses IS NOT NULL AND submitted_from_response_id IS NOT NULL
      ))
    )
  );

COMMENT ON COLUMN application_duplicate_cases.kind IS
  'merge: combine both answers into the kept account. remove: keep the accepted application and delete the other account.';
