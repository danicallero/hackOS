-- 0735_schema_driven_anonymous_retention.sql — H54 follow-up.
--
-- Anonymous application retention belongs to the submitted form definition,
-- not to the anonymization service and not to the mutable current form row.
-- A form edit creates a new immutable snapshot; responses point at the
-- snapshot that was used to collect them.  There is no participant-to-
-- anonymous mapping in this schema.

ALTER TABLE applications
  ADD COLUMN current_form_version integer NOT NULL DEFAULT 1
    CHECK (current_form_version > 0);

CREATE TABLE application_form_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id integer NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  template jsonb NOT NULL,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (application_id, version)
);

COMMENT ON TABLE application_form_versions IS
  'H54 immutable form-definition snapshots. Retention policy is evaluated from the snapshot used by a response, never from a later mutable form.';
COMMENT ON COLUMN application_form_versions.template IS
  'Field definitions, including retention_mode and optional anonymous_audit_dimension; response values are never stored here.';
COMMENT ON COLUMN application_form_versions.created_by IS
  'Administrator who published this form snapshot; nullable so removing that actor does not preserve an identity bridge.';

CREATE OR REPLACE FUNCTION h54_prevent_form_version_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'application form versions are immutable'
    USING ERRCODE = '55006';
END;
$$;

DROP TRIGGER IF EXISTS h54_application_form_version_immutable ON application_form_versions;
CREATE TRIGGER h54_application_form_version_immutable
BEFORE UPDATE ON application_form_versions
FOR EACH ROW EXECUTE FUNCTION h54_prevent_form_version_update();

-- Existing forms are the initial HackUDC configuration.  Only stable field
-- keys are used here; translated or editable labels never grant retention.
-- Every other legacy field receives the explicit minimising default.
UPDATE applications AS a
SET template = COALESCE(
  (
    SELECT jsonb_agg(
      CASE
        WHEN field->>'retention_mode' IS NOT NULL THEN field
        WHEN a.type = 'participant' AND field->>'key' = 'age' THEN
          field || jsonb_build_object(
            'retention_mode', 'anonymous_audit',
            'anonymous_audit_dimension', 'age'
          )
        WHEN a.type = 'participant' AND field->>'key' = 'gender' THEN
          field || jsonb_build_object(
            'retention_mode', 'anonymous_audit',
            'anonymous_audit_dimension', 'gender'
          )
        WHEN a.type = 'participant' AND field->>'key' = 'university' THEN
          field || jsonb_build_object(
            'retention_mode', 'anonymous_audit',
            'anonymous_audit_dimension', 'university'
          )
        WHEN a.type = 'participant' AND field->>'key' = 'degree' THEN
          field || jsonb_build_object(
            'retention_mode', 'anonymous_audit',
            'anonymous_audit_dimension', 'degree'
          )
        WHEN a.type = 'participant' AND field->>'key' IN ('graduation_year', 'graduationYear') THEN
          field || jsonb_build_object(
            'retention_mode', 'anonymous_audit',
            'anonymous_audit_dimension', 'graduation_year'
          )
        WHEN a.type = 'participant' AND field->>'key' IN ('origin_city', 'originCity') THEN
          field || jsonb_build_object(
            'retention_mode', 'anonymous_audit',
            'anonymous_audit_dimension', 'origin_city'
          )
        ELSE field || jsonb_build_object('retention_mode', 'none')
      END
      ORDER BY item.ordinality
    )
    FROM jsonb_array_elements(a.template) WITH ORDINALITY AS item(field, ordinality)
  ),
  a.template
)
WHERE jsonb_typeof(a.template) = 'array';

-- Snapshot the post-migration configuration as version 1.  This is also the
-- historical source of truth for responses already collected.
INSERT INTO application_form_versions (application_id, version, template, sections)
SELECT id, current_form_version, template, sections
  FROM applications;

ALTER TABLE application_responses
  ADD COLUMN application_form_version_id bigint
    REFERENCES application_form_versions(id) ON DELETE RESTRICT;

