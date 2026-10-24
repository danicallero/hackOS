-- 0503_attendance_certificates.sql — self-service attendance certificates
-- issued by the organisation, verifiable by a public code (#1083).
--
-- DELTA(#1083): plan/schema-boceto.dbml has no certificates. There is no
-- personal signature and no electronic seal: trust comes from the issuing
-- organisation named on the PDF plus an unguessable verification code that a
-- public page resolves. The document is rendered on demand from `snapshot`
-- (what was true when it was issued); the DNI/NIE is read live from `users` so
-- it is never copied here, and the public page never shows it.
--
-- H54: `user_id` cascades on delete; the removal scrub (identity/removal.ts)
-- revokes the person's certificates and clears the snapshot instead, so the
-- verification page answers "revoked" rather than "unknown".

CREATE TABLE certificate_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- NULL: automatic issue is off (staff can still issue with an override).
  min_hours numeric(5, 2) CHECK (min_hours IS NULL OR min_hours >= 0),
  requires_demo boolean NOT NULL DEFAULT false,
  issuer_name text NOT NULL
    DEFAULT 'Asociación Universitaria Grupo de Programadores e Usuarios de Linux (GPUL)'
    CHECK (char_length(issuer_name) BETWEEN 1 AND 200),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO certificate_settings (id) VALUES (1);

CREATE TRIGGER certificate_settings_set_updated_at
  BEFORE UPDATE ON certificate_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE attendance_certificates (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (char_length(code) >= 16),
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  variant text NOT NULL CHECK (variant IN ('participation', 'hours', 'activities')),
  locale text NOT NULL CHECK (locale IN ('es', 'gl', 'en')),
  -- How it was issued: the participant, a bulk run, or a staff member.
  source text NOT NULL CHECK (source IN ('self', 'bulk', 'staff')),
  override_reason text,
  issued_by integer REFERENCES users(id) ON DELETE SET NULL,
  snapshot jsonb NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by integer REFERENCES users(id) ON DELETE SET NULL,
  revoked_reason text,
  -- Signed original uploaded by staff; copies downloaded with the CSV footer are
  -- stamped on it instead of the rendered PDF. The object holds personal data and
  -- is deleted on account removal (H54).
  signed_key text,
  signed_at timestamptz,
  signed_by integer REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT attendance_certificates_signed
    CHECK ((signed_key IS NULL) = (signed_at IS NULL)),
  CONSTRAINT attendance_certificates_revocation
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

-- One live certificate per person and variant: asking again returns it.
CREATE UNIQUE INDEX attendance_certificates_one_live
  ON attendance_certificates (user_id, variant) WHERE revoked_at IS NULL;
CREATE INDEX attendance_certificates_user ON attendance_certificates (user_id);

CREATE TRIGGER h54_active_user_user_id
  BEFORE INSERT ON attendance_certificates
  FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference('user_id');

COMMENT ON TABLE certificate_settings IS '#1083 single-row policy: hour threshold (NULL = no automatic issue), demo requirement and issuer name printed on certificates.';
COMMENT ON TABLE attendance_certificates IS '#1083 issued attendance certificates; rendered on demand from snapshot, verified publicly by code. DNI is never stored here.';
COMMENT ON COLUMN attendance_certificates.snapshot IS '#1083 name, event, dates, venue, issuer, verified hours and attended activities as issued; cleared on account removal (H54).';
