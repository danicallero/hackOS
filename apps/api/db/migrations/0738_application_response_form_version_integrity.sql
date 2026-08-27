-- 0738_application_response_form_version_integrity.sql — H54 retention source integrity.
--
-- A response's version pointer must belong to the same application as the
-- response. A plain FK on application_form_version_id would allow an
-- inconsistent/imported row to select another form's retention policy.

ALTER TABLE application_form_versions
  ADD CONSTRAINT application_form_versions_application_id_id_key
  UNIQUE (application_id, id);

ALTER TABLE application_responses
  ADD CONSTRAINT application_responses_form_version_application_fk
  FOREIGN KEY (application_id, application_form_version_id)
  REFERENCES application_form_versions (application_id, id)
  ON DELETE RESTRICT;