UPDATE application_responses AS response
   SET application_form_version_id = version.id
  FROM application_form_versions AS version
 WHERE version.application_id = response.application_id
   AND version.version = 1;

CREATE INDEX application_responses_form_version
  ON application_responses (application_form_version_id);

-- A dynamic, normalized table keeps retained answers queryable without adding
-- a migration for every future audit dimension.  application_id is the form
-- identity (not the participant's application_responses.id); it is retained
-- only as context and is protected from deletion while an anonymous field
-- still refers to it.  No user_id, response id, email, or credential appears.
CREATE TABLE anonymous_participant_fields (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  anonymous_participant_id uuid NOT NULL
    REFERENCES anonymous_participants(id) ON DELETE CASCADE,
  application_id integer REFERENCES applications(id) ON DELETE RESTRICT,
  application_form_version integer CHECK (application_form_version IS NULL OR application_form_version > 0),
  field_key text NOT NULL CHECK (btrim(field_key) <> ''),
  anonymous_audit_dimension text,
  field_kind text NOT NULL CHECK (btrim(field_kind) <> ''),
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX anonymous_participant_fields_subject
  ON anonymous_participant_fields (anonymous_participant_id);
CREATE INDEX anonymous_participant_fields_dimension
  ON anonymous_participant_fields (anonymous_audit_dimension)
  WHERE anonymous_audit_dimension IS NOT NULL;
CREATE INDEX anonymous_participant_fields_form
  ON anonymous_participant_fields (application_id, application_form_version, field_key);

COMMENT ON TABLE anonymous_participant_fields IS
  'H54 permanent anonymous application answers explicitly marked ANONYMOUS_AUDIT in the submitted form version. Values have no identity mapping.';
COMMENT ON COLUMN anonymous_participant_fields.application_id IS
  'Form context only; this is not application_responses.id and never identifies the participant.';
COMMENT ON COLUMN anonymous_participant_fields.anonymous_audit_dimension IS
  'Optional open semantic slug for reporting. It is metadata, not the retention decision.';
COMMENT ON COLUMN anonymous_participant_fields.value IS
  'Typed JSON value copied only when the submitted field version explicitly opts into anonymous audit retention.';

-- Convert anonymous rows produced by the previous fixed-column version of
-- H54 before removing those columns.  These legacy rows have no trustworthy
-- form-version context, but their values remain attached to the same random
-- anonymous subject and are not linked back to a user.
INSERT INTO anonymous_participant_fields
  (anonymous_participant_id, field_key, anonymous_audit_dimension, field_kind, value)
SELECT id, 'age', 'age', 'number', to_jsonb(age)
  FROM anonymous_participants
 WHERE age IS NOT NULL
UNION ALL
SELECT id, 'gender', 'gender', 'text', to_jsonb(gender)
  FROM anonymous_participants
 WHERE gender IS NOT NULL
UNION ALL
SELECT id, 'university', 'university', 'text', to_jsonb(university)
  FROM anonymous_participants
 WHERE university IS NOT NULL
UNION ALL
SELECT id, 'degree', 'degree', 'text', to_jsonb(degree)
  FROM anonymous_participants
 WHERE degree IS NOT NULL
UNION ALL
SELECT id, 'graduation_year', 'graduation_year', 'number', to_jsonb(graduation_year)
  FROM anonymous_participants
 WHERE graduation_year IS NOT NULL
UNION ALL
SELECT id, 'origin_city', 'origin_city', 'text', to_jsonb(origin_city)
  FROM anonymous_participants
 WHERE origin_city IS NOT NULL;

ALTER TABLE anonymous_participants
  DROP COLUMN age,
  DROP COLUMN gender,
  DROP COLUMN university,
  DROP COLUMN degree,
  DROP COLUMN graduation_year,
  DROP COLUMN origin_city;

COMMENT ON TABLE anonymous_participants IS
  'H54 anonymous audit subject. id is random and unrelated to any original account; system-generated verified venue time remains on this subject and retained application values live in anonymous_participant_fields.';
