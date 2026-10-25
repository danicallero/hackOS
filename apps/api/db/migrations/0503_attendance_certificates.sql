-- DELTA(#1083): organisation-issued certificates, configurable content and
-- recipients, secured-attendance policy and manual certified-hour awards.
-- Consolidated before the feature's first staging/production deployment.
-- Raw attendance evidence is never changed by a certified-hour award.

CREATE TABLE certificate_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- NULL disables automatic issuance; no hours are preconfigured.
  min_hours numeric(5,2) CHECK (min_hours IS NULL OR min_hours >= 0),
  min_review_hours numeric(5,2) CHECK (min_review_hours IS NULL OR min_review_hours >= 0),
  award_hours numeric(5,2) CHECK (award_hours IS NULL OR award_hours > 0),
  requires_demo boolean NOT NULL DEFAULT false,
  issuer_name text NOT NULL
    DEFAULT 'Asociación Universitaria Grupo de Programadores e Usuarios de Linux (GPUL)'
    CHECK (char_length(issuer_name) BETWEEN 1 AND 200),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT certificate_review_threshold
    CHECK (min_hours IS NULL OR min_review_hours IS NULL OR min_review_hours <= min_hours)
);
INSERT INTO certificate_settings (id) VALUES (1);
CREATE TRIGGER certificate_settings_set_updated_at
  BEFORE UPDATE ON certificate_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE certificate_types (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  legacy_variant text UNIQUE CHECK (legacy_variant IN ('participation','hours','activities','accepted_spot')),
  name_i18n jsonb NOT NULL,
  title_i18n jsonb NOT NULL,
  body_i18n jsonb,
  enabled boolean NOT NULL DEFAULT true,
  attendance_policy boolean NOT NULL DEFAULT false,
  self_service boolean NOT NULL DEFAULT false,
  audience_role_ids integer[],
  allow_guests boolean NOT NULL DEFAULT false,
  identity_policy text NOT NULL DEFAULT 'optional' CHECK (identity_policy IN ('none','optional','required')),
  requires_activity boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT self_service OR NOT requires_activity),
  CHECK (legacy_variant IS DISTINCT FROM 'accepted_spot' OR
    (NOT attendance_policy AND self_service AND audience_role_ids IS NULL AND NOT allow_guests AND NOT requires_activity AND body_i18n IS NOT NULL))
);
CREATE TRIGGER certificate_types_set_updated_at BEFORE UPDATE ON certificate_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
INSERT INTO certificate_types(legacy_variant,name_i18n,title_i18n,attendance_policy,self_service)
VALUES
 ('participation','{"es":"Asistencia","gl":"Asistencia","en":"Attendance"}','{"es":"CERTIFICADO DE ASISTENCIA","gl":"CERTIFICADO DE ASISTENCIA","en":"CERTIFICATE OF ATTENDANCE"}',true,true),
 ('hours','{"es":"Horas de asistencia","gl":"Horas de asistencia","en":"Attendance hours"}','{"es":"CERTIFICADO DE ASISTENCIA","gl":"CERTIFICADO DE ASISTENCIA","en":"CERTIFICATE OF ATTENDANCE"}',true,true),
 ('activities','{"es":"Actividades","gl":"Actividades","en":"Activities"}','{"es":"CERTIFICADO DE ACTIVIDADES","gl":"CERTIFICADO DE ACTIVIDADES","en":"ACTIVITY CERTIFICATE"}',true,true);

-- Accepted spot certifies event access, independently of attendance or roles.
INSERT INTO certificate_types(legacy_variant,name_i18n,title_i18n,body_i18n,self_service)
VALUES ('accepted_spot',
  '{"es":"Plaza aceptada","gl":"Praza aceptada","en":"Accepted spot"}',
  '{"es":"CERTIFICADO DE PLAZA ACEPTADA","gl":"CERTIFICADO DE PRAZA ACEPTADA","en":"CERTIFICATE OF ACCEPTED SPOT"}',
  '{"es":"Se certifica que {recipient} tiene una plaza aceptada para el evento {event}, con fechas {dates} en {venue}.","gl":"Certifícase que {recipient} ten unha praza aceptada para o evento {event}, nas datas {dates} en {venue}.","en":"This certifies that {recipient} has an accepted spot at {event}, taking place on {dates} at {venue}."}',true);

CREATE TABLE certificate_approvals (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  certified_hours numeric(5,2) NOT NULL CHECK (certified_hours > 0),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  approved_by integer REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON certificate_approvals
  FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference('user_id');

CREATE TABLE attendance_certificates (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (char_length(code) >= 16),
  user_id integer REFERENCES users(id) ON DELETE CASCADE,
  type_id integer NOT NULL REFERENCES certificate_types(id),
  -- Retained for the original PDF variants and legacy issuance endpoints.
  variant text NOT NULL CHECK (variant IN ('participation','hours','activities')),
  locale text NOT NULL CHECK (locale IN ('es','gl','en')),
  source text NOT NULL CHECK (source IN ('self','bulk','staff')),
  activity_name text NOT NULL DEFAULT '',
  recipient_name text,
  recipient_document_kind text CHECK (recipient_document_kind IN ('dni_nie','passport')),
  recipient_document_number text,
  override_reason text,
  issued_by integer REFERENCES users(id) ON DELETE SET NULL,
  snapshot jsonb NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by integer REFERENCES users(id) ON DELETE SET NULL,
  revoked_reason text,
  CONSTRAINT attendance_certificates_revocation
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT certificate_guest_name
    CHECK (user_id IS NOT NULL OR (recipient_name IS NOT NULL AND char_length(btrim(recipient_name)) > 0))
);
-- Account requests converge; guests with identical names can be distinct people.
-- Idempotency guards deduplicate retries of a guest issuance request.
CREATE UNIQUE INDEX attendance_certificates_one_live
  ON attendance_certificates(user_id,type_id,locale,activity_name) WHERE revoked_at IS NULL;
CREATE INDEX attendance_certificates_user ON attendance_certificates(user_id);
CREATE TRIGGER h54_active_user_user_id
  BEFORE INSERT ON attendance_certificates
  FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference('user_id');

COMMENT ON TABLE certificate_settings IS '#1083 single-row attendance policy: automatic/review thresholds, optional awarded hours and issuer name. No preconfigured hours.';
COMMENT ON COLUMN certificate_settings.award_hours IS '#1083 optional configured certificate/university award; NULL uses confirmed attendance. Individual approvals win.';
COMMENT ON TABLE certificate_types IS '#1083 editable certificate definitions: trilingual content, actual role IDs, attendance policy, self-service, guests and optional/required/omitted identification.';
COMMENT ON TABLE certificate_approvals IS '#1083 manual attendance awards: certified hours feed certificates and university exports; raw presence signals remain unchanged. Cleared on account removal (H54).';
COMMENT ON TABLE attendance_certificates IS '#1083 account and guest certificates; rendered from frozen content, publicly verified by code, searchable and revocable by staff.';
COMMENT ON COLUMN attendance_certificates.snapshot IS '#1083 name, event, dates, venue, issuer, certified hours, activities and wording as issued; identification numbers excluded. Cleared on account removal (H54).';
COMMENT ON COLUMN attendance_certificates.recipient_document_number IS '#1083 explicit recipient identification outside the public snapshot. Cleared on account removal. Account DNI remains live unless explicitly overridden.';
