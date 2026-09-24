-- DELTA(H12): drafts stay editable against the current form version, while
-- submitted responses retain their immutable evaluation snapshot.
UPDATE application_responses AS response
   SET application_form_version_id = version.id
  FROM applications AS application
  JOIN application_form_versions AS version
    ON version.application_id = application.id
   AND version.version = application.current_form_version
 WHERE response.application_id = application.id
   AND response.status = 'draft'
   AND response.application_form_version_id IS DISTINCT FROM version.id;
