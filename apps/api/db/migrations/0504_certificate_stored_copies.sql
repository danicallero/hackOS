-- DELTA(#1083): each issued certificate keeps ONE generated PDF copy. The first
-- download renders it (QR, code and print date stamped once) and every later
-- download or public view returns the same bytes, verified against its hash.
-- Refreshing a certificate after more attendance supersedes the old one without
-- revoking it: the old code keeps verifying, as of its own issue date.
-- Per-type requirements replace the global project-presentation switch: a type can
-- wait for the event to end, require presenting (to any jury, the mandatory one or
-- a chosen challenge's) and exempt some roles, such as organisers, from all of it.
-- A revoked or removed certificate drops its copy: nothing is served for it and
-- the identification printed on the PDF does not outlive validity (H54).

ALTER TABLE attendance_certificates
  ADD COLUMN superseded_at timestamptz,
  ADD COLUMN pdf bytea,
  ADD COLUMN pdf_sha256 text,
  ADD COLUMN pdf_generated_at timestamptz,
  ADD CONSTRAINT attendance_certificates_pdf_consistent
    CHECK ((pdf IS NULL) = (pdf_sha256 IS NULL) AND (pdf IS NULL) = (pdf_generated_at IS NULL));

-- One CURRENT certificate per account, type, language and talk; superseded ones stay valid.
DROP INDEX attendance_certificates_one_live;
CREATE UNIQUE INDEX attendance_certificates_one_live
  ON attendance_certificates(user_id,type_id,locale,activity_name)
  WHERE revoked_at IS NULL AND superseded_at IS NULL;

-- Public "which certificate is this file?" lookup by fingerprint.
CREATE INDEX attendance_certificates_pdf_sha256 ON attendance_certificates(pdf_sha256)
  WHERE pdf_sha256 IS NOT NULL;

CREATE FUNCTION certificate_drop_pdf_when_revoked() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revoked_at IS NOT NULL THEN
    NEW.pdf := NULL;
    NEW.pdf_sha256 := NULL;
    NEW.pdf_generated_at := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER attendance_certificates_drop_pdf
  BEFORE INSERT OR UPDATE ON attendance_certificates
  FOR EACH ROW EXECUTE FUNCTION certificate_drop_pdf_when_revoked();

COMMENT ON COLUMN attendance_certificates.pdf IS '#1083 the single generated copy (footer included), rendered on first download. NULL until then and after revocation or account removal.';
COMMENT ON COLUMN attendance_certificates.pdf_sha256 IS '#1083 hex SHA-256 of pdf, checked on every read so a corrupted copy is never served.';
COMMENT ON COLUMN attendance_certificates.superseded_at IS '#1083 a newer certificate replaced this one after the person attended more. Still valid and downloadable as issued; only the newest is offered.';

ALTER TABLE certificate_types
  ADD COLUMN requires_event_end boolean NOT NULL DEFAULT false,
  ADD COLUMN demo_requirement text NOT NULL DEFAULT 'none'
    CHECK (demo_requirement IN ('none','any','mandatory','challenge')),
  -- No foreign key: truncating challenges must not cascade into the catalogue. A deleted
  -- challenge simply never matches, so the requirement fails closed (exempt roles still pass).
  ADD COLUMN demo_challenge_id integer,
  ADD COLUMN exempt_role_ids integer[];

UPDATE certificate_types SET demo_requirement = 'any'
 WHERE attendance_policy AND (SELECT requires_demo FROM certificate_settings WHERE id = 1);
-- The plain Attendance certificate states the event was completed.
UPDATE certificate_types SET requires_event_end = true WHERE legacy_variant = 'participation';
ALTER TABLE certificate_settings DROP COLUMN requires_demo;

ALTER TABLE certificate_types ADD CONSTRAINT certificate_types_accepted_spot_unrestricted
  CHECK (legacy_variant IS DISTINCT FROM 'accepted_spot' OR
    (NOT requires_event_end AND demo_requirement = 'none' AND exempt_role_ids IS NULL));

COMMENT ON COLUMN certificate_types.requires_event_end IS '#1083 self-service and bulk issue wait until event_config.event_ends_at has passed.';
COMMENT ON COLUMN certificate_types.demo_requirement IS '#1083 none | any presentation | presented to a mandatory challenge | presented to demo_challenge_id (queue_entries started or completed).';
COMMENT ON COLUMN certificate_types.exempt_role_ids IS '#1083 holders of these roles skip the attendance, event-end and presentation requirements of this type.';

-- DELTA(#1083): Accepted spot certifies event access, so it is revoked as soon as the
-- person has none (role removed, role without event access, deleted role, suspended or
-- anonymised account). Deferred to commit so a role swap inside one transaction keeps it.
-- A new one can be requested if access returns.
CREATE FUNCTION certificate_revoke_lost_access(p_user integer) RETURNS void
  LANGUAGE sql AS $$
  WITH revoked AS (
    UPDATE attendance_certificates c
       SET revoked_at = now(), revoked_reason = 'event_access_lost'
     WHERE c.revoked_at IS NULL AND c.user_id IS NOT NULL
       AND (p_user IS NULL OR c.user_id = p_user)
       AND c.type_id = (SELECT id FROM certificate_types WHERE legacy_variant = 'accepted_spot')
       AND NOT EXISTS (SELECT 1 FROM user_event_access a WHERE a.user_id = c.user_id)
    RETURNING c.id
  )
  INSERT INTO audit_log (actor_id, entity_type, entity_id, action, source, reason)
  SELECT NULL, 'attendance_certificate', id::text, 'certificate.revoke', 'system', 'event_access_lost'
    FROM revoked;
$$;

CREATE FUNCTION certificate_access_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'user_roles' THEN
    PERFORM certificate_revoke_lost_access(OLD.user_id);
  ELSIF TG_TABLE_NAME = 'users' THEN
    PERFORM certificate_revoke_lost_access(NEW.id);
  ELSE
    PERFORM certificate_revoke_lost_access(NULL);
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER certificate_access_user_roles
  AFTER UPDATE OR DELETE ON user_roles
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION certificate_access_changed();
CREATE CONSTRAINT TRIGGER certificate_access_roles
  AFTER UPDATE OF event_access, deleted_at OR DELETE ON roles
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION certificate_access_changed();
CREATE CONSTRAINT TRIGGER certificate_access_users
  AFTER UPDATE OF account_state, anonymized_at ON users
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION certificate_access_changed();
